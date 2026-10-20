import type { WorkroomExecutionRole } from '../kernel-contracts.js';
import type {
  GovernedDisclosureManifestRequest,
  MaterializedDisclosureManifest,
} from '../../data-governance/disclosure-manifest.js';
import type {
  GovernedDisclosureRevalidationResult,
  GovernedProjectionDisclosureResult,
} from '../../data-governance/disclosure-authority.js';

export interface WorkroomProjectionConversation {
  readonly endpoint: Readonly<{ id: string; adapter: string }>;
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly parent?: Readonly<{ kind: 'private' | 'group' | 'channel'; id: string }>;
  readonly threadId?: string;
}

export interface WorkroomProjectionAgentIdentity {
  readonly principalId: string;
  readonly agentDefinitionId: string;
  readonly displayName: string;
  readonly role: 'orchestrator' | WorkroomExecutionRole;
  /** Exact generation-owned Endpoint used to present this member in the room. */
  readonly messageEndpoint?: Readonly<{ id: string; adapter: string }>;
}

export interface WorkroomProjectionBinding {
  readonly version: 1;
  readonly audience: 'workroom' | 'sponsor_room';
  readonly projectId: string;
  readonly catalogBindingDigest: string;
  readonly bindingRevision: number;
  readonly projectionPolicyRevision: number;
  readonly conversation: WorkroomProjectionConversation;
  readonly orchestrator: WorkroomProjectionAgentIdentity & Readonly<{ role: 'orchestrator' }>;
  readonly agents: readonly WorkroomProjectionAgentIdentity[];
}

export interface WorkroomProjectionTarget {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey?: string;
  readonly taskRevision?: number;
  readonly assignmentId?: string;
  readonly assignmentRevision?: number;
  readonly agentDefinitionId: string;
}

export interface WorkroomProjectionDeliveryState {
  readonly status: 'pending' | 'leased' | 'failed' | 'sent';
  readonly attempts: number;
  readonly fence: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: number;
  readonly failureCode?: string;
  readonly retryable?: boolean;
  readonly nextAttemptAt?: number;
  readonly message?: WorkroomProjectionMessageRef;
}

export interface WorkroomProjectionOutboxItem {
  readonly version: 1;
  readonly audience: 'workroom' | 'sponsor_room';
  readonly id: string;
  readonly idempotencyKey: string;
  readonly digest: string;
  readonly projectId: string;
  readonly runId: string;
  /** Binding-generation cursor for this exact Project, audience and binding revision. */
  readonly cursorId: string;
  readonly sourceEventIds: readonly string[];
  readonly sourceSequence: number;
  readonly bindingRevision: number;
  readonly projectionPolicyRevision: number;
  readonly conversation: WorkroomProjectionConversation;
  readonly speaker: WorkroomProjectionAgentIdentity;
  readonly kind: 'status' | 'progress' | 'milestone' | 'attention' | 'conclusion';
  /** Exact content-free authority snapshot. The body remains only in the Vault. */
  readonly disclosure: Readonly<{
    request: GovernedDisclosureManifestRequest;
    manifest: MaterializedDisclosureManifest;
  }>;
  readonly target: WorkroomProjectionTarget;
  readonly delivery: WorkroomProjectionDeliveryState;
}

export interface WorkroomProjectionMessageRef {
  readonly conversation: WorkroomProjectionConversation;
  readonly id: string;
}

export interface WorkroomProjectionMessageIndexEntry {
  readonly projectionId: string;
  readonly bindingRevision: number;
  readonly sourceEventIds: readonly string[];
  readonly target: WorkroomProjectionTarget;
  readonly speaker: WorkroomProjectionAgentIdentity;
  readonly message: WorkroomProjectionMessageRef;
}

export interface WorkroomProjectionActiveAssignmentTarget {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
}

export interface WorkroomProjectionReplyTargetInput {
  readonly projectId: string;
  readonly bindingRevision: number;
  readonly replyTo: WorkroomProjectionMessageRef;
  readonly intent: 'discussion' | 'task_input';
  readonly activeAssignments: readonly WorkroomProjectionActiveAssignmentTarget[];
}

export type WorkroomProjectionReplyTargetDecision =
  | Readonly<{
      status: 'task_target';
      via: 'reply';
      disposition: 'discussion_only' | 'context_proposal';
      sourceProjectionId: string;
      sourceEventIds: readonly string[];
      target: WorkroomProjectionActiveAssignmentTarget & Readonly<{
        agentDefinitionId: string;
        status: 'active' | 'historical';
      }>;
    }>
  | Readonly<{
      status: 'clarification_required';
      reason: 'target_not_found' | 'cross_project_target' | 'stale_binding' | 'non_task_projection';
      candidateRefs: readonly string[];
    }>;

export interface WorkroomProjectionState {
  readonly revision: number;
  readonly bindings: Readonly<Record<string, WorkroomProjectionBinding>>;
  readonly cursors: Readonly<Record<string, number>>;
  readonly items: Readonly<Record<string, WorkroomProjectionOutboxItem>>;
  readonly messageIndex: Readonly<Record<string, WorkroomProjectionMessageIndexEntry>>;
}

export interface WorkroomProjectionCapture {
  readonly runId: string;
  readonly expectedCursor: number;
  readonly cursor: number;
  readonly items: readonly WorkroomProjectionOutboxItem[];
}

export interface WorkroomProjectionRepository {
  read(): Promise<WorkroomProjectionState>;
  bind(
    expectedRevision: number,
    binding: WorkroomProjectionBinding,
  ): Promise<WorkroomProjectionState>;
  capture(expectedRevision: number, input: WorkroomProjectionCapture): Promise<WorkroomProjectionState>;
  claimNext(
    expectedRevision: number,
    workerId: string,
    now: number,
    leaseMs: number,
  ): Promise<WorkroomProjectionOutboxItem | undefined>;
  settle(
    expectedRevision: number,
    itemId: string,
    workerId: string,
    fence: number,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ): Promise<WorkroomProjectionState>;
}

export type WorkroomProjectionDeliveryResult =
  | Readonly<{ status: 'sent'; message?: WorkroomProjectionMessageRef }>
  | Readonly<{ status: 'failed'; code: string; retryable: boolean }>;

export interface WorkroomProjectionDeliveryPort {
  send(
    item: WorkroomProjectionOutboxItem,
    body: Uint8Array,
    signal: AbortSignal,
  ): Promise<WorkroomProjectionDeliveryResult>;
}

export interface WorkroomProjectionGovernancePort {
  prepareProjection(
    input: Readonly<{
      operationId: string;
      projectId: string;
      sinkRuleId: string;
      body: string;
      sourceEventIds: readonly string[];
    }>,
    signal: AbortSignal,
  ): Promise<GovernedProjectionDisclosureResult>;
  revalidate(
    input: Readonly<{
      request: GovernedDisclosureManifestRequest;
      manifest: MaterializedDisclosureManifest;
    }>,
    signal: AbortSignal,
  ): Promise<GovernedDisclosureRevalidationResult>;
}

export interface WorkroomLifecycleHoldOverdueSnapshot {
  readonly version: 1;
  readonly projectId: string;
  readonly clockRevision: number;
  readonly observedAt: number;
  readonly overdue: readonly Readonly<{
    objectId: string;
    stateSequence: number;
    stateDigest: string;
    holdId: string;
    ownerPrincipalId: string;
    reasonCode: 'legal_hold' | 'investigation' | 'regulatory_preservation';
    placedAt: number;
    reviewAt: number;
    overdueBy: number;
  }>[];
  readonly digest: string;
}

export class WorkroomProjectionRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Workroom Projection revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'WorkroomProjectionRevisionConflictError';
  }
}
