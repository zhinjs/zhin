/**
 * Plugin Runtime 管理命令面。
 *
 * 由 Agent Host 在 unmatched route 前拦截，不进入普通 Agent turn。
 */
import { managementMessages as t } from './management-messages.js';
import { managementCommandText, managementCommandReference, type AgentCommandPresentation } from './command-presentation.js';
import type { AIService } from '../service.js';
import { asPrivate } from '../internal/as-private.js';
import {
  jumpSessionTree,
  listSessionTree,
} from '../session/session-tree-commands.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';

export type RuntimeManagementSenderRoles = {
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
};

export type RuntimeManagementDeps = AgentCommandPresentation & {
  readonly service: AIService;
  readonly zhinAgent: ZhinAgent;
  readonly sessionKey: string;
  readonly content: string;
  readonly senderRoles: RuntimeManagementSenderRoles;
  /**
   * Enables `/memory` and `/forget` (#734): anyone can view or forget the
   * semantic memory stored about themselves (their own `user` scope). Without
   * it these commands pass through.
   */
  readonly semanticMemory?: SemanticMemoryRuntime | null;
  readonly senderId?: string;
};

const MEMORY_LIST_LIMIT = 20;

function parseLeadingInt(rest: string): number | undefined {
  const n = Number.parseInt(rest.trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * 若 `content` 是管理命令则返回回复文案；否则 `null`（交回 AI / 其它处理）。
 */
export async function handleRuntimeManagementCommand(
  deps: RuntimeManagementDeps,
): Promise<string | null> {
  // ai.health is an existing explicit bare entry, independent of the prefixed commands.
  const bareHealth = /^ai\.health\s*$/iu.test(deps.content.trim());
  const text = managementCommandText(deps.content, deps.commandPrefix);
  if (!text && !bareHealth) return null;
  const locale = deps.locale;
  const command = (name: string) => managementCommandReference(name, deps.commandPrefix)!;

  const isOperator = deps.senderRoles.isMaster || deps.senderRoles.isTrusted;
  const agent = asPrivate(deps.zhinAgent);

  if (/^models\s*$/iu.test(text ?? '')) {
    if (!isOperator) return t(locale, 'denied');
    const models = await deps.service.listModels();
    let r = t(locale, 'models') + '\n';
    for (const { provider, models: ml } of models) {
      r += `\n【${provider}】\n` + ml.slice(0, 5).map((m) => `  • ${m}`).join('\n');
      if (ml.length > 5) r += '\n' + t(locale, 'more', { count: ml.length - 5 });
    }
    return r;
  }

  if (/^tree\s*$/iu.test(text ?? '')) {
    if (!isOperator) return t(locale, 'denied');
    return listSessionTree(agent, deps.sessionKey, deps);
  }

  const treeJump = text?.match(/^tree\s+(\d+)\s*$/iu);
  if (treeJump) {
    if (!isOperator) return t(locale, 'denied');
    const n = parseLeadingInt(treeJump[1] ?? '');
    if (n == null) return t(locale, 'usage', { command: command('tree') + ' 2' });
    return jumpSessionTree(agent, deps.sessionKey, n, locale);
  }

  const fork = text?.match(/^fork\s+(\d+)\s*$/iu);
  if (fork) {
    if (!isOperator) return t(locale, 'denied');
    const n = parseLeadingInt(fork[1] ?? '');
    if (n == null) return t(locale, 'usage', { command: command('fork') + ' 2' });
    return jumpSessionTree(agent, deps.sessionKey, n, locale);
  }

  if (/^compact\s*$/iu.test(text ?? '')) {
    if (!isOperator) return t(locale, 'denied');
    const result = await deps.zhinAgent.compactSession(deps.sessionKey, locale);
    return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
  }

  if (/^reset\s*$/iu.test(text ?? '')) {
    if (!isOperator) return t(locale, 'denied');
    const ok = await deps.zhinAgent.archiveSession(deps.sessionKey);
    return t(locale, ok ? 'archived' : 'noSession');
  }

  const memoryReply = await handleOwnMemoryCommand(deps, text ?? '');
  if (memoryReply != null) return memoryReply;

  if (bareHealth) {
    if (!isOperator) return t(locale, 'denied');
    const health = await deps.service.healthCheck();
    return [t(locale, 'health')].concat(
      Object.entries(health).map(([p, ok]) => `  ${ok ? '✅' : '❌'} ${p}`),
    ).join('\n');
  }

  return null;
}

/** `/memory` lists and `/forget <key|id|all>` deletes the sender's own user-scope memory. */
async function handleOwnMemoryCommand(deps: RuntimeManagementDeps, text: string): Promise<string | null> {
  const locale = deps.locale;
  const command = managementCommandReference('forget', deps.commandPrefix)!;
  const runtime = deps.semanticMemory;
  const isList = /^memory\s*$/iu.test(text ?? '');
  // Prefix test plus slice (no backtracking regex over user input).
  const isForget = /^forget(?:\s|$)/iu.test(text ?? '');
  if (!isList && !isForget) return null;
  if (!runtime?.active || !deps.senderId) return null;
  const signal = new AbortController().signal;
  const scope = { scope: 'user' as const, scope_key: deps.senderId };

  if (isList) {
    const entries = await runtime.list({ ...scope, limit: MEMORY_LIST_LIMIT }, signal);
    if (entries.length === 0) return t(locale, 'noMemory');
    return [t(locale, 'memories', { count: entries.length })]
      .concat(entries.map((entry, index) => `${index + 1}. ${entry.key}: ${entry.content}  [id ${entry.id}]`))
      .concat(t(locale, 'forgetHint', { command }))
      .join('\n');
  }

  const target = text.slice('forget'.length).trim();
  if (!target) return t(locale, 'forgetUsage', { command });
  const entries = await runtime.list({ ...scope, limit: Number.MAX_SAFE_INTEGER }, signal);
  const matches = target.toLowerCase() === 'all'
    ? entries
    : entries.filter((entry) => entry.id === target || entry.key === target);
  if (matches.length === 0) return t(locale, 'noMatch', { target });
  for (const entry of matches) await runtime.delete(entry.id, signal);
  return t(locale, 'forgotten', { count: matches.length });
}
