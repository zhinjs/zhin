import { createFeaturePrivateToken, featureId, type CapabilityId, type PluginId } from '@zhin.js/plugin-runtime';
import type { AdapterCapability, AdapterOperation, AdapterSegmentPolicy } from './definition.js';
import type { AnyEndpoint } from './endpoint-specification.js';
import type { EndpointSendRequest, EndpointSendResult } from './endpoint-contract.js';

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
export interface EndpointMetadata extends EndpointDesiredMetadata {
  readonly epoch: number;
  readonly incarnationId?: string;
  readonly started: boolean;
  readonly admitted: boolean;
  readonly execution?: EndpointExecution;
  readonly retiring?: boolean;
  readonly removed?: boolean;
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
  release(): void;
}

export const endpointDesiredRepositoryToken = createFeaturePrivateToken<EndpointDesiredRepository>(
  'zhin.adapter.endpoint-desired-repository', featureId('zhin.adapter'), 'Adapter-owned endpoint desired state persistence',
);
export const endpointSecretResolverToken = createFeaturePrivateToken<EndpointSecretResolver>(
  'zhin.adapter.endpoint-secret-resolver', featureId('zhin.adapter'), 'Execution-only endpoint credential resolver',
);
