import type { WorkroomPriorityChangeProposal, WorkroomSponsorLane } from './workroom-scheduler.js';

export interface WorkroomPriorityAuthorizationInput {
  readonly version: 1;
  readonly proposal: WorkroomPriorityChangeProposal;
  /** Exact admitted Plan authority; the authority port must join it to the current Catalog. */
  readonly projectAuthority: Readonly<{
    readonly catalogRevision: string;
    readonly projectDigest: string;
    readonly orchestratorAgentDefinitionId: string;
  }>;
  readonly currentTask: Readonly<{
    taskRevision: number;
    sponsorLane: WorkroomSponsorLane;
    localRank: number;
  }>;
}

export type WorkroomPriorityAuthorizationDecision =
  | Readonly<{
      authorized: true;
      authority: 'sponsor' | 'orchestrator';
      principalId: string;
      authorizationRef: string;
      proposalDigest: string;
    }>
  | Readonly<{ authorized: false; reason: string }>;

/** Trusted role-scoped verifier; model-visible proposal data is never authority. */
export interface WorkroomPriorityAuthorityPort {
  authorize(
    input: WorkroomPriorityAuthorizationInput,
  ): WorkroomPriorityAuthorizationDecision | Promise<WorkroomPriorityAuthorizationDecision>;
}

export class WorkroomPriorityUnauthorizedError extends Error {
  constructor(readonly reason: string) {
    super(`Workroom priority change is unauthorized: ${reason}`);
    this.name = 'WorkroomPriorityUnauthorizedError';
  }
}
