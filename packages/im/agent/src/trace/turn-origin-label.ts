/**
 * Readable label of where a turn came from (#1250 b63): the trace-archive session summaries and the
 * Host tool approval cards share this shape, so the Console shows `sandbox · 私聊 Developer`
 * instead of a hashed session key — the same format as the gateway usage stats' `displayName`.
 *
 * The same rules as `sessionPartsOf()` of the gateway usage stats (`@zhin.js/gateway/usage`). The
 * Agent package must not depend on the gateway, and these few lines are not plugin contract, so
 * they are kept here rather than in `@zhin.js/plugin-runtime`; a parity test in
 * `packages/im/zhin/tests/instance/console/` keeps the two in step.
 */
import type { ToolInvocationOrigin } from '@zhin.js/tool';

/** Structured, localizable label of a turn origin; every part may be missing on older records. */
export interface TurnOriginLabel {
  /** IM platform (client adapter) of the conversation. */
  readonly platform?: string;
  /**
   * IM: `private` / `group` / `channel` (or the recorded scope as-is); otherwise the origin kind:
   * `http`, `schedule`, `a2a`, `mcp`, `internal`.
   */
  readonly scopeKind?: string;
  /**
   * Group / channel name, the private peer's display name, else the native conversation id;
   * the schedule job's label (when the host knows it) or id; the internal source.
   */
  readonly sceneLabel?: string;
  /**
   * `平台 · 私聊 名称`, `定时任务 每日早报`, `HTTP` — the gateway usage stats' `displayName` format,
   * what `zhin trace --sessions` prints.
   */
  readonly displayName?: string;
}

const SCOPE_KINDS: Readonly<Record<string, string>> = { private: 'private', direct: 'private', group: 'group', channel: 'channel', guild: 'channel' };
const SCOPE_TEXT: Readonly<Record<string, string>> = {
  private: '私聊', group: '群', channel: '频道',
  http: 'HTTP', schedule: '定时任务', a2a: 'A2A', mcp: 'MCP', internal: '内部',
};

/** Longest platform-given name kept, in code points. */
export const ORIGIN_TEXT_MAX_CODE_POINTS = 128;

/**
 * C0 / C1 controls (ESC sequences, newlines, …), the line / paragraph separators and the bidi
 * embedding / override / isolate controls: a platform-given name with one could rewrite a
 * terminal line or reorder the Console's text.
 */
const UNSAFE_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

/**
 * A platform-given name (group name, sender display name, …) made safe to show: trimmed, unsafe
 * characters escaped as `\uXXXX` (like the usage log line), then cut to
 * {@link ORIGIN_TEXT_MAX_CODE_POINTS} code points — never inside a surrogate pair. Idempotent, so
 * names already cleaned when recorded pass unchanged. `undefined` for a non-string or blank value.
 */
export function sanitizeOriginText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const escaped = value.trim().replace(UNSAFE_TEXT, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const cut = [...escaped].slice(0, ORIGIN_TEXT_MAX_CODE_POINTS).join('').trim();
  return cut || undefined;
}

const text = sanitizeOriginText;

/**
 * `平台 · 私聊 名称` (`定时任务 每日早报`, `HTTP`) from the structured parts — the gateway usage
 * stats' `displayName` format; `undefined` when there is nothing to show.
 */
export function turnOriginDisplayName(label: Omit<TurnOriginLabel, 'displayName'>): string | undefined {
  const scope = label.scopeKind ? SCOPE_TEXT[label.scopeKind] ?? label.scopeKind : undefined;
  const scene = [scope, label.sceneLabel].filter((part): part is string => Boolean(part)).join(' ');
  const parts = [label.platform, scene].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Label of a recorded turn origin (a {@link ToolInvocationOrigin}, or anything read back from a
 * trace file). `principalDisplayName` names a private chat when the conversation has no name.
 * Empty without a usable origin.
 */
export function turnOriginLabelOf(origin: unknown, principalDisplayName?: unknown): TurnOriginLabel {
  if (!origin || typeof origin !== 'object') return {};
  const o = origin as Record<string, any>;
  let parts: Omit<TurnOriginLabel, 'displayName'> = {};
  if (o.kind === 'im') {
    const scope = text(o.scope) ?? text(o.conversation?.kind);
    const kind = scope ? SCOPE_KINDS[scope] ?? scope : undefined;
    const name = text(o.conversation?.name)
      ?? (kind === 'private' ? text(principalDisplayName) : undefined)
      ?? text(o.sceneId) ?? text(o.conversation?.id);
    const platform = text(o.platform) ?? text(o.conversation?.endpoint?.adapter);
    parts = { ...(platform ? { platform } : {}), ...(kind ? { scopeKind: kind } : {}), ...(name ? { sceneLabel: name } : {}) };
  } else if (o.kind === 'schedule') {
    const name = text(o.jobId);
    parts = { scopeKind: 'schedule', ...(name ? { sceneLabel: name } : {}) };
  } else if (o.kind === 'internal') {
    const name = text(o.source);
    parts = { scopeKind: 'internal', ...(name ? { sceneLabel: name } : {}) };
  } else if (o.kind === 'http' || o.kind === 'a2a' || o.kind === 'mcp') {
    parts = { scopeKind: o.kind };
  }
  const displayName = turnOriginDisplayName(parts);
  return { ...parts, ...(displayName ? { displayName } : {}) };
}

/**
 * Same label with a schedule job's readable name: the host resolves `jobId` → label (the job may
 * have been deleted, then the id stays).
 */
export function withScheduleJobLabel(
  label: TurnOriginLabel, origin: unknown, resolve: ((jobId: string) => string | undefined) | undefined,
): TurnOriginLabel {
  if (!resolve || label.scopeKind !== 'schedule') return label;
  const jobId = text((origin as { jobId?: unknown } | undefined)?.jobId);
  if (!jobId) return label;
  let name: string | undefined;
  try { name = text(resolve(jobId)); } catch { name = undefined; }
  if (!name || name === label.sceneLabel) return label;
  const parts = { ...label, sceneLabel: name };
  const displayName = turnOriginDisplayName(parts);
  return { ...parts, ...(displayName ? { displayName } : {}) };
}

/** Grouping key of a recorded origin: one entry per chat in a session's `conversations`. */
export function turnOriginKey(origin: unknown): string | undefined {
  if (!origin || typeof origin !== 'object') return undefined;
  const o = origin as Record<string, any>;
  if (o.kind === 'im') {
    const c = o.conversation;
    if (c && typeof c === 'object' && c.endpoint) {
      return JSON.stringify(['im', c.endpoint.adapter, c.endpoint.id, c.kind, c.id, c.parent?.kind ?? null, c.parent?.id ?? null, c.threadId ?? null]);
    }
    return JSON.stringify(['im', o.platform, o.endpoint, o.scope, o.sceneId, o.threadId ?? null]);
  }
  // Within one session, an A2A context's tasks, MCP requests and HTTP calls are one chat: only IM
  // conversations and internal sources (and schedule jobs) tell several apart.
  const id = o.kind === 'schedule' ? o.jobId : o.kind === 'internal' ? o.source : undefined;
  return typeof o.kind === 'string' ? JSON.stringify([o.kind, id ?? null]) : undefined;
}

/**
 * Frozen copy of an origin with only its known fields (what a trace records). The conversation's
 * display name is kept (cleaned of control / bidi characters and bounded, see
 * {@link sanitizeOriginText}) so session lists can show it (#1250 b63); it is never part of the
 * conversation's identity.
 */
export function snapshotOrigin(origin: ToolInvocationOrigin): ToolInvocationOrigin {
  if (origin.kind !== 'im') {
    switch (origin.kind) {
      case 'http': return Object.freeze({ kind: origin.kind, sessionId: origin.sessionId });
      case 'a2a': return Object.freeze({ kind: origin.kind, taskId: origin.taskId });
      case 'schedule': return Object.freeze({ kind: origin.kind, jobId: origin.jobId });
      case 'internal': return Object.freeze({ kind: origin.kind, source: origin.source });
      case 'mcp': return Object.freeze({ kind: origin.kind, requestId: origin.requestId });
    }
  }
  const conversation = origin.conversation;
  return Object.freeze({ kind: origin.kind, platform: origin.platform, endpoint: origin.endpoint,
    scope: origin.scope, sceneId: origin.sceneId,
    ...(origin.messageId === undefined ? {} : { messageId: origin.messageId }),
    ...(origin.threadId === undefined ? {} : { threadId: origin.threadId }),
    ...(conversation ? { conversation: Object.freeze({
      endpoint: Object.freeze({ adapter: conversation.endpoint.adapter, id: conversation.endpoint.id }),
      kind: conversation.kind, id: conversation.id,
      ...(conversation.parent ? { parent: Object.freeze({ kind: conversation.parent.kind, id: conversation.parent.id }) } : {}),
      ...(conversation.threadId === undefined ? {} : { threadId: conversation.threadId }),
      ...(conversationNameOf(conversation) ? { name: conversationNameOf(conversation) } : {}),
    }) } : {}),
  });
}

/** The conversation's platform-given name, cleaned and bounded ({@link sanitizeOriginText}). */
function conversationNameOf(conversation: { readonly name?: unknown }): string | undefined {
  return sanitizeOriginText(conversation.name);
}
