/**
 * Plugin Runtime 管理命令面。
 *
 * 由 Agent Host 在 unmatched route 前拦截，不进入普通 Agent turn。
 */
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

export type RuntimeManagementDeps = {
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

function denyOperator(): string {
  return '⚠️ 仅 master / trusted 可使用此管理指令。';
}

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
  const text = deps.content.trim();
  if (!text) return null;

  const isOperator = deps.senderRoles.isMaster || deps.senderRoles.isTrusted;
  const agent = asPrivate(deps.zhinAgent);

  if (/^\/models\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const models = await deps.service.listModels();
    let r = '🤖 可用模型:\n';
    for (const { provider, models: ml } of models) {
      r += `\n【${provider}】\n` + ml.slice(0, 5).map((m) => `  • ${m}`).join('\n');
      if (ml.length > 5) r += `\n  ... 还有 ${ml.length - 5} 个`;
    }
    return r;
  }

  if (/^\/tree\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    return listSessionTree(agent, deps.sessionKey);
  }

  const treeJump = text.match(/^\/tree\s+(\d+)\s*$/iu);
  if (treeJump) {
    if (!isOperator) return denyOperator();
    const n = parseLeadingInt(treeJump[1] ?? '');
    if (n == null) return 'ℹ️ 用法：/tree 2';
    return jumpSessionTree(agent, deps.sessionKey, n);
  }

  const fork = text.match(/^\/fork\s+(\d+)\s*$/iu);
  if (fork) {
    if (!isOperator) return denyOperator();
    const n = parseLeadingInt(fork[1] ?? '');
    if (n == null) return 'ℹ️ 用法：/fork 2';
    return jumpSessionTree(agent, deps.sessionKey, n);
  }

  if (/^\/compact\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const result = await deps.zhinAgent.compactSession(deps.sessionKey);
    return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
  }

  if (/^\/reset\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const ok = await deps.zhinAgent.archiveSession(deps.sessionKey);
    return ok ? '✅ 已归档当前会话，下次 @ 将使用新上下文' : 'ℹ️ 无活跃会话可归档';
  }

  const memoryReply = await handleOwnMemoryCommand(deps, text);
  if (memoryReply != null) return memoryReply;

  if (/^ai\.health\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const health = await deps.service.healthCheck();
    return ['🏥 AI 服务健康状态:'].concat(
      Object.entries(health).map(([p, ok]) => `  ${ok ? '✅' : '❌'} ${p}`),
    ).join('\n');
  }

  return null;
}

/** `/memory` lists and `/forget <key|id|all>` deletes the sender's own user-scope memory. */
async function handleOwnMemoryCommand(deps: RuntimeManagementDeps, text: string): Promise<string | null> {
  const runtime = deps.semanticMemory;
  const isList = /^\/memory\s*$/iu.test(text);
  // Prefix test plus slice (no backtracking regex over user input).
  const isForget = /^\/forget(?:\s|$)/iu.test(text);
  if (!isList && !isForget) return null;
  if (!runtime?.active || !deps.senderId) return null;
  const signal = new AbortController().signal;
  const scope = { scope: 'user' as const, scope_key: deps.senderId };

  if (isList) {
    const entries = await runtime.list({ ...scope, limit: MEMORY_LIST_LIMIT }, signal);
    if (entries.length === 0) return 'ℹ️ 目前没有关于你的记忆。';
    return [`🧠 关于你的记忆（${entries.length} 条）：`]
      .concat(entries.map((entry, index) => `${index + 1}. ${entry.key}: ${entry.content}  [id ${entry.id}]`))
      .concat('发送 /forget <key 或 id> 遗忘一条，/forget all 全部遗忘。')
      .join('\n');
  }

  const target = text.slice('/forget'.length).trim();
  if (!target) return 'ℹ️ 用法：/forget <key 或 id>，或 /forget all';
  const entries = await runtime.list({ ...scope, limit: Number.MAX_SAFE_INTEGER }, signal);
  const matches = target.toLowerCase() === 'all'
    ? entries
    : entries.filter((entry) => entry.id === target || entry.key === target);
  if (matches.length === 0) return `ℹ️ 没有找到关于你的记忆 "${target}"。`;
  for (const entry of matches) await runtime.delete(entry.id, signal);
  return `✅ 已遗忘 ${matches.length} 条关于你的记忆。`;
}
