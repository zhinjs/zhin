/**
 * ADR 0050 §8: layered feature configuration Console RPC (`feature.*`).
 * Levels are `global` < `adapter` (instance alias) < `endpoint` (`<alias>/<endpointId>`).
 */

export const FEATURE_RPC = Object.freeze({
  LIST: 'feature.list',
  MATRIX: 'feature.matrix',
  GET: 'feature.get',
  SET_OVERRIDE: 'feature.set-override',
  REMOVE_OVERRIDE: 'feature.remove-override',
  SET_ENABLED: 'feature.set-enabled',
} as const);

export type ConsoleFeatureRpcType = typeof FEATURE_RPC[keyof typeof FEATURE_RPC];
export type ConsoleFeaturePermission = 'feature.view' | 'feature.configure' | 'feature.toggle';

/** Permission each `feature.*` RPC requires (ADR 0049 catalog names). */
export const FEATURE_RPC_PERMISSIONS: Readonly<Record<ConsoleFeatureRpcType, ConsoleFeaturePermission>> = Object.freeze({
  [FEATURE_RPC.LIST]: 'feature.view',
  [FEATURE_RPC.MATRIX]: 'feature.view',
  [FEATURE_RPC.GET]: 'feature.view',
  [FEATURE_RPC.SET_OVERRIDE]: 'feature.configure',
  [FEATURE_RPC.REMOVE_OVERRIDE]: 'feature.configure',
  [FEATURE_RPC.SET_ENABLED]: 'feature.toggle',
});

export function isConsoleFeatureRpcType(value: unknown): value is ConsoleFeatureRpcType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURE_RPC_PERMISSIONS, value);
}

export type ConsoleFeatureLevel = 'global' | 'adapter' | 'endpoint';
export type ConsoleFeatureOverrideLevel = Exclude<ConsoleFeatureLevel, 'global'>;
export type ConsoleFeatureLock = 'global' | 'adapter';

export interface ConsoleFeatureSummary {
  /** Instance path: the top-level alias (`rss`) or `parent/child` for nested Plugins. */
  readonly plugin: string;
  readonly displayName: string;
  readonly levels: readonly ConsoleFeatureLevel[];
  /** False for Plugins without business configuration: they only get the three-level switch. */
  readonly hasSchema: boolean;
  readonly globalEnabled: boolean;
  /** The instance provides adapter Endpoints (it is a matrix column, too). */
  readonly adapter?: boolean;
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
  readonly plugin: string;
  readonly displayName: string;
  readonly global: ConsoleFeatureMatrixCell;
  /** Keyed by adapter instance alias (see {@link ConsoleFeatureMatrixResult.adapters}). */
  readonly adapters: Readonly<Record<string, ConsoleFeatureMatrixCell>>;
}

export interface ConsoleFeatureMatrixResult {
  readonly revision: string;
  /** Adapter instance aliases, in column order. */
  readonly adapters: readonly string[];
  /** Endpoint ids per alias, known from configuration and overrides (for drill-down with `feature.get`). */
  readonly endpoints: Readonly<Record<string, readonly string[]>>;
  readonly rows: readonly ConsoleFeatureMatrixRow[];
}

export interface ConsoleFeatureGetRequest {
  readonly plugin: string;
  readonly level: ConsoleFeatureLevel;
  /** Adapter alias (`adapter`) or `<alias>/<endpointId>` (`endpoint`); omitted for `global`. */
  readonly key?: string;
}

export interface ConsoleFeatureGetResult {
  readonly revision: string;
  readonly plugin: string;
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
  readonly levels: readonly ConsoleFeatureLevel[];
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
  /** Defaults to the revision read by this request. */
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
  }>
  | Readonly<{ status: 'unchanged'; revision: string; warnings: readonly ConsoleFeatureWarning[] }>
  | Readonly<{ status: 'conflict'; revision: string; message: string }>
  | Readonly<{ status: 'invalid'; revision: string; errors: readonly Readonly<{ path: string; message: string }>[]; message: string }>;
