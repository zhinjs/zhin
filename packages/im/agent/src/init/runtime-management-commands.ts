/**
 * Agent 管理命令（zhinjs/zhin#1250 第 83 批）：Root 命令，由 Agent Host 注册到 Command Feature。
 *
 * 和其他 Root 命令一样走命令分发（MessageDispatcher）：出现在菜单 / 帮助里，有近似指令提示，参数由
 * 命令模块解析，结局记 `command_replied`，权限走 permit DSL（`trusted`：本会话链上任一 zhin 聊天角色，
 * 与原来的 `hostRole !== undefined` 等价）。群里无权限者静默（`permission_denied`），私聊说明原因。
 * 命令认领的消息不进 AI 回合。
 */
import { defineCommand, type CommandContext, type CommandDefinition } from '@zhin.js/core/feature/command';
import { reportInboundOutcome, type Message } from '@zhin.js/core/runtime';
import type { InferenceClient } from '@zhin.js/ai/provider';
import { describeCommandDenial } from '@zhin.js/permission';
import { managementMessages as t } from './management-messages.js';
import { asPrivate } from '../internal/as-private.js';
import { jumpSessionTree, listSessionTree } from '../session/session-tree-commands.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';
import { resolveRuntimeSenderRoles } from '../plugin-runtime/ingress/request-capabilities.js';

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

export interface RuntimeManagementCommandHost {
  readonly zhinAgent: ZhinAgent;
  /**
   * Enables `memory` and `memory forget` (#734): anyone can view or forget the semantic memory
   * stored about themselves (their own `user` scope). Without it neither command is registered.
   */
  readonly semanticMemory?: SemanticMemoryRuntime | null;
  /** Opens the operation for `message`; resources it holds (a generation lease) end when `run` settles. */
  open<T>(message: Message, signal: AbortSignal, run: (operation: RuntimeManagementOperation) => Promise<T>): Promise<T>;
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
  reset: { 'zh-CN': '归档当前会话（主人或受信任用户）', en: 'Archive the current session (owners and trusted users)' },
  memory: { 'zh-CN': '查看关于你的记忆', en: 'Show the memories about you' },
  forget: { 'zh-CN': '遗忘关于你的记忆', en: 'Forget memories about you' },
} as const;

function described(key: keyof typeof descriptions): Pick<CommandDefinition, 'description' | 'descriptionI18n'> {
  return { description: descriptions[key]['zh-CN'], descriptionI18n: { en: descriptions[key].en } };
}

function inputOf(command: CommandContext): Message {
  if (!command.input) throw new Error('Agent management commands need an inbound message');
  return command.input as unknown as Message;
}

/**
 * `reset` keeps its own refusal (it points everyone else at the clear command), so it checks the
 * permit itself: the same `permission_denied` outcome as a permit refusal, silent in a group or
 * channel, the reason in a private chat.
 */
function refuseReset(command: CommandContext): string | undefined {
  const message = inputOf(command);
  const quiet = message.conversation.kind !== 'private';
  reportInboundOutcome(message, {
    outcome: 'permission_denied', reason: 'not_operator', stage: 'command', command: 'reset', reply: quiet ? 'no' : 'yes',
  });
  return quiet ? undefined : t(command.locale, 'resetDenied', { denial: describeCommandDenial(RUNTIME_MANAGEMENT_PERMIT, command.locale) });
}

async function listLanguageProfiles(operation: RuntimeManagementOperation) {
  if (!operation.inference) throw new Error('Inference operation is not configured');
  return operation.inference.list({ kind: 'language' });
}

function withModelScope<T>(operation: RuntimeManagementOperation, run: () => Promise<T>): Promise<T> {
  return operation.withModelScope ? operation.withModelScope(run) : run();
}

/**
 * The Agent's Root management commands: `models`, `health`, `tree`, `fork`, `compact`, `reset`, and —
 * with semantic memory — `memory` / `memory forget`. No execution policy: like before, they have no
 * cooldown (the operator-only ones are not reachable by bystanders, `memory` reads only the sender's
 * own entries).
 */
export function createRuntimeManagementCommands(host: RuntimeManagementCommandHost): readonly RuntimeManagementCommand[] {
  const agent = () => asPrivate(host.zhinAgent);
  const open = <T>(command: CommandContext, run: (operation: RuntimeManagementOperation) => Promise<T>) =>
    host.open(inputOf(command), command.signal, run);
  const commands: RuntimeManagementCommand[] = [
    {
      name: 'models',
      definition: defineCommand({
        ...described('models'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => open(command, async operation => {
          const profiles = await listLanguageProfiles(operation);
          return [t(command.locale, 'models'), ...profiles.map(profile => `  • ${profile.label ?? profile.reference.id} (${profile.model})`)].join('\n');
        }),
      }),
    },
    {
      name: 'health',
      definition: defineCommand({
        ...described('health'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => open(command, async operation => {
          const profiles = await listLanguageProfiles(operation);
          return `${t(command.locale, 'health')}\n${profiles.length} configured language profiles`;
        }),
      }),
    },
    {
      name: 'tree',
      definition: defineCommand({
        ...described('tree'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        params: { index: { type: 'integer', optional: true, min: 1, description: '分支点编号', descriptionI18n: { en: 'Branch point number' } } },
        execute: command => open(command, async operation => {
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
      definition: defineCommand({
        ...described('fork'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        params: { index: { type: 'integer', min: 1, description: '分支点编号', descriptionI18n: { en: 'Branch point number' } } },
        execute: command => open(command, operation =>
          withModelScope(operation, () => jumpSessionTree(agent(), operation.sessionKey, command.params.index, command.locale))),
      }),
    },
    {
      name: 'compact',
      definition: defineCommand({
        ...described('compact'), permit: [RUNTIME_MANAGEMENT_PERMIT], options: {},
        execute: command => open(command, async operation => {
          const result = await withModelScope(operation, () => host.zhinAgent.compactSession(operation.sessionKey, command.locale));
          return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
        }),
      }),
    },
    {
      name: 'reset',
      definition: defineCommand({
        // No declarative permit: the refusal also says how to clear one's own context (see refuseReset).
        ...described('reset'), options: {},
        execute: async command => {
          if (resolveRuntimeSenderRoles(inputOf(command)).hostRole === undefined) return refuseReset(command);
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

/** `memory` lists and `memory forget <key|id|all>` deletes the sender's own user-scope memory. */
function memoryCommands(runtime: SemanticMemoryRuntime): RuntimeManagementCommand[] {
  const scopeOf = (command: CommandContext): Readonly<{ scope: 'user'; scope_key: string }> | string => {
    if (!runtime.active) return t(command.locale, 'memoryUnavailable');
    const senderId = inputOf(command).sender?.id?.trim();
    return senderId ? { scope: 'user', scope_key: senderId } : t(command.locale, 'memoryIdentity');
  };
  const forgetCommand = (command: CommandContext) => command.formatCommand('memory forget') ?? 'memory forget';
  return [
    {
      name: 'memory',
      definition: defineCommand({
        ...described('memory'), options: {},
        execute: async command => {
          const scope = scopeOf(command);
          if (typeof scope === 'string') return scope;
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
      definition: defineCommand({
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
          return t(command.locale, 'forgotten', { count: matches.length });
        },
      }),
    },
  ];
}
