import { createFeaturePrivateToken, featureId, type CapabilityId, type PluginId } from '@zhin.js/plugin-runtime';
import type { AdapterCapability, AdapterOperation, AdapterSegmentPolicy } from './definition.js';
import type { AnyEndpoint } from './endpoint-specification.js';
import type { EndpointSendRequest, EndpointSendResult } from './endpoint-contract.js';
import { resolveStaticCapabilities, type AdapterCapabilityProfile, type AdapterCapabilityResolver } from './capability-profile.js';
import type { EndpointStreaming } from './endpoint-stream.js';
import type { AdapterLoginDeclaration } from './login-capability.js';
import type { ConversationRef } from '@zhin.js/im-contract';

/** Persistent account identity is independent of its reusable display/config name. */
export interface EndpointDesiredRecord {
  /** Last verified platform identity; private persistence, never a credential or public metadata. */
  readonly platformUserId?: string;
  readonly instanceId: string;
  readonly canonicalId: CapabilityId;
  readonly endpointId: string;
  readonly revision: number;
  readonly desiredEnabled: boolean;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secretRefs?: Readonly<Record<string, string>>;
  /**
   * `console`: created through account management (`add`, the Console's 「新增账号」), never seeded
   * or imported from `zhin.config.yml`. Such an account missing from the file is not configuration
   * drift (#1250). Absent: seeded / imported from the file, or saved by an older version.
   */
  readonly origin?: 'console';
}

export interface EndpointDesiredSnapshot {
  readonly revision: number;
  readonly endpoints: readonly EndpointDesiredRecord[];
  /** Private CAS identity. Older snapshots remain readable but cannot prove an unknown commit. */
  readonly commitId?: string;
}

/** One atomic document per Adapter capability; failures must never be returned as absence. */
export interface EndpointDesiredRepository {
  load(adapterId: CapabilityId): Promise<EndpointDesiredSnapshot | undefined>;
  /** Null means create-if-absent. No automatic retry after a conflict or an unknown commit. */
  compareAndSet(adapterId: CapabilityId, expectedRevision: number | null,
    endpoints: readonly EndpointDesiredRecord[], commitId?: string): Promise<EndpointDesiredSnapshot>;
}

export class AdapterManagementError extends Error {
  constructor(readonly code: 'conflict' | 'unavailable' | 'closed' | 'not_found' | 'duplicate_entry'
    | 'inactive' | 'invalid_configuration' | 'commit_unknown' | 'integrity' | 'unsupported', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AdapterManagementError';
  }
}

/**
 * A platform's own refusal to verify a credential-only change (#1250 b115), thrown from
 * `identifyConfiguration`. `reason` is a fixed, credential-free text written by the platform code (never
 * platform responses or configuration values); Console shows it as is instead of the generic refusal.
 */
export class AdapterIdentityUnsupportedError extends AdapterManagementError {
  constructor(readonly reason: string) {
    super('unsupported', reason);
    this.name = 'AdapterManagementError';
  }
}

/** Credentials are execution-only; neither snapshots nor control responses contain resolved values. */
export interface EndpointSecretResolver {
  resolve(reference: string, context: Readonly<{ instanceId: string; signal: AbortSignal }>): Promise<string>;
}

/** Previous login evidence is distinct from an unbound account or an unknown identity. */
export type EndpointPreviousIdentity = Readonly<{ kind: 'unbound' } | { kind: 'verified'; userId: string } | { kind: 'unknown' }>;

export interface EndpointCreationContext {
  readonly signal: AbortSignal;
  readonly epoch: number;
  readonly incarnationId: string;
  readonly instanceId: string;
  readonly canonicalId: CapabilityId;
  readonly endpointId: string;
}

export interface AdapterDescriptorInfo {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly capabilities: readonly AdapterCapability[];
  readonly segments?: AdapterSegmentPolicy;
  /** ADR 0044: the definition's declared profile (absent = derived per Endpoint from its legacy declarations). */
  readonly profile?: AdapterCapabilityProfile;
  readonly resolveCapabilities?: AdapterCapabilityResolver;
  /** ADR 0058: the definition's login declaration (absent = no Console login actions). */
  readonly login?: AdapterLoginDeclaration;
}

export type EndpointDesiredMetadata = Omit<EndpointDesiredRecord, 'config' | 'secretRefs' | 'platformUserId' | 'origin'>;
export type EndpointAction = 'add' | 'update' | 'start' | 'stop' | 'remove' | 'replace';
export interface EndpointExecution {
  readonly instanceId: string;
  readonly action: EndpointAction;
  readonly revision: number | null;
  readonly status: 'pending' | 'applied' | 'failed';
  readonly code?: string;
}
export interface AdapterMutationOptions {
  readonly signal?: AbortSignal;
  /** Acknowledge the committed desired state without waiting for login or drain. */
  readonly waitForExecution?: boolean;
  /** Internal request boundary, after validation and immediately before the single CAS. */
  readonly beforeCommit?: () => void;
}
/** Why an account start failed, for operators (aligned with the Console MCP failure categories). */
export type EndpointFailureCategory = 'auth' | 'network' | 'timeout' | 'config' | 'process_exit' | 'unknown';
/** Last failed start of one account. Raw error text may contain credentials: never stored as is. */
export interface EndpointStartFailure {
  readonly code: string;
  /** Epoch milliseconds. */
  readonly at: number;
  /** Classified cause (absent on failures recorded before #1250). */
  readonly category?: EndpointFailureCategory;
  /**
   * Operator text, at most 200 characters, built from `category` and `code` only — never the raw
   * error text (which may carry credentials; the warn log gets it with credentials masked).
   */
  readonly message?: string;
}
/**
 * Background start supervision of one account: `retrying` waits for `nextRetryAt`,
 * `failed` waits for an explicit start / relogin (configuration errors, interactive login).
 */
export type EndpointStartPhase = 'failed' | 'retrying';
export interface EndpointMetadata extends EndpointDesiredMetadata {
  readonly epoch: number;
  readonly incarnationId?: string;
  readonly started: boolean;
  readonly admitted: boolean;
  readonly execution?: EndpointExecution;
  readonly retiring?: boolean;
  readonly removed?: boolean;
  /** Start attempts of the current supervision (0 = none yet or online). */
  readonly startAttempt: number;
  readonly startFailure?: EndpointStartFailure;
  readonly startPhase?: EndpointStartPhase;
  /** Epoch milliseconds of the next automatic retry. */
  readonly nextRetryAt?: number;
}
export interface EndpointConfigurationView {
  readonly id: string;
  readonly instanceId: string;
  readonly values: Readonly<Record<string, string>>;
}
export interface AdapterMutationResult {
  readonly revision: number | null;
  readonly endpoints: readonly EndpointMetadata[];
  readonly execution: Readonly<{ status: 'pending' | 'applied' | 'failed'; code?: string }>;
  readonly operation?: EndpointExecution;
}
export interface EndpointChildView<E extends AnyEndpoint = AnyEndpoint> {
  readonly desired: EndpointDesiredMetadata;
  readonly endpoint?: E;
  readonly operations: readonly AdapterOperation[];
  readonly epoch: number;
  readonly incarnationId?: string;
  readonly started: boolean;
  readonly open: boolean;
  readonly stopped: boolean;
  readonly startAttempted: boolean;
  readonly startAttempt: number;
  readonly startFailure?: EndpointStartFailure;
  readonly startPhase?: EndpointStartPhase;
  readonly nextRetryAt?: number;
}

/** Originating operation retained by a scoped semantic port. */
export interface EndpointPortScope {
  /** Retain the originating operation's resources until this admitted call settles. */
  readonly retain?: () => () => void;
  /** Check the caller's author/snapshot ownership before every invocation. */
  readonly assertActive?: () => void;
  /** Cancel in-flight calls when the originating operation ends, even if the epoch stays online. */
  readonly signal?: AbortSignal;
}

/** Retain alongside the Root snapshot lease. Retirement cancels this exact child, never its replacement. */
export interface EndpointChildLease<E extends AnyEndpoint = AnyEndpoint> {
  readonly instanceId: string;
  readonly canonicalId: CapabilityId;
  readonly epoch: number;
  readonly incarnationId: string;
  readonly signal: AbortSignal;
  readonly endpoint: E;
  assertActive(): void;
  run<T>(operation: (endpoint: E, signal: AbortSignal) => T | Promise<T>): Promise<T>;
  /** Outbound readiness is checked even when the lease was captured for an inbound callback. */
  send(request: EndpointSendRequest): Promise<EndpointSendResult>;
  /** Configured delivery mode, scoped to this concrete account incarnation. */
  readonly streaming?: EndpointStreaming;
  release(): void;
}

export const endpointDesiredRepositoryToken = createFeaturePrivateToken<EndpointDesiredRepository>(
  'zhin.adapter.endpoint-desired-repository', featureId('zhin.adapter'), 'Adapter-owned endpoint desired state persistence',
);
/**
 * Stored (never environment-expanded) startup configuration of an Adapter's accounts, used to
 * compare `zhin.config.yml` `endpoints` with the persisted accounts and to import / write back (#1250).
 */
export const endpointConfigSourceToken = createFeaturePrivateToken<import('./endpoint-config-drift.js').EndpointConfigSource>(
  'zhin.adapter.endpoint-config-source', featureId('zhin.adapter'), 'Stored startup configuration of adapter accounts',
);
export const endpointSecretResolverToken = createFeaturePrivateToken<EndpointSecretResolver>(
  'zhin.adapter.endpoint-secret-resolver', featureId('zhin.adapter'), 'Execution-only endpoint credential resolver',
);

/**
 * ADR 0060 §5.4 (#1250 sandbox-speak-as-me): what a trusted local simulation Adapter
 * (`isTrustedSimulationAdapter`: `runtime.sandbox` declared by `@zhin.js/adapter-sandbox`) gets as
 * {@link AdapterContext.consoleSpeaker}. It gives the Console user behind `principal` the Console
 * Sandbox identity `console-<userId>` on this Adapter, like the Console RPC
 * `chat-identities.simulated.ensure`. `principal` must be the very object the instance's HTTP Host
 * put on the Adapter's socket (`WsConnection.principal`): the Root accepts it only when that Host
 * issued it (`HttpRouter.isHostIssuedPrincipal`) — a look-alike object, a copy or another Host's
 * principal is refused (`not-host-issued`) whatever it lists — and only then checks
 * `self.chat-identity` and global `iam.manage` on it. Rejects with the reason when the identity
 * cannot be created. Other Adapters and plugins never receive it.
 */
export interface AdapterConsoleSpeakerPort {
  ensure(conversation: ConversationRef, principal: unknown): Promise<void>;
}

/** Root side of `AdapterConsoleSpeakerPort`; `owner` is the Adapter's owning plugin. */
export interface SimulatedConsoleSpeakerHost {
  ensure(request: Readonly<{ owner: PluginId; conversation: ConversationRef; principal: unknown }>): Promise<void>;
}

/**
 * Root-private (readable only while projecting the Adapter Feature): the instance provides it; the
 * Adapter Feature binds it to each trusted simulation Adapter's owner (`AdapterConsoleSpeakerPort`).
 */
export const simulatedConsoleSpeakerToken = createFeaturePrivateToken<SimulatedConsoleSpeakerHost>(
  'zhin.adapter.simulated-console-speaker', featureId('zhin.adapter'), 'Console Sandbox identities for local simulation adapters',
);

/**
 * ADR 0060 §5.4 / ADR 0044: the one place that says what a local simulation Adapter is.
 *
 * - {@link declaresLocalSimulation}: the capability profile declares `runtime.sandbox` (clients
 *   choose their own sender id). Everything that classifies simulations (global grants of the role
 *   migration, claims / bind codes refused on a simulation, owners only on simulated ids not
 *   counting) reads this — a plugin can declare it, and declaring it only takes privileges away.
 * - {@link isTrustedSimulationAdapter}: additionally shipped by a package the framework trusts to
 *   speak for the signed-in Console user (`@zhin.js/adapter-sandbox`). Only such an Adapter gets
 *   `AdapterContext.consoleSpeaker`, and the Root accepts the port's calls only from it; a third-party
 *   plugin that declares `runtime.sandbox` stays a simulation but never gets the write port.
 */

/** Packages whose `runtime.sandbox` Adapters may create Console Sandbox identities (`console-<userId>`). */
export const TRUSTED_SIMULATION_ADAPTER_PACKAGES: readonly string[] = Object.freeze(['@zhin.js/adapter-sandbox']);

/**
 * Whether a capability profile declares a local simulation (`runtime.sandbox`). Throws like
 * `resolveStaticCapabilities` on a malformed profile, so callers keep failing closed.
 */
export function declaresLocalSimulation(profile: AdapterCapabilityProfile | undefined): boolean {
  return !!profile && resolveStaticCapabilities(profile, []).runtime?.sandbox === true;
}

/** Whether the owning plugin's package is one of {@link TRUSTED_SIMULATION_ADAPTER_PACKAGES}. */
export function isTrustedSimulationAdapterPackage(packageName: string | undefined): boolean {
  return typeof packageName === 'string' && TRUSTED_SIMULATION_ADAPTER_PACKAGES.includes(packageName);
}

/** A local simulation ({@link declaresLocalSimulation}) whose owning plugin is a trusted package. */
export function isTrustedSimulationAdapter(profile: AdapterCapabilityProfile | undefined, packageName: string | undefined): boolean {
  return isTrustedSimulationAdapterPackage(packageName) && declaresLocalSimulation(profile);
}
