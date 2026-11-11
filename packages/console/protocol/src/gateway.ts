/**
 * Management gateway RPC (ADR 0054 §4 / §5): `gateway.packages.*` dependency transactions and
 * `gateway.instance.*` lifecycle. Handled by the gateway process itself, never by the instance.
 *
 * Must not import from `./index.js` (the barrel re-exports it) or `./permissions.js` (which
 * imports this module), so permissions are spelled as literals; tests assert they are known.
 */

export const GATEWAY_PACKAGES_RPC = Object.freeze({
  LIST: 'gateway.packages.list',
  PLAN: 'gateway.packages.plan',
  INSTALL: 'gateway.packages.install',
  UNINSTALL: 'gateway.packages.uninstall',
  UPDATE: 'gateway.packages.update',
} as const);

export const GATEWAY_INSTANCE_RPC = Object.freeze({
  STATUS: 'gateway.instance.status',
  START: 'gateway.instance.start',
  STOP: 'gateway.instance.stop',
  RESTART: 'gateway.instance.restart',
  LOGS: 'gateway.instance.logs',
} as const);

/** Plugin declarations written by the gateway (ADR 0053 §2 step 4, ADR 0054 §4). */
export const GATEWAY_PLUGINS_RPC = Object.freeze({
  DECLARE: 'gateway.plugins.declare',
} as const);

export const GATEWAY_RPC = Object.freeze({ ...GATEWAY_PACKAGES_RPC, ...GATEWAY_INSTANCE_RPC, ...GATEWAY_PLUGINS_RPC });

export type GatewayRpcType = (typeof GATEWAY_RPC)[keyof typeof GATEWAY_RPC];

/**
 * Required permission per gateway RPC. Package plans and mutations need `plugin.manage`
 * (ADR 0054 §4; the bootstrap token may still install database drivers, ADR 0053 §3); listing is
 * a read (`feature.view`). Instance `status` / `logs` need `status.view`, the rest `ops.restart` (§5).
 */
export const GATEWAY_RPC_PERMISSIONS = Object.freeze({
  'gateway.packages.list': 'feature.view',
  'gateway.packages.plan': 'plugin.manage',
  'gateway.packages.install': 'plugin.manage',
  'gateway.packages.uninstall': 'plugin.manage',
  'gateway.packages.update': 'plugin.manage',
  'gateway.instance.status': 'status.view',
  'gateway.instance.logs': 'status.view',
  'gateway.instance.start': 'ops.restart',
  'gateway.instance.stop': 'ops.restart',
  'gateway.instance.restart': 'ops.restart',
  'gateway.plugins.declare': 'plugin.manage',
} as const satisfies Readonly<Record<GatewayRpcType, string>>);

/**
 * SSE event type of package transaction progress (`data`: a {@link GatewayPackageEvent}). The
 * gateway merges it into the Console event stream (`GET {base}/events`, also while the instance
 * is stopped) and serves it alone on {@link GATEWAY_PACKAGES_PROGRESS_PATH}.
 */
export const GATEWAY_PACKAGES_PROGRESS = 'gateway.packages.progress' as const;

/** `GET {base}` + this: SSE of package progress only (`plugin.manage`). */
export const GATEWAY_PACKAGES_PROGRESS_PATH = '/gateway/packages/progress' as const;

// ---- gateway.packages.* ----

export type GatewayPackageOperation = 'install' | 'uninstall' | 'update';

/** Every gateway transaction: package operations plus `declare` (`gateway.plugins.declare`). */
export type GatewayTransactionOperation = GatewayPackageOperation | 'declare';

/** Where an authorized package came from: an allowlist catalog, or any npm name (owners only). */
export type GatewayPackageSource = 'database-driver' | 'adapter' | 'ai' | 'market' | 'npm';

export interface GatewayPackagesInstallRequest {
  /** `name` or `name@<semver range | dist-tag>`; 1–32 entries. */
  readonly packages: readonly string[];
  /** Declare installed plugins in the root config (default true; plain dependencies are never declared). */
  readonly enable?: boolean;
  /** Start the instance afterwards even when it was stopped before (default: only if it was running). */
  readonly startInstance?: boolean;
}

/**
 * `gateway.plugins.declare`: declare an installed plugin package as `plugins.<instanceKey>` with
 * its first configuration, validated against the plugin's schema, written atomically, then the
 * instance restarted (rolled back when it does not come up). Refused when the instance key is
 * already declared — change a declared plugin's configuration with `config:patch-project`.
 */
export interface GatewayPluginsDeclareRequest {
  /** Installed plugin package name (a production dependency), without a version. */
  readonly package: string;
  /** Default: derived from the package name (`@zhin.js/adapter-sandbox` → `sandbox`). */
  readonly instanceKey?: string;
  /** The instance's configuration section (`<instanceKey>:`); default `{}`. */
  readonly config?: Readonly<Record<string, unknown>>;
  readonly startInstance?: boolean;
}

/**
 * An installed plugin left undeclared because its schema requires fields without defaults (or
 * environment variables are missing). Declare it with `gateway.plugins.declare` once configured.
 */
export interface GatewayPluginConfigurationNeed {
  readonly name: string;
  readonly instanceKey: string;
  /** Config paths to fill or fix, relative to the instance section (`endpoints`, `endpoints.0.id`). */
  readonly missing: readonly string[];
  /** Environment variables referenced by defaults that are not set. */
  readonly missingEnv: readonly string[];
}

export interface GatewayPackagesUninstallRequest {
  readonly packages: readonly string[];
  /** Also remove the npm dependency when nothing else references it (default true). */
  readonly removeDependency?: boolean;
  readonly startInstance?: boolean;
}

export interface GatewayPackagesUpdateRequest {
  /** Package names (optionally `name@<exact version>`), or `'all'` (owners only). */
  readonly packages: readonly string[] | 'all';
  readonly startInstance?: boolean;
}

export interface GatewayPackagesPlanRequest {
  readonly operation: GatewayPackageOperation;
  readonly packages: readonly string[] | 'all';
}

export interface GatewayAuthorizedPackage {
  readonly name: string;
  readonly version?: string;
  /** What the package manager receives. */
  readonly spec: string;
  readonly source: GatewayPackageSource;
}

export interface GatewayPackagePlan {
  readonly operation: GatewayPackageOperation;
  /** Empty for `update` of every dependency. */
  readonly packages: readonly GatewayAuthorizedPackage[];
  readonly all: boolean;
  readonly packageManager: string;
  readonly instanceState: GatewayInstanceState | 'unmanaged';
  /** The instance is stopped for the transaction and started again afterwards. */
  readonly restartsInstance: boolean;
}

export interface GatewayInstalledPackage {
  readonly name: string;
  /** Range declared in package.json. */
  readonly range: string;
  readonly dependencyType: 'dependencies' | 'optionalDependencies' | 'devDependencies';
  /** Version found in node_modules; null when missing. */
  readonly installedVersion: string | null;
  /** Allowlist catalog the package belongs to, if any. */
  readonly catalog?: Exclude<GatewayPackageSource, 'npm'>;
}

export interface GatewayPackageList {
  readonly packageManager: string;
  readonly packages: readonly GatewayInstalledPackage[];
}

export type GatewayPackagePhase =
  | 'snapshot'
  | 'stop-instance'
  | 'package-manager'
  | 'configure'
  | 'start-instance'
  | 'rollback'
  | 'restore-files'
  | 'reinstall'
  | 'restart-instance'
  | 'done';

export type GatewayPackageTransactionStatus = 'succeeded' | 'rolledBack' | 'rollbackFailed';

export interface GatewayPackageTransactionResult {
  readonly id: string;
  readonly operation: GatewayTransactionOperation;
  readonly packages: readonly GatewayAuthorizedPackage[];
  readonly ok: boolean;
  readonly status: GatewayPackageTransactionStatus;
  /** Phase that failed (set unless `succeeded`). */
  readonly failedPhase?: GatewayPackagePhase;
  /** The original failure. */
  readonly error?: string;
  /** Why the rollback did not complete (`rollbackFailed` only). */
  readonly rollbackError?: string;
  /** Last instance log lines when starting the instance failed. */
  readonly logTail?: readonly string[];
  /**
   * `install` only: plugins installed but not declared because their configuration is incomplete
   * (the transaction still succeeds and the instance stays healthy). Absent when none.
   */
  readonly needsConfiguration?: readonly GatewayPluginConfigurationNeed[];
  readonly instance: Readonly<{ before: GatewayInstanceState | 'unmanaged'; after: GatewayInstanceState | 'unmanaged' }>;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export type GatewayPackageEvent =
  | Readonly<{ type: 'start'; id: string; operation: GatewayTransactionOperation; packages: readonly GatewayAuthorizedPackage[] }>
  | Readonly<{ type: 'phase'; id: string; phase: GatewayPackagePhase }>
  | Readonly<{ type: 'output'; id: string; stream: 'stdout' | 'stderr'; chunk: string }>
  | Readonly<{ type: 'result'; id: string; result: GatewayPackageTransactionResult }>;

// ---- gateway.instance.* ----

export type GatewayInstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'backoff' | 'crashed';

export interface GatewayInstanceFailure {
  readonly reason: string;
  readonly message: string;
  readonly at: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly logTail: readonly string[];
}

export interface GatewayInstanceStatus {
  readonly instanceId: 'default';
  readonly state: GatewayInstanceState;
  readonly pid?: number;
  readonly startedAt?: number;
  readonly generation?: number;
  readonly protocolVersion?: number;
  readonly lastExitCode: number | null;
  readonly lastExitSignal: string | null;
  readonly lastFailure?: GatewayInstanceFailure;
  readonly recentRestarts: number;
}

export interface GatewayInstanceLogsRequest {
  /** 1–1000, default 200. */
  readonly lines?: number;
}

export interface GatewayInstanceLogLine {
  readonly seq: number;
  readonly time: number;
  readonly stream: 'stdout' | 'stderr';
  readonly line: string;
}

export interface GatewayInstanceLogs {
  readonly lines: readonly GatewayInstanceLogLine[];
}

// ---- envelope ----

export interface GatewayRpcRequest {
  readonly type: string;
  readonly data?: unknown;
}

export type GatewayRpcErrorCode = 'invalid_input' | 'forbidden' | 'unmapped' | 'conflict' | 'unavailable' | 'internal';

export type GatewayRpcResponse<T = unknown> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: GatewayRpcErrorCode; message: string; status: number }> }>;
