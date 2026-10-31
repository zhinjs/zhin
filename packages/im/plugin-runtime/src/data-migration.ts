import { createToken } from './token.js';
import type { DeliveryTarget } from './delivery-target.js';
import type { GenerationAdmissionSource } from './admission.js';
import type { JsonValue } from './persistent-state.js';

/** Read-only, owner-namespaced historical data; candidate IDs are opaque to the Host. */
export interface DataMigrationCandidate {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly sourceVersion: string;
  readonly recordCount: number;
  readonly beforeDigest: string;
  readonly status: 'unresolved' | 'canonical' | 'corrupt';
  /** Display facts only; never a preselected account or recovered authorization. */
  readonly summary: Readonly<Record<string, JsonValue>>;
  /** False when the configured persistence cannot supply the required atomic unit. */
  readonly executable: boolean;
}
export interface DataMigrationInventory {
  readonly revision: string;
  readonly candidates: readonly DataMigrationCandidate[];
}
export interface DataMigrationRequest { readonly signal?: AbortSignal }
export interface PrepareDataMigrationRequest extends DataMigrationRequest {
  /** Host-generated operation UUID; reused to reconcile a lost response. */
  readonly planId: string;
  readonly candidateId: string;
  readonly expectedDigest: string;
  /** Explicit administrator selection, validated by the Host against the account directory. */
  readonly target: DeliveryTarget;
}

/** Domain-prepared exact unit; the Host persists the complete plan before admitting any mutation. */
export interface DataMigrationPlan {
  readonly id: string;
  readonly candidateId: string;
  readonly domain: string;
  readonly sourceVersion: string;
  readonly beforeDigest: string;
  readonly target: DeliveryTarget;
  readonly recordCount: number;
  /** Full lossless before-images and exact domain writes, not a 64 KiB state-store value. */
  readonly data: JsonValue;
  readonly description: readonly string[];
  /** These facts require fresh authorization and must never be activated by a data migration. */
  readonly authorizationCandidates: readonly JsonValue[];
}
export interface ApplyDataMigrationRequest extends DataMigrationRequest {
  readonly plan: DataMigrationPlan;
}
/** Confirmed by the same atomic domain unit as the writes; unknown commits are never blindly retried. */
export interface DataMigrationReceipt {
  /** Distinguishes an original commit from its explicit reversal during reconciliation. */
  readonly operation: 'apply' | 'restore';
  readonly planId: string;
  readonly candidateId: string;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly recordCount: number;
  readonly status: 'applied' | 'already_applied';
  readonly maintenance: 'paused';
}
export interface ResumeDataMigrationRequest extends DataMigrationRequest {
  readonly plan: DataMigrationPlan;
}
export interface RestoreDataMigrationRequest extends ResumeDataMigrationRequest {
  readonly receipt: DataMigrationReceipt;
}
export interface InspectDataMigrationRequest extends DataMigrationRequest {
  readonly plan: DataMigrationPlan;
}
/** Verified current rows plus the durable maintenance journal, never inferred from a missing receipt. */
export interface DataMigrationInspection {
  readonly data: 'not_applied' | 'applied' | 'restored' | 'conflict' | 'unknown';
  readonly maintenance: 'paused' | 'resumed' | 'unknown';
  /** True only for paused, drained scopes with a verified current recovery baseline; never authorizes data writes. */
  readonly resumable: boolean;
  /** A committed write receipt is not evidence that maintenance has resumed. */
  readonly receipt?: DataMigrationReceipt;
}

/** Plugin owns record semantics, maintenance admission/drain and the existing transactional store. */
export interface PluginDataMigrationProvider extends GenerationAdmissionSource {
  readonly title: string;
  preview(request?: DataMigrationRequest): Promise<DataMigrationInventory>;
  prepare(request: PrepareDataMigrationRequest): Promise<DataMigrationPlan>;
  /** Enter the selected scope's maintenance, drain work, recheck and commit; leave it paused. */
  apply(request: ApplyDataMigrationRequest): Promise<DataMigrationReceipt>;
  /** Pure authoritative inspection; an in-flight mutation or unprovable state remains unknown. */
  inspect(request: InspectDataMigrationRequest): Promise<DataMigrationInspection>;
  /** Explicit resumption never starts an account, replays delivery or extends a game deadline. */
  resume(request: ResumeDataMigrationRequest): Promise<void>;
  /** Restore only when the actual rows still match the confirmed after-image; remain paused. */
  restore(request: RestoreDataMigrationRequest): Promise<DataMigrationReceipt>;
}

/**
 * commit_unknown means the data commit result is unconfirmed. invalid_input/conflict/unsupported/
 * not_found guarantee no data commit by this invocation, but do not imply maintenance was released.
 * unavailable does not establish either outcome. Inspect before recovery; never blindly replay.
 */
export class DataMigrationError extends Error {
  constructor(readonly code: 'invalid_input' | 'conflict' | 'unsupported' | 'unavailable' | 'not_found' | 'commit_unknown', message: string) {
    super(message); this.name = 'DataMigrationError';
  }
}

/** Existing owner Resource discovery, not a process-global migration registry. */
export const pluginDataMigrationProviderToken = createToken<PluginDataMigrationProvider>(
  'zhin.plugin-data-migration', 'Plugin-owned historical data migration, controlled by authenticated Host operations',
);
