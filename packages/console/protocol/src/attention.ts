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
  /**
   * An account the Host runs is offline (not deliberately stopped, not waiting for login), including
   * an account whose start failed or waits to be retried; `detail` carries the failure reason (#1250).
   */
  | 'endpoint.offline'
  /**
   * `zhin.config.yml` `endpoints` differ from the persisted accounts (the file only seeds them the
   * first time): accounts only in the file, only saved, or configured differently (#1250).
   */
  | 'endpoint.config-drift'
  /**
   * A declared plugin is degraded (failed to load / its package is missing / other issues), or its
   * management state cannot be read (`detail` says why). When every declared plugin fails to be
   * read for the same reason (e.g. legacy lifecycle state), this is one project-wide item without
   * a `plugin` subject instead of one per plugin.
   */
  | 'plugin.error'
  /**
   * The project's plugin dependency graph is not satisfied. The check is project-wide, so this is
   * one item without a `plugin` subject (not one per plugin).
   */
  | 'plugin.dependencies'
  /** A declared plugin's configuration does not validate or references unset variables. */
  | 'plugin.config'
  /**
   * Two registrations claim the same command route (#1250): the later command (primary route) or
   * only its alias / shortcut was skipped, the earlier one keeps the route. `subject.plugin` is the
   * plugin that lost it, `subject.commandRoute` the route, `subject.command` / `commandKind` the
   * skipped command and which of its routes. `danger` when a later plugin's command took an earlier
   * plugin's alias or shortcut. Visible with `feature.view`.
   */
  | 'command.conflict'
  /** The project configuration file cannot be read or parsed. */
  | 'config.invalid'
  /** The last configuration change was not applied (failed / blocked / unconfirmed). */
  | 'config.apply-failed'
  /** Secret fields of the configuration file hold literals instead of `${VAR}` (ADR 0057). */
  | 'config.literal-secrets'
  /** A dangerous tool call waits for an owner's approval (ADR 0036). */
  | 'tool-approval.pending'
  /**
   * A configured MCP server is not connected; `detail` (and `reason`) carry the classified, redacted
   * reason of its last failed connect when there is one (#1270).
   */
  | 'mcp.disconnected'
  /**
   * A Host model account needs an operator (#1270): it must sign in again (`reauthorize`), was
   * disconnected, its last sign-in has an unknown outcome (`uncertain`), or it is signed in but its
   * read-only preparation failed (`preparation-failed`, with step / reason / upstream status).
   * Visible with `agent.view`.
   */
  | 'inference.account'
  /**
   * A saved setting has no effect at run time (#1270), e.g. a `purposes.agents.<key>` model choice
   * that belongs to an Agent binding, is ambiguous or matches no sub-agent, so the sub-agent runs on
   * the chat model. Visible with `agent.view`.
   */
  | 'config.ineffective'
  /** The persistent log store holds error entries. */
  | 'logs.errors'
  /** An enabled persistent schedule job has no computable next run: it will never fire (#1250). */
  | 'schedule.unschedulable'
  /**
   * No global chat `owner` exists yet (ADR 0060 §3): grant one in the Console, or claim it with the
   * code `zhin status` shows. Visible with global `iam.manage`.
   */
  | 'chat-roles.no-owner'
  /** The first configuration import granted chat roles (information; ADR 0060 §4.1). Global `iam.manage`. */
  | 'chat-roles.imported'
  /** People lists named again in the configuration wait for 「导入」/「忽略」 (ADR 0060 §4.2). Global `iam.manage`. */
  | 'chat-roles.import-pending';

export const CONSOLE_ATTENTION_KINDS: readonly ConsoleAttentionKind[] = Object.freeze([
  'login.pending', 'endpoint.offline', 'endpoint.config-drift', 'plugin.error', 'plugin.dependencies', 'plugin.config',
  'config.invalid', 'config.apply-failed', 'config.literal-secrets', 'tool-approval.pending',
  'mcp.disconnected', 'logs.errors', 'schedule.unschedulable',
  'chat-roles.no-owner', 'chat-roles.imported', 'chat-roles.import-pending',
  'inference.account', 'config.ineffective', 'command.conflict',
]);

/**
 * Permission an operator needs to see items of each kind (checked by the Host on top of the RPC's
 * `status.view`). Account items are checked on the account's endpoint target; `tool-approval.pending`
 * accepts either plugin permission level `tool_approvals:read` or `ops:approve`.
 */
export const CONSOLE_ATTENTION_KIND_PERMISSIONS: Readonly<Record<ConsoleAttentionKind, string>> = Object.freeze({
  'login.pending': 'endpoint.view',
  'endpoint.offline': 'endpoint.view',
  'endpoint.config-drift': 'endpoint.view',
  'plugin.error': 'feature.view',
  'plugin.dependencies': 'feature.view',
  'plugin.config': 'feature.view',
  'config.invalid': 'ops.config.read',
  'config.apply-failed': 'ops.config.read',
  'config.literal-secrets': 'ops.config.read',
  'tool-approval.pending': 'tool_approvals:read',
  'mcp.disconnected': 'status.view',
  'logs.errors': 'status.view',
  'schedule.unschedulable': 'ops.schedule.read',
  'chat-roles.no-owner': 'iam.manage',
  'chat-roles.imported': 'iam.manage',
  'chat-roles.import-pending': 'iam.manage',
  'inference.account': 'agent.view',
  'config.ineffective': 'agent.view',
  'command.conflict': 'feature.view',
});

/** The object an item is about. Absent fields do not apply. */
export interface ConsoleAttentionSubject {
  /** Adapter alias: `adapter` of the account's `endpoint.list` row (Console scope segment). */
  readonly adapter?: string;
  /**
   * Account name: `name` of the account's `endpoint.list` row (Console scope segment); endpoint
   * role bindings are keyed `<adapter>/<endpointKey>`.
   */
  readonly endpointKey?: string;
  /** Plugin instance key. */
  readonly plugin?: string;
  readonly mcpServer?: string;
  readonly approvalId?: string;
  readonly loginTaskId?: string;
  /** Persistent schedule job id. */
  readonly scheduleJobId?: string;
  /** Host model account id (`accounts:<id>` key of the inference graph, #1270). */
  readonly inferenceAccount?: string;
  /** Configuration path of an ineffective setting (e.g. `purposes.agents.planner`, #1270). */
  readonly configPath?: string;
  /** Command route a `command.conflict` is about (words separated by spaces, #1250). */
  readonly commandRoute?: string;
  /** Display name of the command whose route a `command.conflict` skipped (#1250). */
  readonly command?: string;
  /** Which of its routes was skipped: `command` (the whole command), `alias` or `shortcut` (#1250). */
  readonly commandKind?: string;
}

/**
 * Structured reason of an item (#1270): the same facts as `detail`, as codes a Console may render
 * itself. Never carries an upstream message body, a URL or a credential; `message` is redacted.
 */
export interface ConsoleAttentionReason {
  /** Failure category (`auth`, `network`, `timeout`, `config`, `process_exit`, `preparation`, …). */
  readonly category?: string;
  /** Stable code (e.g. `preparation-failed`, `reauthorize`, `binding-name`). */
  readonly code?: string;
  readonly step?: string;
  /** Sanitized upstream reason code (e.g. `UNSUPPORTED_CLIENT`). */
  readonly reason?: string;
  readonly upstreamStatus?: number;
  /** Redacted, at most 200 characters. */
  readonly message?: string;
  /** The fact was recorded before the instance last restarted (「重启前记录」), from the runtime failure journal. */
  readonly restored?: boolean;
  /** ISO time the failure was last observed. */
  readonly at?: string;
}

export interface ConsoleAttentionAction {
  /** Localized button text (e.g. 「去扫码」). */
  readonly label: string;
  /** Console route (path + query) where the item is fixed. */
  readonly path: string;
}

export interface ConsoleAttentionItem {
  /**
   * Stable identity of `kind` + `subject` (`attentionItemId`): the same problem keeps its id across
   * reads, and different subjects never share one.
   */
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
  /** Structured reason (added later, #1270; older Hosts omit it). */
  readonly reason?: ConsoleAttentionReason;
}

export interface ConsoleAttentionListRequest {
  readonly locale?: 'zh-CN' | 'en';
}

export interface ConsoleAttentionList {
  /**
   * `starting`: the instance is still starting (its runtime does not accept reads yet); `items` is
   * empty and no source was read, which is not the same as "nothing to do" (#1270). Absent or
   * `ready` otherwise; older Hosts omit it.
   */
  readonly status?: 'ready' | 'starting';
  readonly items: readonly ConsoleAttentionItem[];
  /** ISO time the Host gathered the list. */
  readonly generatedAt: string;
  /**
   * Sources the caller may view that could not be read this time (e.g. `plugins`, `logs`): the
   * list is incomplete for them, which is not the same as "nothing to do".
   */
  readonly unavailable?: readonly string[];
  /**
   * Why each `unavailable` source could not be read, same order as `unavailable` (added later:
   * older Hosts omit it, so a Console falls back to `unavailable`). `reason` is a short sanitized
   * explanation — never an absolute path or a credential — and may be in English.
   */
  readonly unavailableDetails?: readonly ConsoleAttentionUnavailable[];
}

/** One source of `attention.list` that could not be read, with a short sanitized reason. */
export interface ConsoleAttentionUnavailable {
  /** Same value as the matching `unavailable` entry (`plugins`, `logs`, …). */
  readonly source: string;
  readonly reason: string;
}

/** 64-bit FNV-1a over UTF-16 code units, 16 hex digits; tells states apart, never a security boundary. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
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

/**
 * `<kind>` or `<kind>:<field>=<value>&…` — the subject itself, fields sorted and values
 * percent-encoded, so two different subjects never share an id (no hash) and the id does not
 * depend on key order or on the item's state.
 */
export function attentionItemId(kind: ConsoleAttentionKind, subject: ConsoleAttentionSubject = {}): string {
  const fields = Object.entries(subject as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return fields.length ? `${kind}:${fields.join('&')}` : kind;
}

/** Fingerprint of an item's state (any JSON-like value): 64-bit, 16 hex digits. */
export function attentionRevision(state: unknown): string {
  return fnv1a64(canonical(state));
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

// ---------------------------------------------------------------- runtime failure journal

/** Instance runtime failure journal, relative to the project root (#1270). */
export const RUNTIME_FAILURES_FILE = '.zhin/runtime-failures.json';

/** What a runtime failure is about (#1270). */
export type ConsoleRuntimeFailureSource = 'account' | 'endpoint' | 'mcp' | 'model';

/**
 * One entry of `.zhin/runtime-failures.json` (#1270): the latest failure of one subject, kept until
 * that subject succeeds again, so its reason survives an instance restart. Written by the instance
 * only (never in `gateway.db`, ADR 0059). `message` is redacted; no field carries a credential.
 */
export interface ConsoleRuntimeFailure {
  readonly source: ConsoleRuntimeFailureSource;
  /**
   * Subject id within its source: an inference account id (`account` / `model`), `<adapter>/<name>`
   * of an Endpoint, or an MCP server name.
   */
  readonly subject: string;
  /** Stable failure code (e.g. `preparation-failed`, `start-failed`, `connect-failed`, `rate-limit`). */
  readonly code: string;
  readonly step?: string;
  /** Sanitized upstream or local reason code. */
  readonly reason?: string;
  /** Coarse category (`auth`, `network`, `timeout`, `config`, `process_exit`, `preparation`, `server`, …). */
  readonly category: string;
  /** Redacted, at most 200 characters. */
  readonly message: string;
  readonly upstreamStatus?: number;
  /** Credential revision the failure was observed on (`account`): a newer credential voids it. */
  readonly credentialRevision?: number;
  /** Epoch milliseconds of the first and the latest observation since the subject last succeeded. */
  readonly firstAt: number;
  readonly lastAt: number;
  /** Observations since the subject last succeeded. */
  readonly count: number;
}

/** Shape of `.zhin/runtime-failures.json`. */
export interface ConsoleRuntimeFailureJournal {
  readonly version: 1;
  readonly entries: readonly ConsoleRuntimeFailure[];
}
