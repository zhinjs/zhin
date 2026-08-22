export type WorkroomPlanGateDecision = 'approve' | 'reject' | 'request_changes' | 'cancel';

export interface WorkroomPlanGateDecisionInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly gateId: string;
  readonly expectedSequence: number;
  readonly decision: WorkroomPlanGateDecision;
  readonly reason: string;
  readonly sponsorPrincipalId: string;
  readonly sponsorAuthorityRef: string;
}

/** Exact Kernel-derived scope presented to a trusted Sponsor authority port. */
export interface WorkroomPlanGateAuthorizationInput extends WorkroomPlanGateDecisionInput {
  readonly version: 1;
  readonly planProposalId: string;
  readonly planDigest: string;
  readonly projectRevision: string;
  readonly projectDigest: string;
  readonly sourceParameterDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly policyRevisionId: string;
  readonly policyDigest: string;
  readonly gateOwner: string;
  readonly gateDeadline: number;
}

export type WorkroomPlanGateAuthorizationDecision =
  | Readonly<{
      authorized: true;
      principalId: string;
      authorizationRef: string;
    }>
  | Readonly<{ authorized: false; reason: string }>;

export interface WorkroomPlanGateAuthorityPort {
  authorize(
    input: WorkroomPlanGateAuthorizationInput,
  ): WorkroomPlanGateAuthorizationDecision | Promise<WorkroomPlanGateAuthorizationDecision>;
}

export interface WorkroomPlanGateDecisionReceipt {
  readonly status: 'committed' | 'duplicate';
  readonly operationId: string;
  readonly receiptRef: string;
  readonly receiptDigest: string;
  readonly state: import('./kernel-contracts.js').WorkroomRunState;
}

export class WorkroomPlanGateUnauthorizedError extends Error {
  constructor(readonly reason: string) {
    super(`Plan Sponsor Gate decision is unauthorized: ${reason}`);
    this.name = 'WorkroomPlanGateUnauthorizedError';
  }
}
