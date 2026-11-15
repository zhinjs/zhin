/**
 * `attention.list` (Console 「需要你处理」): gathers what waits for an operator from existing runtime
 * state and filters it by what the caller may view.
 *
 * | kind | source | needs |
 * |---|---|---|
 * | `login.pending` | LoginAssist pending tasks | `endpoint.view` on that account |
 * | `endpoint.offline` | Endpoint registry (offline, not stopped, no login task; or start `failed` / `retrying`, with `lastError`) | `endpoint.view` on that account |
 * | `endpoint.config-drift` | `zhin.config.yml` `endpoints` vs persisted accounts (#1250) | `endpoint.view` on that adapter instance |
 * | `plugin.error` / `plugin.config` | plugin management `inspect` of declared plugins | `feature.view` |
 * | `command.conflict` | Command index routes skipped because another registration holds them (#1250) | `feature.view` |
 * | `plugin.dependencies` | one project-wide dependency graph check per read (one item, not one per plugin) | `feature.view` |
 * | `config.invalid` / `config.apply-failed` / `config.literal-secrets` | configuration store | `ops.config.read` |
 * | `tool-approval.pending` | the Agent Root's tool approval queue | `tool_approvals:read` or `ops:approve` |
 * | `mcp.disconnected` | Agent MCP servers (configured + connected, with the last connect failure) | `status.view` |
 * | `inference.account` | Host model accounts: reauthorize / disconnected / uncertain / preparation failed (#1270) | `agent.view` |
 * | `config.ineffective` | `purposes.agents.<key>` choices the runtime ignores (#1270) | `agent.view` |
 * | `logs.errors` | SystemLog error rows | `status.view` |
 * | `schedule.unschedulable` | enabled persistent schedule jobs without a next run | `ops.schedule.read` |
 * | `chat-roles.no-owner` / `chat-roles.imported` / `chat-roles.import-pending` | chat role store + migration record (ADR 0060) | global `iam.manage` |
 *
 * While the instance is still starting (its Root does not accept generation operations), the list
 * answers `status: 'starting'` without reading any source or logging per source (#1270). Reasons
 * restored from the runtime failure journal (`.zhin/runtime-failures.json`) are marked
 * 「重启前记录」.
 *
 * Text is localized for the request's `locale` (task catalog pattern); dynamic Host text (issues,
 * error messages, ids) is inserted verbatim, except configuration parse errors, which are reduced to
 * file + position + kind. `since` is the source's own start time when it has one (login task,
 * approval card, latest error), otherwise when this Host first observed it.
 *
 * Accounts and login tasks are read live; plugins, configuration, MCP and logs are shared between
 * requests through {@link AttentionSourceCache} (raw reads only — filtering is per caller).
 */
import {
  ATTENTION_RPC,
  CONSOLE_PERMISSIONS,
  attentionItemId,
  attentionRevision,
  compareAttentionItems,
  isConsoleAttentionRpcType,
  type ConsoleAttentionItem,
  type ConsoleAttentionKind,
  type ConsoleAttentionList,
  type ConsoleAttentionReason,
  type ConsoleAttentionSeverity,
  type ConsoleAttentionSubject,
  type ConsoleConfigSource,
  type ConsoleScopeTarget,
} from '@zhin.js/console-protocol';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { createMessages, resolveLocale, type Locale } from '@zhin.js/plugin-runtime';

// ---------------------------------------------------------------- sources

export interface AttentionLoginTask {
  readonly id: string;
  readonly adapter: string;
  readonly endpointKey: string;
  /** Canonical id of the Endpoint the task belongs to, when the Adapter captured it. */
  readonly canonicalId?: string;
  readonly type: string;
  readonly createdAt: number;
}

/**
 * One account. An account is addressed by `adapter` + `name` everywhere the Console authorizes
 * and links it: endpoint-scoped role bindings are written as `<adapter>/<name>`, scope pages live
 * at `/scope/<adapter>/<name>` and their RPCs send `{ adapter, endpointKey: name }`.
 */
export interface AttentionEndpoint {
  /** Canonical Endpoint id (matches login tasks; never shown or used for authorization). */
  readonly id?: string;
  /**
   * Adapter type of the canonical Endpoint (`endpoint.list` row `endpoint.adapter`); only used to
   * honour account bindings written before 1.2.x as `<endpoint.adapter>/<canonical id>`.
   */
  readonly adapterType?: string;
  /** Adapter alias (Console scope segment, `endpoint.list` row `adapter`). */
  readonly adapter: string;
  /** Account name (Console scope segment, `endpoint.list` row `name`). */
  readonly name: string;
  readonly connected: boolean;
  readonly phase: string;
  readonly transportState: string;
  /** An unfinished login flow of this account waits for a person (ADR 0058). */
  readonly pendingLogin?: boolean;
  /** Classified, redacted reason of the last failed start (#1250). */
  readonly lastError?: Readonly<{ category: string; message: string; at?: number;
    /** From the runtime failure journal: observed before the last restart (#1270). */
    restored?: boolean }>;
}

/** One adapter instance whose configuration file accounts differ from the persisted ones (#1250). */
export interface AttentionEndpointDrift {
  /** Plugin instance key (Console adapter scope segment and the configuration block name). */
  readonly instanceKey: string;
  /** Adapter local name. */
  readonly adapter: string;
  /** Account ids only in the configuration file (not running). */
  readonly configOnly: readonly string[];
  /** Account ids saved (and possibly running) but no longer in the configuration file. */
  readonly savedOnly: readonly string[];
  /** Account ids in both with different configuration. */
  readonly changed: readonly string[];
}

export interface AttentionPluginState {
  readonly instanceKey: string;
  readonly status: string;
  readonly dependencies: string;
  readonly disabled: boolean;
  readonly issues: readonly string[];
  readonly validation: null | {
    readonly valid: boolean;
    readonly errors: readonly { readonly path: string; readonly message: string }[];
    readonly missingEnv: readonly string[];
  };
}

/**
 * Management state of one declared plugin, or why `inspect` failed for it. A failed plugin is
 * reported as its own `plugin.error` item; it does not void the other plugins' items.
 */
export type AttentionPluginInspection =
  | { readonly status: 'fulfilled'; readonly value: AttentionPluginState }
  | { readonly status: 'rejected'; readonly instanceKey: string; readonly reason: unknown };

/** One read of the declared plugins. */
export interface AttentionPluginsRead {
  /** Management state per declared plugin. */
  readonly states: readonly AttentionPluginInspection[];
  /**
   * The project-wide dependency graph check, run once per read (`inspect` then skips it, so it
   * is not repeated, nor reported, once per plugin). Absent: not checked.
   */
  readonly dependencies?: { readonly status: 'passed' } | { readonly status: 'failed'; readonly error: string };
}

export interface AttentionConfiguration {
  /** `readSource()`; throws when the file cannot be read or parsed. */
  readonly source: () => Promise<Pick<ConsoleConfigSource, 'application' | 'applicationError'>>;
  readonly literalSecrets?: () => Promise<readonly { readonly path: readonly string[] }[]>;
  /** Project root: file names in `config.invalid` are shown relative to it. */
  readonly projectRoot?: string;
}

/** Where an approval was requested (the queue entry's `origin`). */
export interface AttentionApprovalOrigin {
  /** Adapter alias. */
  readonly platform: string;
  readonly endpointKey: string;
  /** Absent for non-IM sessions (e.g. a Console trial chat). */
  readonly scope?: 'private' | 'group' | 'channel';
  /** Native conversation id (group / channel id, private peer id). */
  readonly sceneId: string;
}

export interface AttentionToolApproval {
  readonly id: string;
  readonly toolName: string;
  /** Internal session key: kept in the item state, never in its text. */
  readonly sessionKey: string;
  readonly createdAt: number;
  /** Display name of the conversation (group / session / sender name), when known. */
  readonly sessionName?: string;
  readonly origin?: AttentionApprovalOrigin | null;
}

export interface AttentionMcpServer {
  readonly name: string;
  readonly connected: boolean;
  /** Classified, redacted reason of the last failed connect (#1270). */
  readonly lastError?: Readonly<{ category: string; message: string; at?: number; exitCode?: number }>;
  /** The reason comes from the runtime failure journal (before the last restart). */
  readonly restored?: boolean;
}

/** A Host model account that needs an operator (#1270). */
export interface AttentionInferenceAccount {
  readonly accountId: string;
  readonly label: string;
  readonly serviceLabel: string;
  readonly state: 'reauthorize' | 'disconnected' | 'uncertain' | 'preparation-failed';
  readonly revision: number;
  readonly preparationFailure?: Readonly<{ code: string; reason?: string; upstreamStatus?: number; step?: string; restored?: boolean; at?: number }>;
  readonly failure?: string;
  readonly failureStatus?: number;
}

/** A saved setting the runtime ignores (#1270). */
export interface AttentionIneffectiveConfig {
  /** Configuration path, e.g. `purposes.agents.planner`. */
  readonly path: string;
  readonly reason: 'binding-name' | 'ambiguous' | 'no-target';
  /** Sub-agents (qualified names) the setting was meant for. */
  readonly agents?: readonly string[];
}

/** One side of a command route conflict (#1250); mirrors `CommandRouteClaimant` of `@zhin.js/command`. */
export interface AttentionCommandClaimant {
  /** Plugin instance key. */
  readonly plugin: string;
  /** Command display name. */
  readonly command: string;
  /** Plugin-local path, as `disabledCommands` takes it. */
  readonly localPath: string;
  readonly kind: 'command' | 'alias' | 'shortcut';
  /** Alias or shortcut text. */
  readonly entry?: string;
  /** The project's Root plugin: shown as such, linked to the plugin list (it has no plugin page). */
  readonly root?: true;
}

/** A command route two registrations claim: `skipped` lost it, `kept` holds it (#1250). */
export interface AttentionCommandConflict {
  readonly route: string;
  readonly skipped: AttentionCommandClaimant;
  readonly kept: AttentionCommandClaimant;
  /** A later plugin's command took an earlier plugin's alias / shortcut: `danger`. */
  readonly takenByLater?: true;
}

/** Error-log items only count recent errors, so an old error does not keep the inbox lit. */
export const DEFAULT_ERROR_LOG_WINDOW_HOURS = 24;

export interface AttentionUnschedulableJob {
  readonly jobId: string;
  readonly label?: string;
  /** `invalid_schedule` | `no_next_run` | `expired` */
  readonly reason: string;
  readonly since: number;
}

export interface AttentionErrorLogs {
  /** Error rows inside the window (not the whole log). */
  readonly count: number;
  /** ISO time of the newest error row. */
  readonly latest: string | null;
  /** Length of the counted window in hours; the item says which period it covers. */
  readonly windowHours?: number;
}

/** Chat role bootstrap state (ADR 0060 §3 / §4). */
export interface AttentionChatRoles {
  readonly hasGlobalOwner: boolean;
  /** A claim code is open (`zhin status`). */
  readonly claimOpen: boolean;
  /** First import not yet marked as read: grants written / raised / skipped. */
  readonly imported?: {
    readonly at: number;
    readonly entries: readonly { readonly source: string; readonly adapter: string; readonly userId: string; readonly role: string; readonly level: string; readonly result: string }[];
  };
  /** Re-appeared configured grants waiting for a decision. */
  readonly pending: readonly { readonly id: string; readonly source: string; readonly adapter: string; readonly userId: string; readonly role: string; readonly seenAt: number }[];
  /**
   * ADR 0060 §4.1 (P3): `ai.personalPrincipals` imported as people linked to Console users (no
   * roles), not yet marked as read.
   */
  readonly personal?: {
    readonly at: number;
    readonly entries: readonly { readonly consoleUserId: string; readonly adapter: string; readonly userId: string }[];
  };
  /** `ai.personalPrincipals` links waiting for confirmation (ADR 0060 §4.1, security review). */
  readonly personalPending?: readonly { readonly id: string; readonly consoleUserId: string; readonly adapter: string; readonly userId: string; readonly at: number }[];
}

/** Every source is optional and only read when the caller may view something it reports. */
export interface AttentionSources {
  readonly loginTasks?: () => readonly AttentionLoginTask[];
  readonly endpoints?: () => readonly AttentionEndpoint[] | Promise<readonly AttentionEndpoint[]>;
  readonly endpointConfigDrift?: () => Promise<readonly AttentionEndpointDrift[]>;
  readonly plugins?: () => Promise<AttentionPluginsRead>;
  /** Command routes skipped because another registration holds them (#1250); read live. */
  readonly commandConflicts?: () => readonly AttentionCommandConflict[];
  readonly configuration?: AttentionConfiguration;
  /** `undefined` when the Agent (and its queue) is not running. */
  readonly toolApprovals?: () => readonly AttentionToolApproval[] | undefined;
  readonly mcpServers?: () => readonly AttentionMcpServer[];
  /** `undefined` when the persistent scheduler (Agent assistant) is not running. */
  readonly unschedulableJobs?: () => readonly AttentionUnschedulableJob[] | undefined;
  /** `null` when the log store is not available. */
  readonly errorLogs?: () => Promise<AttentionErrorLogs | null>;
  /** ADR 0060: chat role bootstrap and configuration import. */
  readonly chatRoles?: () => Promise<AttentionChatRoles>;
  /** Host model accounts that need an operator (#1270). */
  readonly inferenceAccounts?: () => Promise<readonly AttentionInferenceAccount[]>;
  /** Saved settings the runtime ignores (#1270). */
  readonly ineffectiveConfig?: () => Promise<readonly AttentionIneffectiveConfig[]>;
  /**
   * Whether the instance accepts reads (its Root is running). `false`: `attention.list` answers
   * `status: 'starting'` without reading any source (#1270).
   */
  readonly ready?: () => boolean;
  /**
   * Cheap signal that changes with the project files and the runtime generation; a cached read
   * (see {@link AttentionSourceCache}) older than the current revision is read again.
   */
  readonly revision?: () => string | Promise<string>;
}

/** Whether the caller holds `permission` (at `target`; default: global). */
export type AttentionAllows = (permission: string, target?: ConsoleScopeTarget) => boolean;

/** Source names, as reported in `unavailable`. */
export type AttentionSourceName = 'login-assist' | 'endpoints' | 'endpoint-config' | 'plugins' | 'commands' | 'config' | 'tool-approvals' | 'mcp' | 'logs' | 'schedule' | 'chat-roles' | 'inference' | 'agent-config';

// ---------------------------------------------------------------- account addresses

/**
 * Scope targets under which an account may be authorized. An account is addressed by its row's
 * adapter alias + `name` (what the Console's binding editor writes). Bindings written before
 * 1.2.x addressed it by its canonical Endpoint id instead (`<adapter>/<id>`, and in
 * `endpoint.list` `<endpoint.adapter>/<id>`); during the transition those still match the same
 * account. Never any other account.
 */
export function endpointAccountTargets(account: { readonly adapter: string; readonly name: string; readonly id?: string; readonly adapterType?: string }): readonly ConsoleScopeTarget[] {
  const targets: ConsoleScopeTarget[] = [endpointTarget(account.adapter, account.name)];
  const add = (adapter: string, endpoint: string) => {
    if (!adapter || !endpoint || targets.some(target => target.kind === 'endpoint' && target.adapter === adapter && target.endpoint === endpoint)) return;
    targets.push(endpointTarget(adapter, endpoint));
  };
  if (account.id) {
    add(account.adapter, account.id);
    if (account.adapterType) add(account.adapterType, account.id);
  }
  return targets;
}

/** Whether `allows` grants `permission` on the account under any of its addresses. */
export function allowsEndpointAccount(allows: AttentionAllows, permission: string, account: Parameters<typeof endpointAccountTargets>[0]): boolean {
  return endpointAccountTargets(account).some(target => allows(permission, target));
}

// ---------------------------------------------------------------- failure reasons

const MAX_REASON = 200;
/** Only this much of the first line reaches the masking expressions: bounds their backtracking (#1278). */
const MAX_REDACTED_INPUT = 2048;

/**
 * Key names whose value is a credential (also matched inside longer names such as `x-api-key`);
 * `sig` / `signature` only as whole names, so `signal: …` stays readable.
 */
const CREDENTIAL_KEY = String.raw`(?:[\w-]*(?:authorization|cookie|token|secret|pass|pwd|credential|api[-_]?key|access[-_]?key|private[-_]?key|session[-_]?id|key)[\w-]*|sig|signature)`;
const CREDENTIAL_PAIR = new RegExp(
  String.raw`(["']?)\b(${CREDENTIAL_KEY})\1(\s*[=:]\s*)(?:(Bearer|Basic|Token)\s+)?("[^"]*"|'[^']*'|[^\s,;&"']+)`, 'giu');

/**
 * A short, sanitized explanation of a failure for operators — the only redaction applied before a
 * reason is shown or written to `.zhin/runtime-failures.json` (#1270). Same rules as the Adapter's
 * start-failure redaction, plus path shortening: the first line of the message; URL user info and
 * query strings removed; values of credential-like keys (`authorization`, `cookie`, `key`,
 * `api_key`, `access_token`, `refresh_token`, `secret`, `password`, `token` …, quoted JSON keys
 * included) masked, with or without an `Authorization` scheme; whole `Cookie:` headers masked;
 * bare `sk-…` / `AIza…` keys and runs of 24+ token characters with a digit masked; absolute paths reduced to
 * their last segment.
 */
export function attentionFailureReason(error: unknown): string {
  const record = error && typeof error === 'object' ? error as { message?: unknown } : undefined;
  const raw = typeof error === 'string' ? error : typeof record?.message === 'string' ? record.message : '';
  let text = (raw.split(/\r?\n/u).find(line => line.trim()) ?? '').trim().slice(0, MAX_REDACTED_INPUT);
  text = text
    // URL user info and query / fragment.
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, '$1***@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"`]*)[?#][^\s'"`]*/giu, '$1?***')
    // Whole cookie headers: every `name=value` of them is a credential.
    .replace(/\b((?:set-)?cookie)(\s*:\s*)[^\r\n]*/giu, '$1$2***')
    .replace(/\b(Bearer|Basic)\s+(?!\*\*\*)[^\s,;"']+/giu, '$1 ***')
    .replace(CREDENTIAL_PAIR, (_match, quote: string, key: string, separator: string, scheme: string | undefined, value: string) =>
      `${quote}${key}${quote}${separator}${scheme ? `${scheme} ` : ''}${value === '***' ? value : '***'}`)
    // Bare provider keys and long token-like runs.
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/gu, '***')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/gu, '***')
    .replace(/(?:\b[A-Za-z]:\\|\\\\)[^\s'"`]*/gu, path => `…\\${path.split(/[\\/]/u).filter(Boolean).pop() ?? ''}`)
    .replace(/(^|[\s'"`(=])((?:\/[^\s'"`/)]+)+\/?)/gu, (_match, before: string, path: string) => `${before}…/${path.split('/').filter(Boolean).pop() ?? ''}`)
    // Token-like: 24+ token characters with at least one digit (plain hyphenated codes stay readable).
    .replace(/(?=[A-Za-z0-9_\-+/=]*\d)[A-Za-z0-9_\-+/=]{24,}/gu, '***');
  if (!text) return 'unknown error';
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text;
}

/** A `zhin …` command a failure message tells the operator to run (`…; run zhin migrate instances`). */
function suggestedCommand(reason: string): string | undefined {
  return /\brun\s+`?(zhin(?:\s+[a-z][\w-]*)+)/iu.exec(reason)?.[1];
}

/**
 * Logs why attention sources are unavailable, once per key until the reason changes or
 * `intervalMs` passes, so a broken source does not log on every poll.
 */
export class AttentionWarnings {
  readonly #log: (message: string) => void;
  readonly #debug: (message: string) => void;
  readonly #interval: number;
  readonly #now: () => number;
  readonly #last = new Map<string, { readonly reason: string; readonly at: number }>();

  constructor(log: (message: string) => void, options: { readonly intervalMs?: number; readonly now?: () => number; readonly debug?: (message: string) => void } = {}) {
    this.#log = log;
    this.#debug = options.debug ?? (() => undefined);
    this.#interval = options.intervalMs ?? 10 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  /** Logs `reason` for `key` unless the same reason was logged within the interval; true when logged. */
  warn(key: string, reason: string): boolean {
    const at = this.#now();
    const last = this.#last.get(key);
    if (last && last.reason === reason && at - last.at < this.#interval) return false;
    this.#last.set(key, { reason, at });
    this.#log(`attention.list: ${key}: ${reason}`);
    return true;
  }

  /** Expected, transient unavailability (the instance is starting or stopping): debug only, never a warning. */
  debug(key: string, reason: string): void {
    this.#debug(`attention.list: ${key}: ${reason}`);
  }
}

/** The Root refused a read because it is not running (starting, stopping): expected, not a fault. */
export function isAttentionNotReady(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : undefined;
  return typeof record?.message === 'string' && /is not accepting generation operations/u.test(record.message);
}

// ---------------------------------------------------------------- shared reads

/** Sources whose raw reads are shared between requests (the rest are live and cheap). */
export type AttentionCachedSource = 'plugins' | 'config' | 'mcp' | 'logs' | 'inference' | 'agent-config';

export interface AttentionSourceCacheOptions {
  /** How long a raw read is reused (default 15 s). */
  readonly ttlMs?: number;
  readonly now?: () => number;
  /** Revision signal; a change invalidates every cached read. */
  readonly revision?: () => string | Promise<string>;
}

/**
 * Shares the raw (unfiltered) reads of the expensive sources between `attention.list` requests:
 * concurrent requests wait for the same read, later ones reuse it until it is `ttlMs` old or the
 * revision changes. A failed read is not kept. Permission filtering always runs per caller on
 * top of the shared read; the cache never holds per-principal output.
 */
export class AttentionSourceCache {
  readonly #ttl: number;
  readonly #now: () => number;
  readonly #revision?: () => string | Promise<string>;
  readonly #entries = new Map<AttentionCachedSource, { readonly at: number; readonly revision: string; readonly value: Promise<unknown> }>();

  constructor(options: AttentionSourceCacheOptions = {}) {
    this.#ttl = options.ttlMs ?? 15_000;
    this.#now = options.now ?? Date.now;
    if (options.revision) this.#revision = options.revision;
  }

  async read<T>(name: AttentionCachedSource, load: () => Promise<T>): Promise<T> {
    let revision: string;
    // An unreadable revision never matches a cached read.
    try { revision = this.#revision ? await this.#revision() : ''; } catch { revision = `unknown:${this.#now()}`; }
    const at = this.#now();
    const entry = this.#entries.get(name);
    if (entry && entry.revision === revision && at - entry.at < this.#ttl) return entry.value as Promise<T>;
    const value = Promise.resolve().then(load);
    const next = { at, revision, value };
    this.#entries.set(name, next);
    value.catch(() => { if (this.#entries.get(name) === next) this.#entries.delete(name); });
    return value;
  }

  /** Drops every cached read. */
  clear(): void { this.#entries.clear(); }
}

// ---------------------------------------------------------------- first observation

/**
 * When the Host first saw each item (for sources without their own start time). An entry is
 * dropped once a read of its source no longer reports it, so a problem that comes back starts anew.
 */
export class AttentionObservations {
  readonly #seen = new Map<string, { readonly source: AttentionSourceName; readonly at: number }>();

  /** First observation of `id`, recording `now` when it is new. */
  since(id: string, source: AttentionSourceName, now: number): number {
    const entry = this.#seen.get(id);
    if (entry) return entry.at;
    this.#seen.set(id, { source, at: now });
    return now;
  }

  /** Forgets items of `source` that its latest read did not report. */
  settle(source: AttentionSourceName, present: ReadonlySet<string>): void {
    for (const [id, entry] of this.#seen) if (entry.source === source && !present.has(id)) this.#seen.delete(id);
  }

  get size(): number { return this.#seen.size; }
}

// ---------------------------------------------------------------- text

const messages = createMessages({
  'login.title': { 'zh-CN': '{account} 等待登录', en: '{account} is waiting to sign in' },
  'login.detail': { 'zh-CN': '需要完成{step}才能上线，超时后登录会被取消。', en: 'Complete the {step} step to bring it online; the sign-in is cancelled if it times out.' },
  'login.action': { 'zh-CN': '去处理登录', en: 'Open sign-in' },
  'login.step.qrcode': { 'zh-CN': '扫码', en: 'QR code' },
  'login.step.sms': { 'zh-CN': '短信验证', en: 'SMS code' },
  'login.step.slider': { 'zh-CN': '滑块验证', en: 'slider' },
  'login.step.device': { 'zh-CN': '设备验证', en: 'device verification' },
  'login.step.auth': { 'zh-CN': '授权', en: 'authorization' },
  'login.step.other': { 'zh-CN': '登录步骤', en: 'sign-in' },
  'endpoint.title': { 'zh-CN': '{account} 离线', en: '{account} is offline' },
  'endpoint.detail': { 'zh-CN': '连接状态：{state}。检查凭据、网络和适配器日志，或在「接入」里测试连接。', en: 'Connection: {state}. Check credentials, network and adapter logs, or test the connection under Connection.' },
  'endpoint.state.idle': { 'zh-CN': '未启动', en: 'not started' },
  'endpoint.state.connecting': { 'zh-CN': '连接中', en: 'connecting' },
  'endpoint.state.open': { 'zh-CN': '已连接', en: 'connected' },
  'endpoint.state.reconnecting': { 'zh-CN': '重连中', en: 'reconnecting' },
  'endpoint.state.closed': { 'zh-CN': '已断开', en: 'disconnected' },
  'endpoint.state.stopped': { 'zh-CN': '已停止', en: 'stopped' },
  'endpoint.state.unknown': { 'zh-CN': '未知', en: 'unknown' },
  'endpoint.action': { 'zh-CN': '查看接入', en: 'Open connection' },
  'endpoint.reason': { 'zh-CN': '最近一次启动失败（{category}）：{message}', en: 'Last start failed ({category}): {message}' },
  'drift.title': { 'zh-CN': '{adapter} 的配置文件账号与已保存账号不一致', en: 'Accounts of {adapter} in the configuration file differ from the saved ones' },
  'drift.configOnly': { 'zh-CN': '仅在配置文件（未运行）：{ids}', en: 'Only in the configuration file (not running): {ids}' },
  'drift.savedOnly': { 'zh-CN': '已不在配置文件（仍按已保存账号运行）：{ids}', en: 'No longer in the configuration file (still run as saved): {ids}' },
  'drift.changed': { 'zh-CN': '配置不同：{ids}', en: 'Configured differently: {ids}' },
  'drift.detail': { 'zh-CN': '{parts}。配置文件里的 endpoints 只在首次启动时导入；之后以已保存账号为准。请在账号页「从配置导入」或「写回配置文件」。', en: '{parts}. The endpoints list is only imported on first start; the saved accounts win afterwards. Import from the configuration or write back on the accounts page.' },
  'drift.action': { 'zh-CN': '处理账号差异', en: 'Review accounts' },
  'plugin.error.title': { 'zh-CN': '插件 {plugin} 运行异常', en: 'Plugin {plugin} has a problem' },
  'plugin.inspect.title': { 'zh-CN': '无法读取插件 {plugin} 的状态', en: 'Cannot read the state of plugin {plugin}' },
  'plugin.inspect.all.title': { 'zh-CN': '{count} 个插件的状态都无法读取', en: 'Cannot read the state of {count} plugins' },
  'plugin.inspect.detail': { 'zh-CN': '原因：{reason}', en: 'Reason: {reason}' },
  'plugin.inspect.hint': { 'zh-CN': '运行 `{command}` 后刷新。', en: 'Run `{command}`, then refresh.' },
  'plugin.dependencies.title': { 'zh-CN': '插件依赖未满足', en: 'Plugin dependencies are not met' },
  'plugin.dependencies.action': { 'zh-CN': '查看插件', en: 'Open plugins' },
  'plugin.config.title': { 'zh-CN': '插件 {plugin} 的配置需要修正', en: 'Configuration of plugin {plugin} needs fixing' },
  'plugin.missingEnv': { 'zh-CN': '未设置的环境变量：{names}', en: 'Unset environment variables: {names}' },
  'plugin.action': { 'zh-CN': '查看插件', en: 'Open plugin' },
  'command.title.command': { 'zh-CN': '插件 {plugin} 的命令「{command}」与插件 {other} 重名，没有注册', en: 'Command "{command}" of plugin {plugin} clashes with plugin {other} and was not registered' },
  'command.title.alias': { 'zh-CN': '插件 {plugin} 的命令「{command}」的别名「{entry}」已被占用，已跳过该别名', en: 'Alias "{entry}" of command "{command}" (plugin {plugin}) is taken and was skipped' },
  'command.title.shortcut': { 'zh-CN': '插件 {plugin} 的命令「{command}」的快捷方式「{entry}」已被占用，已跳过', en: 'Shortcut "{entry}" of command "{command}" (plugin {plugin}) is taken and was skipped' },
  'command.holder.command': { 'zh-CN': '插件 {plugin} 的命令「{command}」', en: 'command "{command}" of plugin {plugin}' },
  'command.holder.alias': { 'zh-CN': '插件 {plugin} 的命令「{command}」的别名「{entry}」', en: 'alias "{entry}" of command "{command}" (plugin {plugin})' },
  'command.holder.shortcut': { 'zh-CN': '插件 {plugin} 的命令「{command}」的快捷方式「{entry}」', en: 'shortcut "{entry}" of command "{command}" (plugin {plugin})' },
  'command.detail.command': { 'zh-CN': '「{route}」已由{holder}使用，先注册的保留，{plugin} 的这条命令（连同它的别名）没有注册。', en: '"{route}" is already used by {holder}; the earlier registration keeps it, so this command of {plugin} (and its aliases) is not registered.' },
  'command.detail.entry': { 'zh-CN': '「{route}」已由{holder}使用，只跳过了这个{what}，命令本身照常可用。', en: '"{route}" is already used by {holder}; only this {what} was skipped, the command itself still works.' },
  'command.what.alias': { 'zh-CN': '别名', en: 'alias' },
  'command.what.shortcut': { 'zh-CN': '快捷方式', en: 'shortcut' },
  'command.advice': { 'zh-CN': '建议让其中一个插件改名（或给 {plugin} 配置 commandNamespace），或在配置里禁用其中一条：{plugin} 的 disabledCommands: [{path}]，或 {other} 的 disabledCommands: [{otherPath}]；也可以停用其中一个插件。', en: 'Rename one of them (or give {plugin} a commandNamespace), or disable one in the configuration: disabledCommands: [{path}] on {plugin}, or disabledCommands: [{otherPath}] on {other}; or disable one of the plugins.' },
  'command.takenByLater': { 'zh-CN': '注意：「{entry}」原来由 {plugin} 处理，现在改由后加载的 {other} 的命令处理，用户熟悉的指令已经换了处理方。', en: 'Note: "{entry}" used to run {plugin}; it now runs a command of {other}, which loads later, so users get a different command for text they know.' },
  'command.rootPlugin': { 'zh-CN': '项目根插件', en: 'the project root plugin' },
  'config.invalid.title': { 'zh-CN': '配置文件无法读取', en: 'The configuration file cannot be read' },
  'config.invalid.detail': { 'zh-CN': '{where}：{kind}。修正文件后重新读取。', en: '{where}: {kind}. Fix the file and reload.' },
  'config.invalid.file': { 'zh-CN': '配置文件', en: 'Configuration file' },
  'config.invalid.at': { 'zh-CN': '{file}（第 {line} 行，第 {column} 列）', en: '{file} (line {line}, column {column})' },
  'config.invalid.line': { 'zh-CN': '{file}（第 {line} 行）', en: '{file} (line {line})' },
  'config.invalid.kind.syntax': { 'zh-CN': '{format} 语法错误', en: '{format} syntax error' },
  'config.invalid.kind.root': { 'zh-CN': '根节点必须是对象', en: 'the document root must be an object' },
  'config.invalid.kind.io': { 'zh-CN': '无法读取（{code}）', en: 'cannot be read ({code})' },
  'config.invalid.kind.other': { 'zh-CN': '无法读取或解析', en: 'cannot be read or parsed' },
  'config.apply.title': { 'zh-CN': '最近一次配置改动没有生效', en: 'The last configuration change did not take effect' },
  'config.apply.detail': { 'zh-CN': '应用结果：{status}。打开配置文件核对后重新应用。', en: 'Result: {status}. Review the configuration and apply it again.' },
  'config.apply.failed': { 'zh-CN': '失败', en: 'failed' },
  'config.apply.blocked': { 'zh-CN': '被阻止', en: 'blocked' },
  'config.apply.unconfirmed': { 'zh-CN': '未确认', en: 'unconfirmed' },
  'config.apply.invalid': { 'zh-CN': '无效', en: 'invalid' },
  'config.secrets.title': { 'zh-CN': '配置文件中有 {count} 个明文密钥', en: 'Secrets stored as plain text in the configuration: {count}' },
  'config.secrets.detail': { 'zh-CN': '{paths}。运行 zhin doctor --fix 把它们移到 .env 并改为 ${…} 引用。', en: '{paths}. Run zhin doctor --fix to move them to .env as ${…} references.' },
  'config.action': { 'zh-CN': '打开配置文件', en: 'Open configuration' },
  'approval.title': { 'zh-CN': '工具 {tool} 等待审批', en: 'Tool {tool} is waiting for approval' },
  'approval.detail': { 'zh-CN': '来自{session}；超时无人处理会被拒绝。', en: 'Requested in {session}; it is denied if nobody decides in time.' },
  'approval.session.named': { 'zh-CN': '会话「{name}」', en: 'the conversation “{name}”' },
  'approval.session.group': { 'zh-CN': '{account} 的群 {scene}', en: 'group {scene} on {account}' },
  'approval.session.channel': { 'zh-CN': '{account} 的频道 {scene}', en: 'channel {scene} on {account}' },
  'approval.session.private': { 'zh-CN': '{account} 的私聊 {scene}', en: 'a private chat ({scene}) on {account}' },
  'approval.session.other': { 'zh-CN': '一个会话', en: 'a conversation' },
  'approval.action': { 'zh-CN': '去审批', en: 'Review' },
  'mcp.title': { 'zh-CN': 'MCP 服务 {server} 未连接', en: 'MCP server {server} is not connected' },
  'mcp.detail': { 'zh-CN': 'Agent 暂时无法调用它提供的工具。', en: 'The Agent cannot use its tools for now.' },
  'mcp.reason': { 'zh-CN': '最近一次连接失败（{category}）：{message}', en: 'Last connect failed ({category}): {message}' },
  'restored': { 'zh-CN': '（重启前记录）', en: ' (recorded before the restart)' },
  'inference.title.reauthorize': { 'zh-CN': '模型账号 {account} 需要重新登录', en: 'Model account {account} must sign in again' },
  'inference.title.disconnected': { 'zh-CN': '模型账号 {account} 已断开', en: 'Model account {account} is disconnected' },
  'inference.title.uncertain': { 'zh-CN': '模型账号 {account} 的登录结果未知', en: 'The sign-in result of model account {account} is unknown' },
  'inference.title.preparation-failed': { 'zh-CN': '模型账号 {account} 已登录，但准备未完成', en: 'Model account {account} is signed in but its preparation failed' },
  'inference.detail.reauthorize': { 'zh-CN': '服务「{service}」的凭据已失效，使用它的用途暂时无法调用模型。请在模型服务里重新登录。', en: 'The credential for "{service}" is no longer valid; purposes using it cannot call the model. Sign in again under model services.' },
  'inference.detail.disconnected': { 'zh-CN': '服务「{service}」的账号已断开连接。请在模型服务里重新登录。', en: 'The account for "{service}" was disconnected. Sign in again under model services.' },
  'inference.detail.uncertain': { 'zh-CN': '服务「{service}」最近一次登录没有得到明确结果{failure}。请在模型服务里重新读取状态或重新登录。', en: 'The last sign-in for "{service}" ended without a clear result{failure}. Reload its state or sign in again under model services.' },
  'inference.detail.preparation': { 'zh-CN': '服务「{service}」准备失败：{facts}。{hint}', en: 'Preparation for "{service}" failed: {facts}. {hint}' },
  'inference.hint.project': { 'zh-CN': '在该模型服务的配置中填写 Google Cloud 项目 ID（projectId），保存后点「完成准备」。', en: 'Set the Google Cloud project ID (projectId) of this model service, save, then finish the preparation.' },
  'inference.hint.unsupportedClient': { 'zh-CN': '上游拒绝了这个客户端的自动开通（UNSUPPORTED_CLIENT）：Antigravity 直连目前可能卡在这一步。可在该模型服务的配置中填写自己的 Google Cloud 项目 ID（projectId）后重试，或改用其他接入方式。', en: 'The upstream refused automatic onboarding for this client (UNSUPPORTED_CLIENT): direct Antigravity onboarding may currently stop here. Set your own Google Cloud project ID (projectId) on the model service and retry, or use another way in.' },
  'inference.hint.validation': { 'zh-CN': '该账号需要先在浏览器里完成 Google 的账号验证，之后再点「完成准备」。', en: 'Verify the account with Google in a browser first, then finish the preparation.' },
  'inference.hint.retry': { 'zh-CN': '这通常是暂时的，稍后在模型服务里点「完成准备」重试。', en: 'This is usually temporary; retry the preparation later.' },
  'inference.hint.other': { 'zh-CN': '在模型服务里查看账号后点「完成准备」重试。', en: 'Review the account under model services and retry the preparation.' },
  'inference.action': { 'zh-CN': '查看模型服务', en: 'Open model services' },
  'ineffective.title': { 'zh-CN': '配置 {path} 没有生效', en: 'Setting {path} has no effect' },
  'ineffective.detail.binding-name': { 'zh-CN': '这个键属于同名的 Agent 绑定，子 Agent {agents} 不会用它，仍用聊天模型。请改用子 Agent 的完整名称（插件名__Agent 名）作为键。', en: 'This key belongs to the Agent binding of that name; sub-agent {agents} does not use it and runs on the chat model. Key it by the qualified name (plugin__agent) instead.' },
  'ineffective.detail.ambiguous': { 'zh-CN': '有多个子 Agent 叫这个名字（{agents}），无法确定指哪一个，它们都仍用聊天模型。请改用完整名称（插件名__Agent 名）作为键。', en: 'Several sub-agents share this name ({agents}), so none uses it and they run on the chat model. Key it by the qualified name (plugin__agent) instead.' },
  'ineffective.detail.no-target': { 'zh-CN': '没有 Agent 绑定或子 Agent 叫这个名字，这个模型选择不会被使用。请改为子 Agent 的完整名称（插件名__Agent 名），或删除它。', en: 'No Agent binding or sub-agent has this name, so this model choice is never used. Use a sub-agent qualified name (plugin__agent) or remove it.' },
  'ineffective.action': { 'zh-CN': '打开模型用途', en: 'Open model purposes' },
  'mcp.action': { 'zh-CN': '查看 MCP', en: 'Open MCP' },
  'logs.title': { 'zh-CN': '最近 {hours} 小时日志里有 {count} 条错误', en: 'Errors in the logs (last {hours} h): {count}' },
  'logs.detail': { 'zh-CN': '只统计最近 {hours} 小时的错误；更早的错误不再提醒，仍可在错误日志里查看。', en: 'Counts errors from the last {hours} hours only; older errors no longer raise this item and stay in the error log.' },
  'logs.action': { 'zh-CN': '打开错误日志', en: 'Open error logs' },
  'schedule.title': { 'zh-CN': '定时任务「{job}」不会再运行', en: 'Scheduled task "{job}" will not run' },
  'schedule.detail.invalid_schedule': { 'zh-CN': '它已启用，但调度规则无效，算不出下次运行时间。修改规则或暂停它。', en: 'It is enabled, but its schedule is invalid and has no next run. Fix the schedule or pause it.' },
  'schedule.detail.no_next_run': { 'zh-CN': '它已启用，但按当前规则没有下一次运行时间。修改规则或暂停它。', en: 'It is enabled, but its schedule has no next run. Change the schedule or pause it.' },
  'schedule.detail.expired': { 'zh-CN': '它已启用，但单次执行时间已过且没有运行。重新设置时间或删除它。', en: 'It is enabled, but its one-time run is in the past and never ran. Set a new time or delete it.' },
  'schedule.action': { 'zh-CN': '查看定时任务', en: 'Open scheduled tasks' },
  'roles.noOwner.title': { 'zh-CN': '还没有聊天主人（全局 owner）', en: 'There is no chat owner (global owner) yet' },
  'roles.noOwner.detail': {
    'zh-CN': '危险工具、改配置与重启等宿主能力只对全局 owner 开放。先「把聊天身份绑定到我」（私聊机器人发送「绑定 <码>」），再在「聊天角色」中把自己设为全局 owner；平台群主不会自动成为 zhin 角色。',
    en: 'Host-wide abilities (dangerous tools, configuration, restart) need a global owner. Bind your chat identity first (send 「bind <code>」 to the bot in a private chat), then grant yourself global owner under Chat roles; platform group owners never become zhin roles automatically.',
  },
  'roles.noOwner.claim': {
    'zh-CN': '也可以私聊机器人发送「认领 <码>」，认领码见 zhin status（一次性，重启轮换；日志只记哈希前缀）。',
    en: 'Or send 「claim <code>」 to the bot in a private chat; zhin status shows the code (one-time, rotates on restart; logs carry only a hash prefix).',
  },
  'roles.action': { 'zh-CN': '打开聊天角色', en: 'Open chat roles' },
  'roles.imported.title': { 'zh-CN': '已从配置导入 {count} 条聊天角色', en: '{count} chat role grants were imported from the configuration' },
  'roles.imported.detail': { 'zh-CN': '{entries}。核对后可在「聊天角色」中撤销，并确认已读。', en: '{entries}. Review them, revoke any under Chat roles, then mark this as read.' },
  'roles.imported.promote': {
    'zh-CN': '账号层 owner 不等于宿主主人；还没有全局 owner 时，可在「聊天角色」中把其中一位提升为全局 owner。',
    en: 'An account-level owner is not the host owner; with no global owner yet, you may promote one of them to global owner under Chat roles.',
  },
  'roles.imported.personalLine': {
    'zh-CN': 'ai.personalPrincipals：Console 用户 {user} ↔ {identity}（只链接，不授予角色）',
    en: 'ai.personalPrincipals: Console user {user} ↔ {identity} (linked only, no role)',
  },
  'roles.imported.promoteMe': {
    'zh-CN': '其中链接到你的 Console 账号的人还没有角色，而这里还没有全局 owner：是否同时把这个人设为全局 owner？请在「我的聊天身份」中确认。',
    en: 'The person linked to your Console account holds no role and there is no global owner yet: make that person the global owner as well? Confirm under My chat identity.',
  },
  'roles.imported.promoteMeAction': { 'zh-CN': '设为全局 owner…', en: 'Make global owner…' },
  'roles.pending.title': { 'zh-CN': '配置中有 {count} 条人员名单或身份链接等待确认', en: '{count} people-list or identity-link entries from the configuration wait for review' },
  'roles.pending.personalLine': {
    'zh-CN': 'Console 用户 {user} ↔ {identity}',
    en: 'Console user {user} ↔ {identity}',
  },
  'roles.pending.personalDetail': {
    'zh-CN': 'ai.personalPrincipals 中新的或已修改的链接：{entries}。链接不授予角色，但会让该 Console 账号以这个人发言（Sandbox），因此不会自动生效；逐条「导入」或「忽略」。',
    en: 'New or changed ai.personalPrincipals links: {entries}. A link grants no role but lets that Console account speak as the person (Sandbox), so it never applies by itself; import or ignore each.',
  },
  'roles.pending.detail': {
    'zh-CN': '{entries}。它们没有被自动授予（改配置的人不一定是主人），已从配置文件移除；逐条「导入」或「忽略」。',
    en: '{entries}. They were not granted automatically (whoever edits the file is not necessarily an owner) and were removed from the file; import or ignore each.',
  },
});

const LOGIN_STEPS = new Set(['qrcode', 'sms', 'slider', 'device', 'auth']);
const TRANSPORT_STATES = new Set(['idle', 'connecting', 'open', 'reconnecting', 'closed', 'stopped']);
const MAX_LISTED = 5;
const MAX_DETAIL = 500;

function clip(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

function listed(values: readonly string[], locale: Locale): string {
  const shown = values.slice(0, MAX_LISTED).join(locale === 'en' ? ', ' : '、');
  return values.length > MAX_LISTED ? `${shown} …(+${values.length - MAX_LISTED})` : shown;
}

const segment = (value: string) => encodeURIComponent(value);

/** Console deep links (console-routes.mjs). */
export const ATTENTION_PATHS = Object.freeze({
  /** `/scope/<adapter>/<name>`: the Console scope picker's account route (`endpoint.list` row `adapter` / `name`). */
  endpointAccess: (adapter: string, endpoint: string) => `/scope/${segment(adapter)}/${segment(endpoint)}?tab=access`,
  adapterAccounts: (instanceKey: string) => `/plugins/${segment(instanceKey)}`,
  plugin: (instanceKey: string) => `/plugins/${segment(instanceKey)}`,
  plugins: '/plugins',
  config: '/ops/config',
  toolApprovals: '/ops/schedules?tab=admin',
  mcp: '/introspection?tab=mcp',
  /** Model services page, focused on one account (#1270). */
  inferenceAccount: (accountId: string) => `/features/ai?account=${segment(accountId)}`,
  /** Model purposes page (#1270). */
  inferencePurposes: '/features/ai?tab=purposes',
  schedules: '/ops/schedules',
  errorLogs: '/logs?level=error',
  /** Global scope page, chat roles tab (ADR 0056 §3 / ADR 0060 §7). */
  chatRoles: '/scope?tab=roles',
  /** Console 「聊天成员」 page, own identity panel (ADR 0060 §3.1 「设为全局 owner」). */
  chatIdentityMe: '/chat-members?me=1',
});

// ---------------------------------------------------------------- configuration problems

/** What `config.invalid` may say about an unreadable file: never the parser's excerpt or an absolute path. */
export interface AttentionConfigProblem {
  /** Project-relative file name (base name outside the project); `null` when unknown. */
  readonly file: string | null;
  readonly kind: 'syntax' | 'root' | 'io' | 'other';
  readonly format?: 'YAML' | 'JSON';
  /** `E…` system error code for `io`. */
  readonly code?: string;
  readonly line?: number;
  readonly column?: number;
}

const ROOT_NOT_OBJECT = 'The document root must be an object';

function displayFile(file: string, projectRoot: string | undefined): string {
  if (projectRoot) {
    const relativePath = relative(projectRoot, resolve(projectRoot, file));
    if (relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath)) return relativePath.split(sep).join('/');
  }
  return basename(file);
}

function positionOf(text: string): { line: number; column?: number } | undefined {
  const both = /\bline (\d+),? column (\d+)/u.exec(text);
  if (both) return { line: Number(both[1]), column: Number(both[2]) };
  const line = /\bline (\d+)/u.exec(text);
  return line ? { line: Number(line[1]) } : undefined;
}

/** Reduces a configuration read error to file + position + kind. */
export function describeConfigProblem(error: unknown, projectRoot?: string): AttentionConfigProblem {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const path = typeof record.file === 'string' ? record.file : typeof record.path === 'string' ? record.path : undefined;
  const file = path ? displayFile(path, projectRoot) : null;
  if (record.name === 'ConfigDocumentParseError' && Array.isArray(record.issues)) {
    const issues = record.issues.filter((issue): issue is string => typeof issue === 'string');
    const format = record.format === 'JSON' ? 'JSON' as const : 'YAML' as const;
    if (issues.length > 0 && issues.every(issue => issue === ROOT_NOT_OBJECT)) return Object.freeze({ file, kind: 'root', format });
    const position = issues.map(positionOf).find(Boolean);
    return Object.freeze({ file, kind: 'syntax', format, ...position });
  }
  if (typeof record.code === 'string' && /^E[A-Z0-9]+$/u.test(record.code)) return Object.freeze({ file, kind: 'io', code: record.code });
  return Object.freeze({ file, kind: 'other' });
}

// ---------------------------------------------------------------- collection

export interface CollectAttentionOptions {
  readonly locale?: unknown;
  readonly allows: AttentionAllows;
  readonly observations?: AttentionObservations;
  readonly now?: () => number;
  /** Plugin permission levels for `tool_approvals:read` / `ops:approve`. */
  readonly allowsPluginPermission?: (permission: string) => boolean;
  /** Shares the raw reads of plugins / config / MCP / logs between requests. */
  readonly cache?: AttentionSourceCache;
  /** Logs unavailable sources and failed plugin reads (rate-limited per key). */
  readonly warnings?: AttentionWarnings;
  /** The signed-in Console user (`user:<id>` without the prefix); items about the viewer's own link use it. */
  readonly viewerUserId?: string;
}

/** Inference preparation reasons that a retry may fix. */
const TRANSIENT_PREPARATION = new Set(['preparation-timeout', 'onboarding-timeout', 'request-timeout', 'transport']);

/** Which hint explains a preparation failure (route messages use the same split). */
export function preparationHint(failure: Readonly<{ reason?: string; upstreamStatus?: number }>): 'project' | 'unsupportedClient' | 'validation' | 'retry' | 'other' {
  if (failure.reason === 'UNSUPPORTED_CLIENT') return 'unsupportedClient';
  if (failure.reason === 'project-required') return 'project';
  if (failure.reason === 'validation-required') return 'validation';
  if (TRANSIENT_PREPARATION.has(failure.reason ?? '') || (failure.upstreamStatus ?? 0) >= 500) return 'retry';
  return 'other';
}

const P = CONSOLE_PERMISSIONS;
const TOOL_APPROVAL_READ = ['tool_approvals:read', 'ops:approve'] as const;

const endpointTarget = (adapter: string, endpoint: string): ConsoleScopeTarget => Object.freeze({ kind: 'endpoint', adapter, endpoint });
const accountKey = (adapter: string, name: string) => `${adapter}\u0000${name}`;
/** Endpoint phases of an account whose last start attempt failed (#1250). */
const START_FAILED_PHASES: ReadonlySet<string> = new Set(['failed', 'retrying']);

/** An item before its source's read is known to be complete. */
interface AttentionDraft {
  readonly kind: ConsoleAttentionKind;
  readonly severity: ConsoleAttentionSeverity;
  readonly subject?: ConsoleAttentionSubject;
  readonly state: unknown;
  readonly title: string;
  readonly detail: string;
  readonly action: { readonly label: string; readonly path: string };
  /** The source's own start time; otherwise the first observation. */
  readonly since?: number;
  /** Observed regardless of the caller; listed only when this is true. */
  readonly visible?: boolean;
  /** Structured reason (#1270). */
  readonly reason?: ConsoleAttentionReason;
}

interface ConfigRead {
  readonly source?: Awaited<ReturnType<AttentionConfiguration['source']>>;
  readonly problem?: AttentionConfigProblem;
  readonly secrets: readonly { readonly path: readonly string[] }[];
}

/**
 * The login task's account in Console terms (`adapter` / `name` of its `endpoint.list` row),
 * matched like the Endpoint runtime matches login flows; the task's own fields otherwise.
 */
function loginAccount(task: AttentionLoginTask, rows: readonly AttentionEndpoint[] | undefined): { adapter: string; name: string; id?: string; adapterType?: string } {
  const row = task.canonicalId !== undefined
    ? rows?.find(item => item.id === task.canonicalId)
    : rows?.find(item => item.adapter === task.adapter && (item.name === task.endpointKey || (item.id !== undefined && item.id === task.endpointKey)));
  if (row) {
    return { adapter: row.adapter, name: row.name, ...(row.id !== undefined ? { id: row.id } : {}), ...(row.adapterType !== undefined ? { adapterType: row.adapterType } : {}) };
  }
  return { adapter: task.adapter, name: task.endpointKey, ...(task.canonicalId !== undefined ? { id: task.canonicalId } : {}) };
}

/** Gathers, filters and sorts the attention items the caller may view. */
export async function collectAttention(sources: AttentionSources, options: CollectAttentionOptions): Promise<ConsoleAttentionList> {
  const locale = resolveLocale(options.locale);
  const t = (key: Parameters<typeof messages>[1], values?: Record<string, string | number>) => messages(locale, key, values);
  const now = options.now ?? Date.now;
  const at = now();
  const observations = options.observations ?? new AttentionObservations();
  const allows = options.allows;
  const shared = <T>(name: AttentionCachedSource, load: () => Promise<T>): Promise<T> => options.cache ? options.cache.read(name, load) : load();
  const items: ConsoleAttentionItem[] = [];
  const unavailable: { readonly source: AttentionSourceName; readonly reason: string }[] = [];

  // A source is read only when the caller may view something it reports. A read is all or
  // nothing: its items (and observations) are committed only when the whole read succeeded, so a
  // source is either fully present or listed in `unavailable` with a sanitized reason (and a
  // rate-limited warning). Observations are settled from the full (unfiltered) read so another
  // viewer's filter never resets them.
  const read = async (name: AttentionSourceName, run: () => readonly AttentionDraft[] | Promise<readonly AttentionDraft[]>): Promise<void> => {
    let drafts: readonly AttentionDraft[];
    try { drafts = await run(); } catch (error) {
      const reason = attentionFailureReason(error);
      unavailable.push(Object.freeze({ source: name, reason }));
      // #1270: a Root that is starting or stopping is expected, not a fault worth a WARN.
      if (isAttentionNotReady(error)) options.warnings?.debug(`source ${name} unavailable`, reason);
      else options.warnings?.warn(`source ${name} unavailable`, reason);
      return;
    }
    const present = new Set<string>();
    for (const draft of drafts) {
      const id = attentionItemId(draft.kind, draft.subject);
      present.add(id);
      const since = draft.since ?? observations.since(id, name, at);
      if (draft.visible === false) continue;
      items.push(Object.freeze({
        id,
        revision: attentionRevision(draft.state),
        kind: draft.kind,
        severity: draft.severity,
        title: draft.title,
        detail: clip(draft.detail),
        ...(draft.subject ? { subject: Object.freeze({ ...draft.subject }) } : {}),
        since: new Date(since).toISOString(),
        action: Object.freeze({ ...draft.action }),
        source: name,
        ...(draft.reason ? { reason: Object.freeze({ ...draft.reason }) } : {}),
      }));
    }
    observations.settle(name, present);
  };

  // #1270: while the instance is starting no source can be read; answer that instead of N warnings.
  let ready: boolean;
  try { ready = sources.ready ? sources.ready() : true; } catch { ready = false; }
  if (!ready) {
    options.warnings?.debug('instance', 'starting');
    return Object.freeze({ status: 'starting' as const, items: Object.freeze([]), generatedAt: new Date(at).toISOString() });
  }

  const anyEndpointView = allows(P.ENDPOINT_VIEW, Object.freeze({ kind: 'any' }));
  // Endpoint rows (live): offline accounts, and the account each login task belongs to.
  let rows: readonly AttentionEndpoint[] | undefined;
  let rowsError: { readonly error: unknown } | undefined;
  if (sources.endpoints && anyEndpointView) {
    try { rows = await sources.endpoints(); } catch (error) { rowsError = { error }; }
  }

  const waiting = new Set<string>();
  if (sources.loginTasks && anyEndpointView) {
    await read('login-assist', () => sources.loginTasks!().map((task): AttentionDraft => {
      const account = loginAccount(task, rows);
      waiting.add(accountKey(account.adapter, account.name));
      const step = LOGIN_STEPS.has(task.type) ? task.type as 'qrcode' : 'other';
      return {
        kind: 'login.pending',
        severity: 'danger',
        subject: { adapter: account.adapter, endpointKey: account.name, loginTaskId: task.id },
        state: { type: task.type },
        title: t('login.title', { account: `${account.adapter} / ${account.name}` }),
        detail: t('login.detail', { step: t(`login.step.${step}`) }),
        action: { label: t('login.action'), path: ATTENTION_PATHS.endpointAccess(account.adapter, account.name) },
        since: task.createdAt,
        visible: allowsEndpointAccount(allows, P.ENDPOINT_VIEW, account),
      };
    }));
  }

  if (sources.endpoints && anyEndpointView) {
    await read('endpoints', () => {
      if (rowsError) throw rowsError.error;
      if (!rows) throw new Error('endpoints unavailable');
      // Offline for real: not connecting / reconnecting, not stopped on purpose, not waiting for a login step.
      // #1250: an account whose start failed (`failed`, or `retrying` with back-off) is offline too,
      // whatever its transport says; its `lastError` says why.
      return rows.filter(row => !row.connected
        && (START_FAILED_PHASES.has(row.phase) || (row.phase === 'offline' && row.transportState !== 'stopped'))
        && !row.pendingLogin && !waiting.has(accountKey(row.adapter, row.name))).map((row): AttentionDraft => {
        const detail = t('endpoint.detail', { state: t(`endpoint.state.${TRANSPORT_STATES.has(row.transportState) ? row.transportState as 'idle' : 'unknown'}`) });
        return {
          kind: 'endpoint.offline',
          severity: 'warning',
          subject: { adapter: row.adapter, endpointKey: row.name },
          state: { transportState: row.transportState, ...(START_FAILED_PHASES.has(row.phase) ? { phase: row.phase } : {}) },
          title: t('endpoint.title', { account: `${row.adapter} / ${row.name}` }),
          // #1250: the classified, redacted reason of the last failed start, when there is one.
          detail: row.lastError
            ? `${detail} ${t('endpoint.reason', { category: row.lastError.category, message: attentionFailureReason(row.lastError.message) })}${row.lastError.restored ? t('restored') : ''}`
            : detail,
          ...(row.lastError ? { reason: {
            category: row.lastError.category, code: 'start-failed', message: attentionFailureReason(row.lastError.message),
            ...(row.lastError.restored ? { restored: true } : {}),
            ...(row.lastError.at !== undefined ? { at: new Date(row.lastError.at).toISOString() } : {}),
          } } : {}),
          action: { label: t('endpoint.action'), path: ATTENTION_PATHS.endpointAccess(row.adapter, row.name) },
          visible: allowsEndpointAccount(allows, P.ENDPOINT_VIEW, row),
        };
      });
    });
  }

  if (sources.endpointConfigDrift && anyEndpointView) {
    await read('endpoint-config', async () => (await sources.endpointConfigDrift!()).map((drift): AttentionDraft => {
      const parts = [
        ...(drift.configOnly.length ? [t('drift.configOnly', { ids: listed(drift.configOnly, locale) })] : []),
        ...(drift.savedOnly.length ? [t('drift.savedOnly', { ids: listed(drift.savedOnly, locale) })] : []),
        ...(drift.changed.length ? [t('drift.changed', { ids: listed(drift.changed, locale) })] : []),
      ];
      return {
        kind: 'endpoint.config-drift',
        severity: 'warning',
        subject: { adapter: drift.instanceKey, plugin: drift.instanceKey },
        state: { configOnly: drift.configOnly, savedOnly: drift.savedOnly, changed: drift.changed },
        title: t('drift.title', { adapter: drift.instanceKey }),
        detail: t('drift.detail', { parts: parts.join(locale === 'en' ? '; ' : '；') }),
        action: { label: t('drift.action'), path: ATTENTION_PATHS.adapterAccounts(drift.instanceKey) },
        visible: allows(P.ENDPOINT_VIEW, Object.freeze({ kind: 'adapter', adapter: drift.instanceKey })),
      };
    }));
  }

  // #1250: command routes another registration already holds (the instance keeps running).
  if (sources.commandConflicts && allows(P.FEATURE_VIEW)) {
    await read('commands', () => sources.commandConflicts!().map((conflict): AttentionDraft => {
      const { skipped, kept, route } = conflict;
      // The Root plugin (the project's own `commands/`) has no plugin page and no instance key to show.
      const pluginName = (side: AttentionCommandClaimant) => side.root ? t('command.rootPlugin') : side.plugin;
      const display = (side: AttentionCommandClaimant) => ({ plugin: pluginName(side), command: side.command, entry: side.entry ?? '' });
      // What users type: the command's display name, or the alias / shortcut text (never a route shape).
      const typed = (side: AttentionCommandClaimant) => side.kind === 'command' ? side.command : side.entry ?? side.command;
      const holder = t(`command.holder.${kept.kind}`, display(kept));
      const detail = skipped.kind === 'command'
        ? t('command.detail.command', { route: typed(skipped), holder, plugin: pluginName(skipped) })
        : t('command.detail.entry', { route: typed(skipped), holder, what: t(`command.what.${skipped.kind}`) });
      const gap = locale === 'en' ? ' ' : '';
      const advice = t('command.advice', { plugin: pluginName(skipped), other: pluginName(kept),
        path: skipped.localPath || typed(skipped), otherPath: kept.localPath || typed(kept) });
      // #1250: a later plugin's command took an alias / shortcut of an earlier plugin: what users
      // were used to typing now silently runs another plugin's command.
      const taken = conflict.takenByLater
        ? t('command.takenByLater', { entry: typed(skipped), plugin: pluginName(skipped), other: pluginName(kept) }) : '';
      return {
        kind: 'command.conflict', severity: conflict.takenByLater ? 'danger' : 'warning',
        subject: { plugin: skipped.plugin, commandRoute: route, command: skipped.command, commandKind: skipped.kind },
        state: { skipped, kept, takenByLater: conflict.takenByLater === true },
        title: t(`command.title.${skipped.kind}`, { ...display(skipped), other: pluginName(kept) }),
        detail: [taken, detail, advice].filter(Boolean).join(gap),
        action: { label: t('plugin.action'), path: skipped.root ? ATTENTION_PATHS.plugins : ATTENTION_PATHS.plugin(skipped.plugin) },
        reason: { category: 'config', code: `command-${skipped.kind}-conflict` },
      };
    }));
  }

  if (sources.plugins && allows(P.FEATURE_VIEW)) {
    await read('plugins', async () => {
      const result = await shared('plugins', sources.plugins!);
      const drafts: AttentionDraft[] = [];
      // The dependency graph is the project's: one item, not one per plugin.
      if (result.dependencies?.status === 'failed') {
        drafts.push({ kind: 'plugin.dependencies', severity: 'danger', state: { error: result.dependencies.error },
          title: t('plugin.dependencies.title'), detail: result.dependencies.error,
          action: { label: t('plugin.dependencies.action'), path: ATTENTION_PATHS.plugins } });
      }
      // A plugin whose state cannot be read is reported on its own; the others still are. When
      // every declared plugin fails for the same reason (e.g. legacy lifecycle state), that is a
      // project problem: one item, not one per plugin.
      const failures = result.states.flatMap(settled => settled.status === 'rejected'
        ? [{ plugin: settled.instanceKey, reason: attentionFailureReason(settled.reason) }] : []);
      const inspectDetail = (reason: string) => {
        const command = suggestedCommand(reason);
        const detail = t('plugin.inspect.detail', { reason });
        if (!command) return detail;
        return `${detail}${/[.。!！?？]$/u.test(detail) ? '' : locale === 'en' ? '.' : '。'}${locale === 'en' ? ' ' : ''}${t('plugin.inspect.hint', { command })}`;
      };
      const reasons = new Set(failures.map(failure => failure.reason));
      if (failures.length > 1 && failures.length === result.states.length && reasons.size === 1) {
        const [reason] = reasons as Set<string>;
        const plugins = failures.map(failure => failure.plugin).sort();
        options.warnings?.warn('plugins inspect', `${reason} (${plugins.length} plugins)`);
        drafts.push({ kind: 'plugin.error', severity: 'danger', state: { inspect: reason, plugins },
          title: t('plugin.inspect.all.title', { count: plugins.length }), detail: inspectDetail(reason!),
          action: { label: t('plugin.dependencies.action'), path: ATTENTION_PATHS.plugins } });
        return drafts;
      }
      for (const failure of failures) {
        options.warnings?.warn(`plugin ${failure.plugin} inspect`, failure.reason);
        drafts.push({ kind: 'plugin.error', severity: 'danger', subject: { plugin: failure.plugin }, state: { inspect: failure.reason },
          title: t('plugin.inspect.title', { plugin: failure.plugin }), detail: inspectDetail(failure.reason),
          action: { label: t('plugin.action'), path: ATTENTION_PATHS.plugin(failure.plugin) } });
      }
      for (const settled of result.states) {
        if (settled.status === 'rejected') continue;
        const state = settled.value;
        if (state.disabled) continue;
        const subject = { plugin: state.instanceKey };
        const action = { label: t('plugin.action'), path: ATTENTION_PATHS.plugin(state.instanceKey) };
        if (state.status === 'degraded') {
          drafts.push({ kind: 'plugin.error', severity: 'danger', subject, state: { issues: state.issues },
            title: t('plugin.error.title', { plugin: state.instanceKey }), detail: state.issues.join('; '), action });
        }
        const validation = state.validation;
        if (validation && (!validation.valid || validation.missingEnv.length > 0)) {
          const parts = [
            ...validation.errors.slice(0, MAX_LISTED).map(error => error.path ? `${error.path}: ${error.message}` : error.message),
            ...(validation.missingEnv.length ? [t('plugin.missingEnv', { names: listed(validation.missingEnv, locale) })] : []),
          ];
          drafts.push({ kind: 'plugin.config', severity: 'warning', subject,
            state: { errors: validation.errors, missingEnv: validation.missingEnv },
            title: t('plugin.config.title', { plugin: state.instanceKey }), detail: parts.join('; '), action });
        }
      }
      return drafts;
    });
  }

  if (sources.configuration && allows(P.OPS_CONFIG_READ)) {
    const configuration = sources.configuration;
    const action = { label: t('config.action'), path: ATTENTION_PATHS.config };
    await read('config', async () => {
      const result = await shared('config', async (): Promise<ConfigRead> => {
        let source: ConfigRead['source'];
        try { source = await configuration.source(); }
        catch (error) { return { problem: describeConfigProblem(error, configuration.projectRoot), secrets: [] }; }
        return { source, secrets: configuration.literalSecrets ? await configuration.literalSecrets() : [] };
      });
      const drafts: AttentionDraft[] = [];
      if (result.problem) {
        const problem = result.problem;
        const file = problem.file ?? t('config.invalid.file');
        const where = problem.line === undefined ? file
          : problem.column === undefined ? t('config.invalid.line', { file, line: problem.line })
            : t('config.invalid.at', { file, line: problem.line, column: problem.column });
        const kind = problem.kind === 'syntax' ? t('config.invalid.kind.syntax', { format: problem.format ?? 'YAML' })
          : problem.kind === 'io' ? t('config.invalid.kind.io', { code: problem.code ?? '' })
            : t(`config.invalid.kind.${problem.kind}`);
        drafts.push({ kind: 'config.invalid', severity: 'danger', state: problem, title: t('config.invalid.title'),
          detail: t('config.invalid.detail', { where, kind }), action });
      }
      const source = result.source;
      if (source) {
        const groups = source.application?.groups ?? [];
        const status = source.applicationError
          ?? (groups.some(group => group.status === 'failed') ? 'failed' : groups.some(group => group.status === 'blocked') ? 'blocked' : undefined);
        if (status && status !== 'superseded') {
          drafts.push({ kind: 'config.apply-failed', severity: 'warning', state: { status, operation: source.application?.operationId ?? null },
            title: t('config.apply.title'), detail: t('config.apply.detail', { status: t(`config.apply.${status}`) }), action });
        }
      }
      if (result.secrets.length) {
        const paths = result.secrets.map(secret => formatPath(secret.path));
        drafts.push({ kind: 'config.literal-secrets', severity: 'warning', state: { paths },
          title: t('config.secrets.title', { count: result.secrets.length }), detail: t('config.secrets.detail', { paths: listed(paths, locale) }), action });
      }
      return drafts;
    });
  }

  const approvalsAllowed = options.allowsPluginPermission
    ? TOOL_APPROVAL_READ.some(permission => options.allowsPluginPermission!(permission))
    : TOOL_APPROVAL_READ.some(permission => allows(permission));
  if (sources.toolApprovals && approvalsAllowed) {
    await read('tool-approvals', () => (sources.toolApprovals!() ?? []).map((card): AttentionDraft => ({
      kind: 'tool-approval.pending', severity: 'warning', subject: { approvalId: card.id }, state: { id: card.id, sessionKey: card.sessionKey },
      title: t('approval.title', { tool: card.toolName }), detail: t('approval.detail', { session: approvalSession(card) }),
      action: { label: t('approval.action'), path: ATTENTION_PATHS.toolApprovals }, since: card.createdAt,
    })));
  }

  if (sources.mcpServers && allows(P.STATUS_VIEW)) {
    await read('mcp', async () => (await shared('mcp', async () => sources.mcpServers!()))
      .filter(server => !server.connected).map((server): AttentionDraft => {
        const failure = server.lastError;
        const message = failure ? attentionFailureReason(failure.message) : undefined;
        return {
          kind: 'mcp.disconnected', severity: 'warning', subject: { mcpServer: server.name },
          state: { connected: false, ...(failure ? { category: failure.category, message } : {}) },
          title: t('mcp.title', { server: server.name }),
          // #1270: say why, from the last failed connect (or the journal, before a restart).
          detail: failure
            ? `${t('mcp.detail')} ${t('mcp.reason', { category: failure.category, message: message! })}${server.restored ? t('restored') : ''}`
            : t('mcp.detail'),
          action: { label: t('mcp.action'), path: ATTENTION_PATHS.mcp },
          ...(failure ? { reason: {
            category: failure.category, code: 'connect-failed', message: message!,
            ...(server.restored ? { restored: true } : {}),
            ...(failure.at !== undefined ? { at: new Date(failure.at).toISOString() } : {}),
          } } : {}),
        };
      }));
  }

  if (sources.unschedulableJobs && allows(P.OPS_SCHEDULE_READ)) {
    await read('schedule', () => (sources.unschedulableJobs!() ?? []).map((job): AttentionDraft => {
      const reason = ['invalid_schedule', 'no_next_run', 'expired'].includes(job.reason) ? job.reason : 'no_next_run';
      return {
        kind: 'schedule.unschedulable', severity: 'warning', subject: { scheduleJobId: job.jobId }, state: { reason },
        title: t('schedule.title', { job: job.label || job.jobId }),
        detail: t(`schedule.detail.${reason}` as Parameters<typeof messages>[1]),
        action: { label: t('schedule.action'), path: ATTENTION_PATHS.schedules }, since: job.since,
      };
    }));
  }

  if (sources.errorLogs && allows(P.STATUS_VIEW)) {
    await read('logs', async () => {
      const logs = await shared('logs', sources.errorLogs!);
      if (logs === null) throw new Error('log store unavailable');
      if (logs.count <= 0) return [];
      const latest = logs.latest ? Date.parse(logs.latest) : Number.NaN;
      const hours = logs.windowHours ?? DEFAULT_ERROR_LOG_WINDOW_HOURS;
      return [{ kind: 'logs.errors', severity: 'info', state: { count: logs.count, latest: logs.latest, windowHours: hours },
        title: t('logs.title', { count: logs.count, hours }), detail: t('logs.detail', { hours }),
        action: { label: t('logs.action'), path: ATTENTION_PATHS.errorLogs },
        ...(Number.isNaN(latest) ? {} : { since: latest }) }];
    });
  }

  // #1270: Host model accounts that need an operator.
  if (sources.inferenceAccounts && allows(P.AGENT_VIEW)) {
    await read('inference', async () => (await shared('inference', sources.inferenceAccounts!)).map((account): AttentionDraft => {
      const name = account.label || account.accountId;
      const action = { label: t('inference.action'), path: ATTENTION_PATHS.inferenceAccount(account.accountId) };
      const subject = { inferenceAccount: account.accountId };
      if (account.state === 'preparation-failed') {
        const failure = account.preparationFailure ?? { code: 'preparation-failed' };
        const facts = [
          `code=${failure.code}`,
          ...(failure.step ? [`step=${failure.step}`] : []),
          ...(failure.upstreamStatus === undefined ? [] : [`upstreamStatus=${failure.upstreamStatus}`]),
          ...(failure.reason ? [`reason=${failure.reason}`] : []),
        ].join(' ');
        return {
          kind: 'inference.account', severity: 'danger', subject,
          state: { state: account.state, revision: account.revision, code: failure.code, step: failure.step ?? null, reason: failure.reason ?? null },
          title: t('inference.title.preparation-failed', { account: name }),
          detail: `${t('inference.detail.preparation', { service: account.serviceLabel, facts, hint: t(`inference.hint.${preparationHint(failure)}`) })}${failure.restored ? t('restored') : ''}`,
          action,
          ...(failure.at !== undefined ? { since: failure.at } : {}),
          reason: {
            category: 'preparation', code: failure.code,
            ...(failure.step ? { step: failure.step } : {}),
            ...(failure.reason ? { reason: failure.reason } : {}),
            ...(failure.upstreamStatus === undefined ? {} : { upstreamStatus: failure.upstreamStatus }),
            ...(failure.restored ? { restored: true } : {}),
            ...(failure.at !== undefined ? { at: new Date(failure.at).toISOString() } : {}),
          },
        };
      }
      const failure = account.failure ? ` (${account.failure}${account.failureStatus === undefined ? '' : ` HTTP ${account.failureStatus}`})` : '';
      return {
        kind: 'inference.account', severity: account.state === 'uncertain' ? 'warning' : 'danger', subject,
        state: { state: account.state, revision: account.revision, failure: account.failure ?? null },
        title: t(`inference.title.${account.state}`, { account: name }),
        detail: account.state === 'uncertain'
          ? t('inference.detail.uncertain', { service: account.serviceLabel, failure })
          : t(`inference.detail.${account.state}`, { service: account.serviceLabel }),
        action,
        reason: { category: 'auth', code: account.state,
          ...(account.failure ? { reason: account.failure } : {}),
          ...(account.failureStatus === undefined ? {} : { upstreamStatus: account.failureStatus }) },
      };
    }));
  }

  // #1270: saved settings the runtime ignores (e.g. a sub-agent model choice that falls back to chat).
  if (sources.ineffectiveConfig && allows(P.AGENT_VIEW)) {
    await read('agent-config', async () => (await shared('agent-config', sources.ineffectiveConfig!)).map((entry): AttentionDraft => ({
      kind: 'config.ineffective', severity: 'warning', subject: { configPath: entry.path },
      state: { reason: entry.reason, agents: entry.agents ?? [] },
      title: t('ineffective.title', { path: entry.path }),
      detail: t(`ineffective.detail.${entry.reason}`, { agents: entry.agents?.length ? listed(entry.agents, locale) : '—' }),
      action: { label: t('ineffective.action'), path: ATTENTION_PATHS.inferencePurposes },
      reason: { category: 'config', code: entry.reason },
    })));
  }

  // ADR 0060: chat role bootstrap and configuration import (global iam.manage only: who holds a
  // role and who was named in the configuration is not public).
  if (sources.chatRoles && allows(P.IAM_MANAGE)) {
    await read('chat-roles', async () => {
      const state = await sources.chatRoles!();
      const action = { label: t('roles.action'), path: ATTENTION_PATHS.chatRoles };
      const drafts: AttentionDraft[] = [];
      const who = (entry: { adapter: string; userId: string; role: string; source: string }) => `${entry.source}：${entry.adapter}:${entry.userId} → ${entry.role}`;
      if (!state.hasGlobalOwner) {
        drafts.push({ kind: 'chat-roles.no-owner', severity: 'warning', state: { claimOpen: state.claimOpen },
          title: t('roles.noOwner.title'),
          detail: state.claimOpen ? `${t('roles.noOwner.detail')}${locale === 'en' ? ' ' : ''}${t('roles.noOwner.claim')}` : t('roles.noOwner.detail'),
          action });
      }
      const personal = state.personal?.entries ?? [];
      if (state.imported?.entries.length || personal.length) {
        const entries = state.imported?.entries ?? [];
        const gap = locale === 'en' ? ' ' : '';
        const promote = !state.hasGlobalOwner && entries.some(entry => entry.role === 'owner' && entry.level !== 'global');
        // Q2: the viewer's own Console account was linked by `ai.personalPrincipals` and they hold a
        // global iam.manage (this item is only listed then): offer to make that person the global owner.
        const promoteMe = !state.hasGlobalOwner && options.viewerUserId !== undefined
          && personal.some(entry => entry.consoleUserId === options.viewerUserId);
        const lines = [
          ...entries.map(entry => `${who(entry)}（${entry.result}）`),
          ...personal.map(entry => t('roles.imported.personalLine', { user: entry.consoleUserId, identity: `${entry.adapter}:${entry.userId}` })),
        ];
        const at = Math.min(state.imported?.at ?? Number.POSITIVE_INFINITY, state.personal?.at ?? Number.POSITIVE_INFINITY);
        drafts.push({ kind: 'chat-roles.imported', severity: 'info',
          state: { at, count: lines.length, ...(promoteMe ? { promoteMe: true } : {}) },
          title: t('roles.imported.title', { count: lines.length }),
          detail: `${t('roles.imported.detail', { entries: listed(lines, locale) })}${promote ? `${gap}${t('roles.imported.promote')}` : ''}${promoteMe ? `${gap}${t('roles.imported.promoteMe')}` : ''}`,
          action: promoteMe ? { label: t('roles.imported.promoteMeAction'), path: ATTENTION_PATHS.chatIdentityMe } : action, since: at });
      }
      const personalPending = state.personalPending ?? [];
      if (state.pending.length || personalPending.length) {
        const gap = locale === 'en' ? ' ' : '';
        const details = [
          ...(state.pending.length ? [t('roles.pending.detail', { entries: listed(state.pending.map(who), locale) })] : []),
          ...(personalPending.length ? [t('roles.pending.personalDetail', { entries: listed(personalPending.map(entry =>
            t('roles.pending.personalLine', { user: entry.consoleUserId, identity: `${entry.adapter}:${entry.userId}` })), locale) })] : []),
        ];
        const count = state.pending.length + personalPending.length;
        drafts.push({ kind: 'chat-roles.import-pending', severity: 'warning',
          state: { ids: [...state.pending.map(entry => entry.id), ...personalPending.map(entry => entry.id)] },
          title: t('roles.pending.title', { count }),
          detail: details.join(gap),
          action, since: Math.min(...state.pending.map(entry => entry.seenAt), ...personalPending.map(entry => entry.at)) });
      }
      return drafts;
    });
  }

  items.sort(compareAttentionItems);
  return Object.freeze({
    items: Object.freeze(items),
    generatedAt: new Date(at).toISOString(),
    ...(unavailable.length ? {
      unavailable: Object.freeze(unavailable.map(entry => entry.source)),
      unavailableDetails: Object.freeze([...unavailable]),
    } : {}),
  });

  /** Where an approval was requested, in words: never the internal session key. */
  function approvalSession(card: AttentionToolApproval): string {
    const name = card.sessionName?.trim();
    if (name) return t('approval.session.named', { name });
    const origin = card.origin;
    if (origin?.scope && origin.sceneId) {
      return t(`approval.session.${origin.scope}`, { account: `${origin.platform} / ${origin.endpointKey}`, scene: origin.sceneId });
    }
    return t('approval.session.other');
  }
}

function formatPath(path: readonly string[]): string {
  return path.map((part, index) => /^(?:0|[1-9][0-9]*)$/u.test(part) ? `[${part}]` : `${index === 0 ? '' : '.'}${part}`).join('');
}

// ---------------------------------------------------------------- RPC

export interface AttentionRpcContext {
  readonly sources: AttentionSources;
  readonly viewerUserId?: string;
  readonly allows: AttentionAllows;
  readonly allowsPluginPermission?: (permission: string) => boolean;
  readonly observations?: AttentionObservations;
  readonly cache?: AttentionSourceCache;
  readonly warnings?: AttentionWarnings;
  readonly now?: () => number;
}

export interface AttentionRpcReply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Answers `attention.list`; null means the type belongs elsewhere. The route already checked `status.view`. */
export async function dispatchAttentionConsoleRpc(message: Record<string, unknown>, context: AttentionRpcContext): Promise<AttentionRpcReply | null> {
  const type = message.type;
  if (!isConsoleAttentionRpcType(type)) return null;
  const input = message.data && typeof message.data === 'object' && !Array.isArray(message.data)
    ? message.data as Record<string, unknown> : message;
  const data = await collectAttention(context.sources, {
    locale: input.locale,
    allows: context.allows,
    ...(context.allowsPluginPermission ? { allowsPluginPermission: context.allowsPluginPermission } : {}),
    ...(context.observations ? { observations: context.observations } : {}),
    ...(context.cache ? { cache: context.cache } : {}),
    ...(context.warnings ? { warnings: context.warnings } : {}),
    ...(context.now ? { now: context.now } : {}),
    ...(context.viewerUserId ? { viewerUserId: context.viewerUserId } : {}),
  });
  return { status: 200, body: { success: true, data, type: ATTENTION_RPC.LIST, requestId: message.requestId } };
}
