/**
 * Agent 管理命令（zhinjs/zhin#1250 第 83 批）：Root 命令，由 Agent Host 注册到 Command Feature。
 *
 * 和其他 Root 命令一样走命令分发（MessageDispatcher）：出现在菜单 / 帮助里，有近似指令提示，参数由
 * 命令模块解析，结局记 `command_replied`，权限走 permit DSL（`trusted`：本会话链上任一 zhin 聊天角色，
 * 与原来的 `hostRole !== undefined` 等价），拒绝原因只有 `denied:trusted` 一种。群里无权限者静默
 * （`permission_denied`），私聊说明原因。命令认领的消息不进 AI 回合。
 *
 * `reset` 对所有人开放：受信任用户直接归档会话；其他人发 `reset` 等同聊天清空命令 `/clear`（同一条
 * 清空路径、触发条件、@ 要求、确认冷却与群规则，见 `RuntimeManagementCommandHost.clear`）。
 *
 * 只接受人类来源：由命令分发统一过滤（第 84 批，`@zhin.js/core` 的 `isNonHumanOrigin`）——消息 `origin`
 * （或无可信来源时的 `metadata.origin`）不是 `human` 时不进任何命令，结局 `ignored_bot` / `non_human_origin`。
 *
 * 需要分发租约的命令（`models` / `health` / `tree` / `fork` / `compact` / `reset`）只认**本 Host 实例**签发的
 * 租约端口（第 84 批，`createHostOperationResources(...).isDispatchLease`，经 `RuntimeManagementCommandHost.isDispatchLease`
 * 传入；不是模块级登记——插件自己调用公开的 `createHostOperationResources` 签出的端口不算），Host 侧再用真实
 * SnapshotStore 校验租约（`AgentRuntime.ownsLease`）。由插件中间件 / handler / 按钮回调经 `CommandIndex.dispatch`
 * 转发时 Host 不给租约（`dispatchLeaseWithheldToken`），调用方自造 `operation` 资源视图（或另一个工厂签发的端口）
 * 也拿不到：命令不执行，以 UserFacingError（原因 `direct_command_required`）拒绝，`dispatch` 结果的 `value` 是请用户
 * 直接发送该命令的提示（带消息的命令前缀），由转发的中间件回复出去；未传 `operation` 时 `CommandIndex.dispatch`
 * 自己把这条消息的结局记为 `refused` / `direct_command_required`。`memory` 不需要租约，照常执行。
 *
 * 必须配合 Host 资源：`createRuntimeManagementCommands` 要和同一个 `createHostOperationResources` 实例一起用——
 * 它的 `im` 端口提供给 `imOperationResourcesToken`，它的 `isDispatchLease` 传给本函数。缺了任何一样（嵌入方没接
 * Host 资源），需要租约的命令即使用户直接发送也不执行，回复「管理命令在此实例不可用」（原因
 * `management_unavailable`）。
 */
import { defineCommand, UserFacingError, type CommandContext, type CommandDefinition } from '@zhin.js/core/feature/command';
import type { Message } from '@zhin.js/core/runtime';
import type { InferenceClient } from '@zhin.js/ai/provider';
import type { Locale, SnapshotLease } from '@zhin.js/plugin-runtime';
import { managementMessages as t } from './management-messages.js';
import { asPrivate } from '../internal/as-private.js';
import { jumpSessionTree, listSessionTree } from '../session/session-tree-commands.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';
import { resolveRuntimeSenderRoles } from '../plugin-runtime/ingress/request-capabilities.js';
import { dispatchLeaseToken, dispatchLeaseWithheldToken, type DispatchLeasePort } from '../plugin-runtime/inference/dispatch-lease.js';

/** Management commands need any zhin chat role (`trusted` or higher) on the conversation's chain. */
export const RUNTIME_MANAGEMENT_PERMIT = 'trusted';

/** What one management command invocation reads for its message (held open until it settles). */
export interface RuntimeManagementOperation {
  /** The session the message's AI turn would use (the sender's own session; a live room's scene task). */
  readonly sessionKey: string;
  /** Trusted operation-bound directory; listing does not require a selected chat model. */
  readonly inference?: Pick<InferenceClient, 'list'>;
  /** Host resolves deployment-only summary authority lazily for model-using commands. */
  readonly withModelScope?: <T>(operation: () => Promise<T>) => Promise<T>;
  /**
   * ADR 0067 D8: sends a fixed-template reply and records it as this session's own delivery. Used
   * by `reset`, whose answers are fixed strings; other replies may carry stored content (memory,
   * session tree) and keep counting as background.
   */
  readonly replyFixed?: (text: string) => Promise<unknown>;
}

/** The command dispatch one management command runs in. */
export interface RuntimeManagementDispatch {
  readonly signal: AbortSignal;
  /**
   * An independent lease on the generation that dispatched the command (the IM runtime's own lease
   * for the message, retained). The management commands always set it (#1250 第 84 批: without a
   * Host-issued lease they do not run).
   */
  readonly retainLease?: () => SnapshotLease;
  /**
   * #1250 第 84 批: the message's conversation sequence, as the IM runtime recorded it (absent without
   * Host resources or when none was recorded): the clear path folds scene events up to it.
   */
  readonly conversationSequence?: number;
}

export interface RuntimeManagementCommandHost {
  readonly zhinAgent: ZhinAgent;
  /**
   * #1250 第 84 批: `isDispatchLease` of the `createHostOperationResources` instance whose `im` port this
   * Root provides (`imOperationResourcesToken`). Only the dispatch lease ports that instance issued
   * count; a port from any other factory (a plugin can call the public factory too) does not. Without
   * it (or without those operation resources), the commands that need the lease answer
   * `management_unavailable` even when sent directly.
   */
  readonly isDispatchLease: (port: unknown) => boolean;
  /**
   * Enables `memory` and `memory forget` (#734): anyone can view or forget the semantic memory
   * stored about themselves (their own `user` scope). Without it neither command is registered.
   */
  readonly semanticMemory?: SemanticMemoryRuntime | null;
  /** Opens the operation for `message`; resources it holds (a generation lease) end when `run` settles. */
  open<T>(message: Message, dispatch: RuntimeManagementDispatch, run: (operation: RuntimeManagementOperation) => Promise<T>): Promise<T>;
  /**
   * `reset` from a sender without a zhin chat role: exactly the chat clear command (`/clear`) for
   * `message` — the same clear path, AI trigger and mention requirements, confirmation cooldown and
   * control-plane / speaking gates; it replies itself (or stays silent).
   */
  clear(message: Message, dispatch: RuntimeManagementDispatch): Promise<void>;
}

/** One Root command: its local path (`memory/forget` → `memory forget`) and definition. */
export interface RuntimeManagementCommand {
  readonly name: string;
  readonly definition: CommandDefinition;
}

const MEMORY_LIST_LIMIT = 20;

const descriptions = {
  models: { 'zh-CN': '列出可用的语言模型', en: 'List the available language models' },
  health: { 'zh-CN': '查看 AI 服务健康状态', en: 'Show the AI service health' },
  tree: { 'zh-CN': '查看会话分支点，或跳转到第 N 个', en: 'List session branch points, or jump to point N' },
  fork: { 'zh-CN': '从第 N 个会话分支点继续', en: 'Continue from session branch point N' },
  compact: { 'zh-CN': '压缩当前会话的上下文', en: 'Compact the current session context' },
  reset: { 'zh-CN': '清空当前会话（受信任用户直接归档；其他人同 /clear）', en: 'Clear the current session (trusted users archive it; anyone else as with /clear)' },
  memory: { 'zh-CN': '查看关于你的记忆', en: 'Show the memories about you' },
  forget: { 'zh-CN': '遗忘关于你的记忆', en: 'Forget memories about you' },
} as const;

function described(key: keyof typeof descriptions): Pick<CommandDefinition, 'description' | 'descriptionI18n'> {
  return { description: descriptions[key]['zh-CN'], descriptionI18n: { en: descriptions[key].en } };
}

/** A management command declaration: a plain {@link CommandDefinition} without the runtime brand. */
type ManagementCommandInput = Omit<CommandDefinition, '$feature' | '$parameter'>;
/** What a management command's `execute` receives. */
type ManagementCommandContext = Parameters<CommandDefinition['execute']>[0];

/**
 * `defineCommand` (same runtime validation and branding) under a non-generic signature. The
 * authoring overload infers params / options / result across a union over every registered adapter;
 * these commands are stored as plain `CommandDefinition`s anyway, so that inference only costs type
 * checker time and memory (it pushed the repository type-check past the CI heap limit).
 */
const define = defineCommand as unknown as (definition: ManagementCommandInput) => CommandDefinition;

type CommandInput = Pick<CommandContext, 'input'>;
type CommandRun = Pick<CommandContext, 'signal' | 'has' | 'use'> & CommandInput;

function inputOf(command: CommandInput): Message {
  if (!command.input) throw new Error('Agent management commands need an inbound message');
  return command.input as unknown as Message;
}

/** Refusal code (ADR 0061 `refused` reason) of a management command a plugin forwarded. */
export const DIRECT_COMMAND_REQUIRED = 'direct_command_required';

/** Refusal code (ADR 0061 `refused` reason) of a management command on an instance without the Host's operation resources. */
export const MANAGEMENT_UNAVAILABLE = 'management_unavailable';

/**
 * #1250 第 84 批: the commands were registered without the Agent Host's operation resources (no
 * `isDispatchLease`, or the operation has neither the dispatch lease nor the withheld marker), so no
 * dispatch lease can ever be issued here. The sender reads that management commands are unavailable.
 */
class ManagementUnavailableError extends UserFacingError {
  constructor() {
    super('Management commands are not available on this instance', { reason: MANAGEMENT_UNAVAILABLE });
  }
  override format(locale?: Locale): string {
    return t(locale, 'managementUnavailable');
  }
}

/**
 * #1250 第 84 批: a plugin (middleware / handler / button callback) dispatched this command, so the Host
 * withheld the dispatch lease it needs. The sender reads a request to send the command directly.
 */
class DirectCommandRequiredError extends UserFacingError {
  readonly #command: string;
  constructor(command: string) {
    super(`Send ${command} directly`, { reason: DIRECT_COMMAND_REQUIRED });
    this.#command = command;
  }
  override format(locale?: Locale): string {
    return t(locale, 'directCommandRequired', { command: this.#command });
  }
}

/**
 * The dispatch of `command`: its signal and the dispatching generation (`name` is its path, for the
 * reply). Only a dispatch lease this Host instance issued counts (#1250 第 84 批, `isDispatchLease`):
 * - a plugin-dispatched Root operation has the Host resources without it (`dispatchLeaseWithheldToken`),
 *   and a resource view a caller supplied itself (an explicit `operation` factory answering `has` /
 *   `use` for the lease token, or holding a port another `createHostOperationResources` issued) holds
 *   no lease of this Host either: the command does not run and the sender reads a request to send it
 *   directly (`direct_command_required`);
 * - with no Host resources at all (no `isDispatchLease`, or neither the lease nor the withheld marker:
 *   the embedder did not wire `createHostOperationResources`), the command does not run and the
 *   sender reads that management commands are unavailable here (`management_unavailable`).
 */
function dispatchOf(host: RuntimeManagementCommandHost, command: CommandRun & Pick<CommandContext, 'formatCommand'>, name: string): RuntimeManagementDispatch {
  const withheld = command.has(dispatchLeaseWithheldToken);
  const offered = !withheld && command.has(dispatchLeaseToken);
  if (typeof host.isDispatchLease !== 'function' || (!withheld && !offered)) throw new ManagementUnavailableError();
  const port = offered ? command.use(dispatchLeaseToken) : undefined;
  if (!offered || !host.isDispatchLease(port)) throw new DirectCommandRequiredError(command.formatCommand(name) ?? name);
  const issued = port as DispatchLeasePort;
  return { signal: command.signal, retainLease: () => issued.retain(),
    ...(issued.conversationSequence !== undefined ? { conversationSequence: issued.conversationSequence } : {}) };
}

async function listLanguageProfiles(operation: RuntimeManagementOperation) {
  if (!operation.inference) throw new Error('Inference operation is not configured');
  return operation.inference.list({ kind: 'language' });
}

/** Model-using commands (`tree N`, `fork`, `compact`) need the Host model operation; without it they fail. */
function withModelScope<T>(operation: RuntimeManagementOperation, run: () => Promise<T>): Promise<T> {
  if (!operation.withModelScope) throw new Error('The Host model operation is unavailable');
  return operation.withModelScope(run);
}

/**
 * The Agent's Root management commands: `models`, `health`, `tree`, `fork`, `compact`, `reset`, and —
 * with semantic memory — `memory` / `memory forget`. No execution policy: like before, they have no
 * cooldown (the operator-only ones are not reachable by bystanders, `memory` reads only the sender's
 * own entries, `reset` from anyone else is the clear command with its own confirmation cooldown).
 *
 * Must be used with the Host's operation resources (#1250 第 84 批): one `createHostOperationResources`
 * instance whose `im` port the Root provides as `imOperationResourcesToken` and whose `isDispatchLease`
 * is passed here as `host.isDispatchLease`. Without them the commands that need the dispatch lease
 * (`models` / `health` / `tree` / `fork` / `compact` / `reset`) never run and answer
 * `management_unavailable`, even when sent directly.
 */
export function createRuntimeManagementCommands(host: RuntimeManagementCommandHost): readonly RuntimeManagementCommand[] {
  const agent = () => asPrivate(host.zhinAgent);
  const open = <T>(name: string, command: CommandRun & Pick<CommandContext, 'formatCommand'>, run: (operation: RuntimeManagementOperation) => Promise<T>) =>
    host.open(inputOf(command), dispatchOf(host, command, name), run);
  const commands: RuntimeManagementCommand[] = [
    {
      name: 'models',
      definition: define({
        ...described('models'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => open('models', command, async operation => {
          const profiles = await listLanguageProfiles(operation);
          return [t(command.locale, 'models'), ...profiles.map(profile => `  • ${profile.label ?? profile.reference.id} (${profile.model})`)].join('\n');
        }),
      }),
    },
    {
      name: 'health',
      definition: define({
        ...described('health'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => open('health', command, async operation => {
          const profiles = await listLanguageProfiles(operation);
          return `${t(command.locale, 'health')}\n${profiles.length} configured language profiles`;
        }),
      }),
    },
    {
      name: 'tree',
      definition: define({
        ...described('tree'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        params: { index: { type: 'integer', optional: true, min: 1, description: '分支点编号', descriptionI18n: { en: 'Branch point number' } } },
        execute: command => open('tree', command, async operation => {
          const index = command.params.index;
          if (typeof index === 'number') {
            return withModelScope(operation, () => jumpSessionTree(agent(), operation.sessionKey, index, command.locale));
          }
          const tree = command.formatCommand('tree');
          const fork = command.formatCommand('fork');
          return listSessionTree(agent(), operation.sessionKey, { locale: command.locale,
            ...(tree !== undefined && fork !== undefined ? { references: { tree, fork } } : {}) });
        }),
      }),
    },
    {
      name: 'fork',
      definition: define({
        ...described('fork'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        params: { index: { type: 'integer', min: 1, description: '分支点编号', descriptionI18n: { en: 'Branch point number' } } },
        execute: command => open('fork', command, operation =>
          // `index` is a required `integer` param: the command module parses it before `execute` runs.
          withModelScope(operation, () => jumpSessionTree(agent(), operation.sessionKey, command.params.index as number, command.locale))),
      }),
    },
    {
      name: 'compact',
      definition: define({
        ...described('compact'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => open('compact', command, async operation => {
          const result = await withModelScope(operation, () => host.zhinAgent.compactSession(operation.sessionKey, command.locale));
          return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
        }),
      }),
    },
    {
      name: 'reset',
      definition: define({
        // No permit: open to everyone, so the menu lists it for everyone. A trusted sender archives
        // the session the message's AI turn would use (in a live room the shared scene task too),
        // always, with a fixed confirmation; anyone else gets exactly the clear command (`/clear`),
        // which only acts where the AI answers them and only clears their own session.
        ...described('reset'), options: {},
        execute: async command => {
          const message = inputOf(command);
          if (resolveRuntimeSenderRoles(message).hostRole === undefined) {
            await host.clear(message, dispatchOf(host, command, 'reset'));
            return undefined;
          }
          return open('reset', command, async operation => {
            const text = t(command.locale, await host.zhinAgent.archiveSession(operation.sessionKey) ? 'archived' : 'noSession');
            if (!operation.replyFixed) return text;
            await operation.replyFixed(text);
            return undefined;
          });
        },
      }),
    },
  ];
  const memory = host.semanticMemory;
  if (memory) commands.push(...memoryCommands(memory));
  return Object.freeze(commands);
}

/**
 * `memory` lists and `memory forget <key|id|all>` deletes the sender's own user-scope memory. The
 * list is shown in a private chat only: in a group or channel `memory` answers with a pointer to the
 * private chat, and `memory forget` answers with a count, never with memory content.
 */
function memoryCommands(runtime: SemanticMemoryRuntime): RuntimeManagementCommand[] {
  const scopeOf = (command: ManagementCommandContext): Readonly<{ scope: 'user'; scope_key: string }> | string => {
    if (!runtime.active) return t(command.locale, 'memoryUnavailable');
    const senderId = inputOf(command).sender?.id?.trim();
    return senderId ? { scope: 'user', scope_key: senderId } : t(command.locale, 'memoryIdentity');
  };
  const forgetCommand = (command: ManagementCommandContext) => command.formatCommand('memory forget') ?? 'memory forget';
  return [
    {
      name: 'memory',
      definition: define({
        ...described('memory'), options: {},
        execute: async command => {
          const scope = scopeOf(command);
          if (typeof scope === 'string') return scope;
          if (inputOf(command).conversation.kind !== 'private') {
            return t(command.locale, 'memoryPrivateOnly', { command: command.formatCommand('memory') ?? 'memory' });
          }
          const entries = await runtime.list({ ...scope, limit: MEMORY_LIST_LIMIT }, command.signal);
          if (entries.length === 0) return t(command.locale, 'noMemory');
          return [t(command.locale, 'memories', { count: entries.length })]
            .concat(entries.map((entry, index) => `${index + 1}. ${entry.key}: ${entry.content}  [id ${entry.id}]`))
            .concat(t(command.locale, 'forgetHint', { command: forgetCommand(command) }))
            .join('\n');
        },
      }),
    },
    {
      name: 'memory/forget',
      definition: define({
        ...described('forget'), options: {},
        execute: async command => {
          const scope = scopeOf(command);
          if (typeof scope === 'string') return scope;
          const target = command.args.join(' ').trim();
          if (!target) return t(command.locale, 'forgetUsage', { command: forgetCommand(command) });
          const entries = await runtime.list({ ...scope, limit: Number.MAX_SAFE_INTEGER }, command.signal);
          const matches = target.toLowerCase() === 'all'
            ? entries
            : entries.filter(entry => entry.id === target || entry.key === target);
          if (matches.length === 0) return t(command.locale, 'noMatch', { target });
          for (const entry of matches) await runtime.delete(entry.id, command.signal);
          // A count only (also in a group): the forgotten entries are never echoed.
          return t(command.locale, 'forgotten', { count: matches.length });
        },
      }),
    },
  ];
}
