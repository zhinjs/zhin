import { createFeaturePrivateToken, featureId, type CapabilityId, type PluginId } from '@zhin.js/plugin-runtime';
import type { AdapterCapability, AdapterOperation, AdapterSegmentPolicy } from './definition.js';
import type { AnyEndpoint } from './endpoint-specification.js';
import type { EndpointSendRequest, EndpointSendResult } from './endpoint-contract.js';
import type { AdapterCapabilityProfile, AdapterCapabilityResolver } from './capability-profile.js';
import type { EndpointStreaming } from './endpoint-stream.js';
import type { AdapterLoginDeclaration } from './login-capability.js';

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

export type EndpointDesiredMetadata = Omit<EndpointDesiredRecord, 'config' | 'secretRefs' | 'platformUserId'>;
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
