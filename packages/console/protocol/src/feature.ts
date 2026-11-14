/**
 * ADR 0050 §8 / ADR 0055 §6: layered feature configuration Console RPC (`feature.*`).
 * Levels are `global` < `adapter` (instance alias) < `endpoint` (`<alias>/<endpointId>`)
 * < `conversation` (`<alias>/<endpointId>/<kind>:<escaped id>`). `global` is the plugin's block in
 * the configuration file; the other three are stored in the project database (ADR 0057 §2).
 */

export const FEATURE_RPC = Object.freeze({
  LIST: 'feature.list',
  MATRIX: 'feature.matrix',
  GET: 'feature.get',
  SET_OVERRIDE: 'feature.set-override',
  REMOVE_OVERRIDE: 'feature.remove-override',
  SET_ENABLED: 'feature.set-enabled',
  CONVERSATIONS: 'feature.conversations',
} as const);

export type ConsoleFeatureRpcType = typeof FEATURE_RPC[keyof typeof FEATURE_RPC];
export type ConsoleFeaturePermission = 'feature.view' | 'feature.configure' | 'feature.toggle';

/**
 * Permission each `feature.*` RPC requires (ADR 0049 catalog names). `feature.set-enabled` at the
 * `global` level is plugin lifecycle, not a feature switch: it requires `plugin.manage`
 * ({@link FEATURE_GLOBAL_SWITCH_PERMISSION}) and runs as a management gateway transaction
 * (ADR 0054 §4), see {@link isGlobalFeatureSwitch}.
 */
export const FEATURE_RPC_PERMISSIONS: Readonly<Record<ConsoleFeatureRpcType, ConsoleFeaturePermission>> = Object.freeze({
  [FEATURE_RPC.LIST]: 'feature.view',
  [FEATURE_RPC.MATRIX]: 'feature.view',
  [FEATURE_RPC.GET]: 'feature.view',
  [FEATURE_RPC.SET_OVERRIDE]: 'feature.configure',
  [FEATURE_RPC.REMOVE_OVERRIDE]: 'feature.configure',
  [FEATURE_RPC.SET_ENABLED]: 'feature.toggle',
  [FEATURE_RPC.CONVERSATIONS]: 'feature.view',
});

/**
 * Permission of `feature.set-enabled` with `level: 'global'` (writes `disable_plugins` through the
 * gateway's stop → write → start transaction with rollback, ADR 0054 §4).
 */
export const FEATURE_GLOBAL_SWITCH_PERMISSION = 'plugin.manage' as const;

/**
 * Whether a Console RPC message is the global plugin switch (`feature.set-enabled` at `global`).
 * The payload is read like the instance's `feature.*` dispatcher reads it: `data` when it is an
 * object, otherwise the message itself.
 */
export function isGlobalFeatureSwitch(message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const envelope = message as Readonly<Record<string, unknown>>;
  if (envelope.type !== FEATURE_RPC.SET_ENABLED) return false;
  const data = envelope.data;
  const input = data && typeof data === 'object' && !Array.isArray(data) ? data as Readonly<Record<string, unknown>> : envelope;
  return input.level === 'global';
}

export function isConsoleFeatureRpcType(value: unknown): value is ConsoleFeatureRpcType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURE_RPC_PERMISSIONS, value);
}

export type ConsoleFeatureLevel = 'global' | 'adapter' | 'endpoint' | 'conversation';
export type ConsoleFeatureOverrideLevel = Exclude<ConsoleFeatureLevel, 'global'>;
/** The highest upper level whose switch is off; every level below it is locked (ADR 0050 §4 / 0055 §4). */
export type ConsoleFeatureLock = 'global' | 'adapter' | 'endpoint';

/** Mirrors `ConversationKind` of `@zhin.js/im-contract`. */
export type ConsoleFeatureConversationKind = 'group' | 'private' | 'channel';
export const CONSOLE_FEATURE_CONVERSATION_KINDS: readonly ConsoleFeatureConversationKind[] = Object.freeze(['group', 'private', 'channel']);

/** One conversation under an endpoint; `id` is the platform conversation id, unescaped. */
export interface ConsoleFeatureConversationRef {
  readonly adapter: string;
  readonly endpointId: string;
  readonly kind: ConsoleFeatureConversationKind;
  readonly id: string;
}

/** Where a stored override was last written from (#1250). */
export type ConsoleFeatureOverrideSource = 'chat' | 'console' | 'cli';

/**
 * Who last wrote a stored override (adapter / endpoint / conversation level), next to the
 * legacy `updatedBy` id. Every field but `source` is optional: rows written before #1250 only
 * yield what their `updatedBy` id encodes (`chat:<adapter>:<userId>` → chat identity,
 * `user:<id>` → Console principal), and rows written by migrations yield none.
 */
export interface ConsoleFeatureOverrideOperator {
  readonly source: ConsoleFeatureOverrideSource;
  /** Chat: adapter alias of the speaker's identity. */
  readonly adapter?: string;
  /** Chat: platform user id of the speaker. */
  readonly userId?: string;
  /** Console / CLI: principal (Console user) id. */
  readonly principalId?: string;
  /** Chat sender name or Console user display name, when known at write time. */
  readonly displayName?: string;
}

const CONVERSATION_ALIAS = /^[a-z0-9][a-z0-9-]*$/u;
const CONVERSATION_ENDPOINT_ID = /^[^/~\0]{1,128}$/u;
// C0 / DEL control characters never appear in a conversation id.
// eslint-disable-next-line no-control-regex
const CONVERSATION_CONTROL = /[\u0000-\u001f\u007f]/u;
/** Longest accepted platform conversation id (unescaped). */
export const FEATURE_CONVERSATION_ID_MAX_LENGTH = 256;

/**
 * Escapes a platform conversation id for the resolution key: `%` → `%25`, `/` → `%2F`.
 * Nothing else changes, so `:` and other characters stay readable.
 */
export function escapeFeatureConversationId(id: string): string {
  return id.replaceAll('%', '%25').replaceAll('/', '%2F');
}

/** Inverse of {@link escapeFeatureConversationId}; undefined for any other `%` sequence. */
export function unescapeFeatureConversationId(escaped: string): string | undefined {
  if (/%(?!25|2[fF])/u.test(escaped) || escaped.includes('/')) return undefined;
  return escaped.replace(/%2[fF]|%25/gu, match => match === '%25' ? '%' : '/');
}

/** `<alias>/<endpointId>/<kind>:<escaped id>`; throws on an invalid reference. */
export function formatFeatureConversationKey(ref: ConsoleFeatureConversationRef): string {
  if (!CONVERSATION_ALIAS.test(ref.adapter)) throw new TypeError('Conversation key adapter must be an instance alias');
  if (!CONVERSATION_ENDPOINT_ID.test(ref.endpointId)) throw new TypeError('Conversation key endpointId is invalid');
  if (!CONSOLE_FEATURE_CONVERSATION_KINDS.includes(ref.kind)) throw new TypeError('Conversation kind must be group, private or channel');
  if (typeof ref.id !== 'string' || !ref.id || ref.id.length > FEATURE_CONVERSATION_ID_MAX_LENGTH || CONVERSATION_CONTROL.test(ref.id)) {
    throw new TypeError('Conversation id is invalid');
  }
  return `${ref.adapter}/${ref.endpointId}/${ref.kind}:${escapeFeatureConversationId(ref.id)}`;
}

/** Parses a conversation resolution key; undefined when it is not one. */
export function parseFeatureConversationKey(key: string): ConsoleFeatureConversationRef | undefined {
  if (typeof key !== 'string') return undefined;
  const first = key.indexOf('/');
  const second = first < 0 ? -1 : key.indexOf('/', first + 1);
  if (first <= 0 || second < 0) return undefined;
  const adapter = key.slice(0, first);
  const endpointId = key.slice(first + 1, second);
  const rest = key.slice(second + 1);
  const colon = rest.indexOf(':');
  if (colon <= 0) return undefined;
  const kind = rest.slice(0, colon) as ConsoleFeatureConversationKind;
  const id = unescapeFeatureConversationId(rest.slice(colon + 1));
  if (id === undefined) return undefined;
  try {
    const ref = { adapter, endpointId, kind, id };
    return formatFeatureConversationKey(ref) === key ? Object.freeze(ref) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a feature row is (#1250): `root` — the project's own root plugin (its convention commands,
 * components and tools; always on, not switchable); `adapter` — a plugin that provides adapter
 * Endpoints (a matrix column, too); `plugin` — any other declared plugin instance.
 */
export type ConsoleFeatureKind = 'root' | 'plugin' | 'adapter';

/** Convention capabilities a plugin contributes directly, by local name (e.g. command routes `hello`, `card`). */
export interface ConsoleFeatureCapabilities {
  readonly commands: readonly string[];
  readonly components: readonly string[];
  readonly tools: readonly string[];
}

export interface ConsoleFeatureSummary {
  /** Instance path: the top-level alias (`rss`) or `parent/child` for nested Plugins. */
  readonly plugin: string;
  readonly displayName: string;
  /** Translations of `displayName` keyed by Console locale (`metadata.displayNameI18n`); absent without any. */
  readonly displayNameI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly levels: readonly ConsoleFeatureLevel[];
  /** False for Plugins without business configuration: they only get the three-level switch. */
  readonly hasSchema: boolean;
  readonly globalEnabled: boolean;
  /** The instance provides adapter Endpoints (it is a matrix column, too). */
  readonly adapter?: boolean;
  /** Row category; absent from older Hosts (then `adapter` tells adapters apart). */
  readonly kind?: ConsoleFeatureKind;
  /** Commands / components / tools this plugin contributes; absent from older Hosts. */
  readonly capabilities?: ConsoleFeatureCapabilities;
  /** ADR 0055 §2: fields editable at the conversation level (empty: switch only). */
  readonly conversationFields: readonly string[];
  /** Fields group admins may change in chat (subset of `conversationFields`). */
  readonly selfServiceFields: readonly string[];
}

export interface ConsoleFeatureListResult {
  readonly revision: string;
  readonly features: readonly ConsoleFeatureSummary[];
}

export interface ConsoleFeatureMatrixCell {
  readonly enabled: boolean;
  readonly lockedBy?: ConsoleFeatureLock;
  /** The level stores its own `enabled` switch or field overrides. */
  readonly overridden: boolean;
}

export interface ConsoleFeatureMatrixRow {
  /** Instance path; `''` for the `root` row (the project's own plugin, which has no instance alias). */
  readonly plugin: string;
  readonly displayName: string;
  /** See {@link ConsoleFeatureSummary.displayNameI18n}. */
  readonly displayNameI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  /** Row category; absent from older Hosts. */
  readonly kind?: ConsoleFeatureKind;
  /** Commands / components / tools this plugin contributes; absent from older Hosts. */
  readonly capabilities?: ConsoleFeatureCapabilities;
  /** True for the `root` row: always enabled and not switchable through feature overrides. */
  readonly readOnly?: boolean;
  readonly global: ConsoleFeatureMatrixCell;
  /** Keyed by adapter instance alias (see {@link ConsoleFeatureMatrixResult.adapters}). */
  readonly adapters: Readonly<Record<string, ConsoleFeatureMatrixCell>>;
  /** This plugin's stored conversation overrides per alias → endpoint id; absent without any. */
  readonly conversationOverrides?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface ConsoleFeatureMatrixResult {
  readonly revision: string;
  /** Adapter instance aliases, in column order. */
  readonly adapters: readonly string[];
  /** Endpoint ids per alias, known from configuration and overrides (for drill-down with `feature.get`). */
  readonly endpoints: Readonly<Record<string, readonly string[]>>;
  readonly rows: readonly ConsoleFeatureMatrixRow[];
  /** Conversations with at least one stored override, per alias → endpoint id; absent without the store. */
  readonly conversationOverrides?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface ConsoleFeatureGetRequest {
  readonly plugin: string;
  readonly level: ConsoleFeatureLevel;
  /**
   * Adapter alias (`adapter`), `<alias>/<endpointId>` (`endpoint`) or
   * `<alias>/<endpointId>/<kind>:<escaped id>` (`conversation`); omitted for `global`.
   */
  readonly key?: string;
}

export interface ConsoleFeatureGetResult {
  readonly revision: string;
  readonly plugin: string;
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
  readonly levels: readonly ConsoleFeatureLevel[];
  readonly conversationFields: readonly string[];
  readonly selfServiceFields: readonly string[];
  /** Own JSON Schema narrowed to the fields editable at `level`; null without a schema. */
  readonly schema: Readonly<Record<string, unknown>> | null;
  /** Values stored at exactly this level (secrets masked). */
  readonly values: Readonly<Record<string, unknown>>;
  /** Effective configuration at this level (secrets masked). */
  readonly effective: Readonly<Record<string, unknown>>;
  /** JSON Pointer → level that set it, for "inherited from…" / "overridden" hints. */
  readonly sources: Readonly<Record<string, ConsoleFeatureLevel>>;
  readonly enabled: boolean;
  readonly lockedBy?: ConsoleFeatureLock;
  /** `conversation` level only: the parsed key, plus its display name when the instance can resolve one. */
  readonly conversation?: ConsoleFeatureConversationRef & Readonly<{ name?: string }>;
  /** Stored levels (adapter / endpoint / conversation): when / by whom the stored override was last written. */
  readonly updatedAt?: number;
  readonly updatedBy?: string;
  /** Structured writer of the stored override (who and through what), when known. */
  readonly operator?: ConsoleFeatureOverrideOperator;
  /**
   * Whether overrides can be saved: false when the project database cannot store them (MongoDB,
   * Redis, memory), in which case writes are refused (503 `feature-overrides-unpersisted`).
   * Present whenever the override store is available.
   */
  readonly persistent?: boolean;
}

export interface ConsoleFeatureWarning {
  readonly code: 'unknown-adapter' | 'unknown-endpoint' | 'enabled-under-disabled';
  readonly path: string;
  readonly message: string;
}

export interface ConsoleFeatureSetOverrideRequest {
  readonly plugin: string;
  readonly level: ConsoleFeatureOverrideLevel;
  readonly key: string;
  /** Shallow field patch; `null` stores an explicit clear, `undefined` (in-process callers) deletes the field. */
  readonly patch: Readonly<Record<string, unknown>>;
  /**
   * Omitted: no revision check. The stored override's revision as `feature.get` returned it
   * (`'0'` when none exists). For `adapter` / `endpoint`, the configuration revision of
   * `feature.list` / `feature.matrix` is still accepted while it is current (Console builds before
   * ADR 0057), without a row check.
   */
  readonly expectedRevision?: string;
}

export interface ConsoleFeatureRemoveOverrideRequest {
  readonly plugin: string;
  readonly level: ConsoleFeatureOverrideLevel;
  readonly key: string;
  /** Field paths inside the entry; omitted removes the whole level entry. */
  readonly paths?: readonly (readonly string[])[];
  readonly expectedRevision?: string;
}

export interface ConsoleFeatureSetEnabledRequest {
  readonly plugin: string;
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
  readonly enabled: boolean;
  readonly expectedRevision?: string;
}

export type ConsoleFeatureWriteResult =
  | Readonly<{
    status: 'saved';
    revision: string;
    /** True only for the global switch (`disable_plugins`), which still restarts the Host. */
    restartRequired: boolean;
    warnings: readonly ConsoleFeatureWarning[];
    message: string;
    /** Stored levels: whether the store persists (always true for a saved write since ADR 0057 §2). */
    persistent?: boolean;
  }>
  | Readonly<{ status: 'unchanged'; revision: string; warnings: readonly ConsoleFeatureWarning[] }>
  | Readonly<{ status: 'conflict'; revision: string; message: string }>
  | Readonly<{ status: 'invalid'; revision: string; errors: readonly Readonly<{ path: string; message: string }>[]; message: string }>;

/**
 * Error reply (HTTP 409, `success: false`) of `feature.set-enabled` (and `feature.set-override`
 * / `feature.remove-override` touching `enabled`) when an upper level already disables the
 * plugin: no level below a disabled level may change its own switch (ADR 0050 §4).
 */
export interface ConsoleFeatureLockedError {
  readonly success: false;
  readonly code: 'locked';
  readonly lockedBy: ConsoleFeatureLock;
  readonly error: string;
}

/** `feature.conversations`: conversations with stored overrides, plus recently seen ones. */
export interface ConsoleFeatureConversationsRequest {
  /** Only conversations with an override for this plugin instance (recent ones are left out). */
  readonly plugin?: string;
  /** Adapter instance alias. */
  readonly adapter?: string;
  /** Endpoint id under `adapter` (requires `adapter`). */
  readonly endpoint?: string;
  /** Case-insensitive substring of the key, the conversation id or its known name. */
  readonly query?: string;
  /** Opaque `nextCursor` of the previous page. */
  readonly cursor?: string;
  /** 1–200, default 50. */
  readonly limit?: number;
}

export interface ConsoleFeatureConversationOverrideSummary {
  readonly plugin: string;
  /** Present (always `false`) when the conversation switches the plugin off. */
  readonly enabled?: false;
  /** Top-level fields stored in the override patch. */
  readonly fields: readonly string[];
  readonly revision: string;
  readonly updatedAt: number;
  readonly updatedBy?: string;
  /** Structured writer of the stored override (who and through what), when known. */
  readonly operator?: ConsoleFeatureOverrideOperator;
}

export interface ConsoleFeatureConversationSummary extends ConsoleFeatureConversationRef {
  /** `<alias>/<endpointId>/<kind>:<escaped id>`, usable as `key` of `feature.get` etc. */
  readonly key: string;
  /** Display name when the instance knows it (never part of the key). */
  readonly name?: string;
  readonly hasOverrides: boolean;
  readonly overrides: readonly ConsoleFeatureConversationOverrideSummary[];
  /** Latest known activity or override write (epoch ms). */
  readonly lastActiveAt?: number;
}

export interface ConsoleFeatureConversationsResult {
  readonly conversations: readonly ConsoleFeatureConversationSummary[];
  readonly nextCursor?: string;
  /** False when the instance has no conversation event store; only overridden conversations are listed. */
  readonly recentAvailable: boolean;
  /** False when the project database cannot store overrides (writes are refused). */
  readonly persistent?: boolean;
}
