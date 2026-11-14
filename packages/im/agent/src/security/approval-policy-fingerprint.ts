/**
 * Approval-policy snapshot (#1250 `agent-stale-failure-memory`).
 *
 * A tool denial stays in the session history. After the owner relaxes the policy (for example
 * `execApprovalMode: ask` → `auto`), the model used to read its old denial as a fact ("真建不了")
 * and refuse without trying. Each denial the model sees is therefore stamped with the policy it was
 * decided under, and a turn whose history still holds denials from a different policy gets one
 * context note: the policy changed, those refusals may no longer apply, try again when the user
 * still wants it.
 *
 * The fingerprint covers the approval-relevant configuration plus {@link APPROVAL_POLICY_REVISION},
 * which is bumped when the framework's own approval rules change (#1250 memory tier = revision 2).
 * Detection reads only the history, so it survives restarts and config reloads.
 */
import { createHash } from 'node:crypto';
import type { AgentMessage } from '@zhin.js/ai';

/** Bump when built-in approval rules change in a way that can turn an earlier denial into an allow. */
export const APPROVAL_POLICY_REVISION = 2;

/** Configuration keys that decide whether a tool call is approved, asked or refused. */
const APPROVAL_KEYS = [
  'execApprovalMode',
  'masterShell',
  'masterShellApprovalMode',
  'execSecurity',
  'execPreset',
  'execAllowlist',
  'network',
  'disabledTools',
  'allowedTools',
  'injectionGuard',
  'toolHardGate',
] as const;

export interface ApprovalPolicySnapshot {
  /** 8 hex chars; changes whenever an approval-relevant setting or the rule revision changes. */
  readonly fingerprint: string;
  /** Short human-readable description of the main switches. */
  readonly summary: string;
}

export function approvalPolicySnapshot(config: object | undefined): ApprovalPolicySnapshot {
  const source = (config ?? {}) as Record<string, unknown>;
  const relevant = Object.fromEntries(APPROVAL_KEYS.map(key => [key, source[key] ?? null]));
  const fingerprint = createHash('sha256')
    .update(stableJson({ revision: APPROVAL_POLICY_REVISION, ...relevant }))
    .digest('hex')
    .slice(0, 8);
  const guard = source.injectionGuard as { confirmHighRisk?: unknown } | undefined;
  const summary = [
    `execApprovalMode=${String(source.execApprovalMode ?? 'auto')}`,
    `confirmHighRisk=${String(guard?.confirmHighRisk ?? 'external_content')}`,
    `rules=r${APPROVAL_POLICY_REVISION}`,
  ].join(', ');
  return Object.freeze({ fingerprint, summary });
}

/** Appended to every denial the model sees: which policy made that decision. */
export function formatPolicyStamp(snapshot: ApprovalPolicySnapshot): string {
  return `[当时的策略 policy@${snapshot.fingerprint}: ${snapshot.summary}]`;
}

const STAMP = /\[当时的策略 policy@([0-9a-f]{8})/u;

export interface StaleDenial {
  readonly toolName: string;
  readonly fingerprint: string;
}

/**
 * Denials in `history` decided under another policy that were not followed by a successful call of
 * the same tool. A later success (or a later denial under the current policy) settles a tool.
 */
export function findStaleDenials(history: readonly AgentMessage[], current: ApprovalPolicySnapshot): readonly StaleDenial[] {
  const latest = new Map<string, string | undefined>();
  for (const message of history) {
    if (message.role !== 'toolResult') continue;
    const toolName = String((message as { toolName?: unknown }).toolName ?? '');
    if (!(message as { isError?: unknown }).isError) {
      latest.delete(toolName);
      continue;
    }
    const match = STAMP.exec(textOf(message));
    if (match) latest.set(toolName, match[1]);
  }
  return [...latest.entries()]
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== current.fingerprint)
    .map(([toolName, fingerprint]) => Object.freeze({ toolName, fingerprint }));
}

/** One context note for a turn whose history holds denials from an earlier policy. */
export function formatPolicyChangedNote(stale: readonly StaleDenial[], current: ApprovalPolicySnapshot): string {
  const tools = stale.map(entry => `「${entry.toolName}」(policy@${entry.fingerprint})`).join('、');
  return `审批策略已变更：当前 policy@${current.fingerprint}（${current.summary}）。`
    + `本会话里 ${tools} 的拒绝是在旧策略下做出的，现在可能已经不适用。`
    + '如果用户仍然需要，直接重新尝试调用，以本次的真实结果为准；不要依据旧的拒绝记录告诉用户「做不了」。'
    + '\nApproval policy changed since earlier denials in this conversation; they may no longer apply. Retry when the user still wants it.';
}

function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : '')).join('\n');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
