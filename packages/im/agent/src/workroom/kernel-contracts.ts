import type {
  WorkroomAcceptanceContract,
  WorkroomAcceptanceDecision,
  WorkroomAcceptancePolicySnapshot,
  WorkroomAcceptanceRecord,
  WorkroomAcceptanceRoute,
  WorkroomRiskTier,
  WorkroomAcceptanceWaitAction,
} from './acceptance-policy.js';

export type WorkroomRunStatus =
  | 'active'
  | 'blocked'
  | 'needs_replan'
  | 'cancelling'
  | 'completed'
  | 'cancelled';

export type WorkroomTaskStatus =
  | 'ready'
  | 'blocked'
  | 'executing'
  | 'awaiting_acceptance'
  | 'cancelling'
  | 'accepted'
  | 'failed'
  | 'cancelled';

export type WorkroomAssignmentStatus =
  | 'leased'
  | 'running'
  | 'cancel_requested'
  | 'execution_completed'
  | 'lost'
  | 'cancelled';

export type WorkroomExecutionRole = 'executor' | 'reviewer' | 'integration';
export type WorkroomBlockerKind = 'dependency' | 'approval' | 'capability' | 'external' | 'human_input';

export interface WorkroomBlocker {
  readonly id: string;
  readonly kind: WorkroomBlockerKind;
  readonly owner: string;
  readonly reason: string;
  readonly deadline: number;
  readonly allowedActions: readonly ('resolve' | 'replan' | 'cancel')[];
}

export interface WorkroomTaskState {
  readonly key: string;
  readonly title: string;
  readonly status: WorkroomTaskStatus;
  readonly revision: number;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly required: boolean;
  readonly blockers: readonly WorkroomBlocker[];
  readonly currentAssignmentId?: string;
  readonly reportRef?: string;
  readonly acceptanceContract?: WorkroomAcceptanceContract;
  readonly acceptanceRecord?: WorkroomAcceptanceRecord;
  readonly currentReviewerAssignmentId?: string;
  readonly currentSponsorGateId?: string;
  readonly acceptanceBlockReason?: string;
  readonly terminalReason?: string;
}

export type WorkroomAcceptanceWaitStatus = 'open' | 'expired' | 'cancelled' | 'satisfied' | 'stale';

export interface WorkroomAcceptanceWaitState {
  readonly id: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly candidateHash: string;
  readonly riskTier: WorkroomRiskTier;
  readonly route: Extract<
    WorkroomAcceptanceRoute,
    'reviewer_required' | 'sponsor_required' | 'reviewer_then_sponsor'
  >;
  readonly contractId: string;
  readonly policy: WorkroomAcceptancePolicySnapshot;
  readonly owner: string;
  readonly deadline: number;
  readonly allowedActions: readonly WorkroomAcceptanceWaitAction[];
  readonly evaluation: WorkroomAcceptanceDecision;
}

export interface WorkroomReviewerAssignmentState extends WorkroomAcceptanceWaitState {
  readonly producerPrincipalId: string;
  readonly status: WorkroomAcceptanceWaitStatus | 'claimed' | 'passed' | 'rework';
  readonly reviewerPrincipalId?: string;
  readonly authorizationRef?: string;
  readonly verdict?: Readonly<Record<string, unknown>>;
}

export interface WorkroomSponsorGateState extends WorkroomAcceptanceWaitState {
  readonly status: WorkroomAcceptanceWaitStatus | 'approved' | 'rejected' | 'changes_requested';
  readonly reviewerAssignmentId?: string;
  readonly sponsorPrincipalId?: string;
  readonly authorizationRef?: string;
  readonly decisionReason?: string;
}

export interface WorkroomAssignmentState {
  readonly id: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly attempt: number;
  readonly role: WorkroomExecutionRole;
  readonly status: WorkroomAssignmentStatus;
  readonly owner: string;
  readonly leaseExpiresAt: number;
  readonly controlDeadline?: number;
  readonly checkpointRef?: string;
  readonly reportRef?: string;
  readonly outcome?: 'interrupted' | 'committed' | 'outcome_unknown';
}

export interface WorkroomRunState {
  readonly runId: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: WorkroomRunStatus;
  readonly sequence: number;
  readonly now: number;
  readonly cancelRequested: boolean;
  readonly tasks: Readonly<Record<string, WorkroomTaskState>>;
  readonly assignments: Readonly<Record<string, WorkroomAssignmentState>>;
  readonly reviewerAssignments: Readonly<Record<string, WorkroomReviewerAssignmentState>>;
  readonly sponsorGates: Readonly<Record<string, WorkroomSponsorGateState>>;
}

export type WorkroomEventType =
  | 'run.created'
  | 'run.cancel_requested'
  | 'run.cancelled'
  | 'task.planned'
  | 'task.blocked'
  | 'task.blocker_resolved'
  | 'task.cancel_requested'
  | 'task.cancelled'
  | 'task.failed'
  | 'task.accepted'
  | 'task.acceptance_pinned'
  | 'task.acceptance_blocked'
  | 'reviewer.assigned'
  | 'reviewer.claimed'
  | 'reviewer.verdict_recorded'
  | 'reviewer.expired'
  | 'sponsor_gate.opened'
  | 'sponsor_gate.decided'
  | 'sponsor_gate.expired'
  | 'task.rework_requested'
  | 'task.revised'
  | 'assignment.claimed'
  | 'assignment.started'
  | 'assignment.heartbeat'
  | 'assignment.execution_completed'
  | 'assignment.cancel_requested'
  | 'assignment.cancelled'
  | 'assignment.lease_expired'
  | 'clock.advanced';

export interface WorkroomEvent {
  readonly version: 1;
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: number;
  readonly type: WorkroomEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type WorkroomEventDraft = Omit<WorkroomEvent, 'version' | 'runId' | 'sequence'>;

export type WorkroomCommand =
  | Readonly<{ type: 'plan_task'; taskKey: string; title: string; required: boolean; maxAttempts: number }>
  | Readonly<{ type: 'block_task'; taskKey: string; blockerId: string; kind: WorkroomBlockerKind; owner: string; reason: string; deadline: number }>
  | Readonly<{ type: 'resolve_blocker'; taskKey: string; blockerId: string }>
  | Readonly<{ type: 'claim_task'; taskKey: string; assignmentId: string; owner: string; role: WorkroomExecutionRole; leaseExpiresAt: number }>
  | Readonly<{ type: 'start_assignment'; assignmentId: string }>
  | Readonly<{ type: 'heartbeat'; assignmentId: string; leaseExpiresAt: number }>
  | Readonly<{ type: 'complete_execution'; assignmentId: string; reportRef: string }>
  | Readonly<{ type: 'request_rework'; taskKey: string; reason: string }>
  | Readonly<{ type: 'revise_task'; taskKey: string; title: string; reason: string; maxAttempts: number }>
  | Readonly<{ type: 'cancel_run'; reason: string; controlDeadline: number }>
  | Readonly<{ type: 'advance_clock'; now: number }>;
