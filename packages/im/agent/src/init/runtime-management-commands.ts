/**
 * Plugin Runtime 管理命令面。
 *
 * 由 Agent Host 在 unmatched route 前拦截，不进入普通 Agent turn。
 */
import type { ChatRole } from '@zhin.js/core';
import { describeCommandDenial } from '@zhin.js/permission';
import { managementMessages as t } from './management-messages.js';
import { managementCommandText, managementCommandReference, type AgentCommandPresentation } from './command-presentation.js';
import type { AIService } from '../service.js';
import type { InferenceClient } from '@zhin.js/ai/provider';
import { asPrivate } from '../internal/as-private.js';
import {
  jumpSessionTree,
  listSessionTree,
} from '../session/session-tree-commands.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';

/** The sender's host-wide chat role (`RuntimeSenderRoles` of the Agent ingress). */
export type RuntimeManagementSenderRoles = {
  readonly hostRole?: ChatRole;
};

/** Management commands need any zhin chat role (`trusted` or higher) on the conversation's chain. */
const CHAT_ROLE_PERMIT = 'trusted';

export type RuntimeManagementDeps = AgentCommandPresentation & {
  readonly service: AIService;
  /** Trusted operation-bound directory; listing does not require a selected chat model. */
  readonly inference?: Pick<InferenceClient, 'list'>;
  /** Host resolves deployment-only summary authority lazily for model-using commands. */
  readonly withModelScope?: <T>(operation: () => Promise<T>) => Promise<T>;
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
  /**
   * zhinjs/zhin#1250: called when the reply is a refusal because the sender lacks the operator role
   * (`reason`: closed code). The ingress then answers only in a private chat and stays silent in a
   * group or channel; the returned text is unchanged.
   */
  readonly onUnauthorized?: (reason: string) => void;
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

  // Any zhin chat role on this conversation's chain: the permit `trusted`, whose refusal says so.
  const isOperator = deps.senderRoles.hostRole !== undefined;
  const agent = asPrivate(deps.zhinAgent);
  const denied = (text: string): string => {
    deps.onUnauthorized?.('not_operator');
    return text;
  };

  if (/^models\s*$/iu.test(text ?? '')) {
    if (!isOperator) return denied(describeCommandDenial(CHAT_ROLE_PERMIT, locale));
    if (!deps.inference) throw new Error('Inference operation is not configured');
    const profiles = await deps.inference.list({ kind: 'language' });
    const r = [t(locale, 'models'), ...profiles.map(profile => `  • ${profile.label ?? profile.reference.id} (${profile.model})`)].join('\n');
    return r;
  }

  if (/^tree\s*$/iu.test(text ?? '')) {
    if (!isOperator) return denied(describeCommandDenial(CHAT_ROLE_PERMIT, locale));
    return listSessionTree(agent, deps.sessionKey, deps);
  }

  const treeJump = text?.match(/^tree\s+(\d+)\s*$/iu);
  if (treeJump) {
    if (!isOperator) return denied(describeCommandDenial(CHAT_ROLE_PERMIT, locale));
    const n = parseLeadingInt(treeJump[1] ?? '');
    if (n == null) return t(locale, 'usage', { command: command('tree') + ' 2' });
    return deps.withModelScope
      ? deps.withModelScope(() => jumpSessionTree(agent, deps.sessionKey, n, locale))
      : jumpSessionTree(agent, deps.sessionKey, n, locale);
  }

  const fork = text?.match(/^fork\s+(\d+)\s*$/iu);
  if (fork) {
    if (!isOperator) return denied(describeCommandDenial(CHAT_ROLE_PERMIT, locale));
    const n = parseLeadingInt(fork[1] ?? '');
    if (n == null) return t(locale, 'usage', { command: command('fork') + ' 2' });
    return deps.withModelScope
      ? deps.withModelScope(() => jumpSessionTree(agent, deps.sessionKey, n, locale))
      : jumpSessionTree(agent, deps.sessionKey, n, locale);
  }

  if (/^compact\s*$/iu.test(text ?? '')) {
    if (!isOperator) return denied(describeCommandDenial(CHAT_ROLE_PERMIT, locale));
    const compact = () => deps.zhinAgent.compactSession(deps.sessionKey, locale);
    const result = await (deps.withModelScope ? deps.withModelScope(compact) : compact());
    return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
  }

  if (/^reset\s*$/iu.test(text ?? '')) {
    // #1250: reset stays operator-only; everyone else is pointed at the clear command, which clears
    // the same (their own) session context.
    if (!isOperator) return denied(t(locale, 'resetDenied', { command: command('reset') }));
    const ok = await deps.zhinAgent.archiveSession(deps.sessionKey);
    return t(locale, ok ? 'archived' : 'noSession');
  }

  const memoryReply = await handleOwnMemoryCommand(deps, text ?? '');
  if (memoryReply != null) return memoryReply;

  if (bareHealth) {
    if (!isOperator) return denied(describeCommandDenial(CHAT_ROLE_PERMIT, locale));
    if (!deps.inference) throw new Error('Inference operation is not configured');
    const profiles = await deps.inference.list({ kind: 'language' });
    return `${t(locale, 'health')}\n${profiles.length} configured language profiles`;

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
