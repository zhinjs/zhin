/**
 * Console attention inbox (「需要你处理」): one read RPC that gathers everything waiting for an
 * operator — login challenges, offline accounts, plugin and configuration problems, pending tool
 * approvals, disconnected MCP servers and error logs — each with a deep link to where it is fixed.
 *
 * The RPC needs `status.view` (like the dashboard it feeds); the Host then drops every item the
 * caller may not view (an account's items need `endpoint.view` on that account, configuration
 * items `ops.config.read`, …). Titles and details are localized by the Host for `locale`
 * (`zh-CN` default), like the task catalog; Host-supplied dynamic text (plugin issues, error
 * messages) stays verbatim inside them.
 */

export const ATTENTION_RPC = Object.freeze({
  LIST: 'attention.list',
} as const);

export type ConsoleAttentionRpcType = typeof ATTENTION_RPC[keyof typeof ATTENTION_RPC];

/** `attention.list` is a dashboard read: `status.view`; items are filtered per permission inside. */
export const ATTENTION_RPC_PERMISSIONS: Readonly<Record<ConsoleAttentionRpcType, 'status.view'>> = Object.freeze({
  [ATTENTION_RPC.LIST]: 'status.view',
});

export function isConsoleAttentionRpcType(value: unknown): value is ConsoleAttentionRpcType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ATTENTION_RPC_PERMISSIONS, value);
}

export type ConsoleAttentionSeverity = 'danger' | 'warning' | 'info';

export const CONSOLE_ATTENTION_SEVERITIES: readonly ConsoleAttentionSeverity[] = Object.freeze(['danger', 'warning', 'info']);

/**
 * What needs attention. One kind per source; a kind keeps its meaning across Host versions so a
 * Console may render its own text for kinds it knows and fall back to `title` / `detail` otherwise.
 */
export type ConsoleAttentionKind =
  /** An account waits for a login step (LoginAssist: QR code, SMS, slider, device …). */
  | 'login.pending'
  /** An account the Host runs is offline (not deliberately stopped, not waiting for login). */
  | 'endpoint.offline'
  /**
   * `zhin.config.yml` `endpoints` differ from the persisted accounts (the file only seeds them the
   * first time): accounts only in the file, only saved, or configured differently (#1250).
   */
  | 'endpoint.config-drift'
  /** A declared plugin is degraded (failed to load / its package is missing / other issues). */
  | 'plugin.error'
  /** A declared plugin's dependencies or required services are not satisfied. */
  | 'plugin.dependencies'
  /** A declared plugin's configuration does not validate or references unset variables. */
  | 'plugin.config'
  /** The project configuration file cannot be read or parsed. */
  | 'config.invalid'
  /** The last configuration change was not applied (failed / blocked / unconfirmed). */
  | 'config.apply-failed'
  /** Secret fields of the configuration file hold literals instead of `${VAR}` (ADR 0057). */
  | 'config.literal-secrets'
  /** A dangerous tool call waits for an owner's approval (ADR 0036). */
  | 'tool-approval.pending'
  /** A configured MCP server is not connected. */
  | 'mcp.disconnected'
  /** The persistent log store holds error entries. */
  | 'logs.errors';

export const CONSOLE_ATTENTION_KINDS: readonly ConsoleAttentionKind[] = Object.freeze([
  'login.pending', 'endpoint.offline', 'endpoint.config-drift', 'plugin.error', 'plugin.dependencies', 'plugin.config',
  'config.invalid', 'config.apply-failed', 'config.literal-secrets', 'tool-approval.pending',
  'mcp.disconnected', 'logs.errors',
]);

/** The object an item is about. Absent fields do not apply. */
export interface ConsoleAttentionSubject {
  /** Adapter instance alias (Console scope segment). */
  readonly adapter?: string;
  /** Account name within the adapter (Console scope segment). */
  readonly endpointKey?: string;
  /** Plugin instance key. */
  readonly plugin?: string;
  readonly mcpServer?: string;
  readonly approvalId?: string;
  readonly loginTaskId?: string;
}

export interface ConsoleAttentionAction {
  /** Localized button text (e.g. 「去扫码」). */
  readonly label: string;
  /** Console route (path + query) where the item is fixed. */
  readonly path: string;
}

export interface ConsoleAttentionItem {
  /** Stable fingerprint of `kind` + `subject`: the same problem keeps its id across reads. */
  readonly id: string;
  /**
   * Fingerprint of the item's current state (counts, issue text, phase …). It changes when the
   * problem changes, so a viewer's 「忽略」 lasts until then.
   */
  readonly revision: string;
  readonly kind: ConsoleAttentionKind;
  readonly severity: ConsoleAttentionSeverity;
  /** Localized for the request's `locale`. */
  readonly title: string;
  readonly detail: string;
  readonly subject?: ConsoleAttentionSubject;
  /** ISO time the problem started, or the Host first observed it. */
  readonly since: string;
  readonly action: ConsoleAttentionAction;
  /** Runtime source that reported it (`login-assist`, `endpoints`, `plugins`, `config`, …). */
  readonly source: string;
}

export interface ConsoleAttentionListRequest {
  readonly locale?: 'zh-CN' | 'en';
}

export interface ConsoleAttentionList {
  readonly items: readonly ConsoleAttentionItem[];
  /** ISO time the Host gathered the list. */
  readonly generatedAt: string;
  /**
   * Sources the caller may view that could not be read this time (e.g. `plugins`, `logs`): the
   * list is incomplete for them, which is not the same as "nothing to do".
   */
  readonly unavailable?: readonly string[];
}

/** 32-bit FNV-1a, hex; enough to tell items apart, never a security boundary. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** `<kind>:<hash of subject>` — independent of key order and of the item's state. */
export function attentionItemId(kind: ConsoleAttentionKind, subject: ConsoleAttentionSubject = {}): string {
  return `${kind}:${fnv1a(canonical(subject))}`;
}

/** Fingerprint of an item's state (any JSON-like value). */
export function attentionRevision(state: unknown): string {
  return fnv1a(canonical(state));
}

const severityRank: Readonly<Record<ConsoleAttentionSeverity, number>> = Object.freeze({ danger: 0, warning: 1, info: 2 });

/** Danger first, then warning, then info; within a severity the oldest first, then by id. */
export function compareAttentionItems(a: Pick<ConsoleAttentionItem, 'severity' | 'since' | 'id'>, b: Pick<ConsoleAttentionItem, 'severity' | 'since' | 'id'>): number {
  const rank = (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3);
  if (rank !== 0) return rank;
  const at = Date.parse(a.since);
  const bt = Date.parse(b.since);
  const time = (Number.isNaN(at) ? Infinity : at) - (Number.isNaN(bt) ? Infinity : bt);
  if (time !== 0 && !Number.isNaN(time)) return time;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
