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
 * 只接受人类来源：消息 `origin`（或 `metadata.origin`）不是 `human` 时静默不回复，记 `filtered_by_policy`
 * / `non_human_origin`，与改前 Agent 入站对非人类来源的处理一致。
 */
import { defineCommand, type CommandContext, type CommandDefinition } from '@zhin.js/core/feature/command';
import { reportInboundOutcome, type Message } from '@zhin.js/core/runtime';
import type { InferenceClient } from '@zhin.js/ai/provider';
import type { SnapshotLease } from '@zhin.js/plugin-runtime';
import { managementMessages as t } from './management-messages.js';
import { asPrivate } from '../internal/as-private.js';
import { jumpSessionTree, listSessionTree } from '../session/session-tree-commands.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';
import { isNonHumanOrigin, resolveRuntimeSenderRoles } from '../plugin-runtime/ingress/request-capabilities.js';
import { dispatchLeaseToken } from '../plugin-runtime/inference/dispatch-lease.js';

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
   * for the message, retained); absent when the operation has no Host resources.
   */
  readonly retainLease?: () => SnapshotLease;
}

export interface RuntimeManagementCommandHost {
  readonly zhinAgent: ZhinAgent;
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

/** The dispatch of `command`: its signal and, with Host resources, the dispatching generation. */
function dispatchOf(command: CommandRun): RuntimeManagementDispatch {
  if (!command.has(dispatchLeaseToken)) return { signal: command.signal };
  const port = command.use(dispatchLeaseToken);
  return { signal: command.signal, retainLease: () => port.retain() };
}

/**
 * Management commands answer people only: `true` (and the outcome recorded) for a message from
 * another bot (origin other than `human`), which then gets no reply and runs nothing, like the Agent
 * ingress before these became Root commands. `filtered_by_policy` / `non_human_origin` outranks the
 * dispatch's own `command_replied`.
 */
function fromBot(name: string, command: CommandInput): boolean {
  const message = inputOf(command);
  if (!isNonHumanOrigin(message)) return false;
  reportInboundOutcome(message, { outcome: 'filtered_by_policy', reason: 'non_human_origin', stage: 'command', command: name });
  return true;
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
 */
export function createRuntimeManagementCommands(host: RuntimeManagementCommandHost): readonly RuntimeManagementCommand[] {
  const agent = () => asPrivate(host.zhinAgent);
  const open = <T>(command: CommandRun, run: (operation: RuntimeManagementOperation) => Promise<T>) =>
    host.open(inputOf(command), dispatchOf(command), run);
  const commands: RuntimeManagementCommand[] = [
    {
      name: 'models',
      definition: define({
        ...described('models'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => fromBot('models', command) ? undefined : open(command, async operation => {
          const profiles = await listLanguageProfiles(operation);
          return [t(command.locale, 'models'), ...profiles.map(profile => `  • ${profile.label ?? profile.reference.id} (${profile.model})`)].join('\n');
        }),
      }),
    },
    {
      name: 'health',
      definition: define({
        ...described('health'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => fromBot('health', command) ? undefined : open(command, async operation => {
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
        execute: command => fromBot('tree', command) ? undefined : open(command, async operation => {
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
        execute: command => fromBot('fork', command) ? undefined : open(command, operation =>
          // `index` is a required `integer` param: the command module parses it before `execute` runs.
          withModelScope(operation, () => jumpSessionTree(agent(), operation.sessionKey, command.params.index as number, command.locale))),
      }),
    },
    {
      name: 'compact',
      definition: define({
        ...described('compact'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => fromBot('compact', command) ? undefined : open(command, async operation => {
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
          if (fromBot('reset', command)) return undefined;
          const message = inputOf(command);
          if (resolveRuntimeSenderRoles(message).hostRole === undefined) {
            await host.clear(message, dispatchOf(command));
            return undefined;
          }
          return open(command, async operation => {
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
          if (fromBot('memory', command)) return undefined;
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
          if (fromBot('memory forget', command)) return undefined;
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
