import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomAcceptedReportReader } from '../workroom/accepted-source-memory-application.js';
import type {
  ReviewerVerdict,
  WorkroomAcceptanceAuthorityPort,
  WorkroomAcceptanceAuthorizationDecision,
  WorkroomAcceptanceAuthorizationInput,
} from '../workroom/acceptance-control.js';
import type { WorkroomRunState } from '../workroom/kernel-contracts.js';
import type { WorkroomKernel } from '../workroom/workroom-kernel.js';
import { deepFreezeWorkroomValue as deepFreeze } from '../workroom/canonical-value.js';

export interface WorkroomAcceptancePrincipalFacts {
  readonly principalId: string;
  readonly roles: readonly ('reviewer' | 'sponsor' | 'executor' | 'orchestrator' | 'integration')[];
  readonly profileRef: string;
  readonly profileDigest: string;
  readonly revision: number;
  readonly issuer: string;
  readonly catalogRevision: string;
  readonly projectDigest: string;
}

export interface WorkroomAcceptancePrincipalRegistryPort {
  resolve(input: Readonly<{
    projectId: string;
    runId: string;
    principalId: string;
  }>): Promise<WorkroomAcceptancePrincipalFacts | null>;
}

export const workroomAcceptancePrincipalRegistryToken =
  createToken<WorkroomAcceptancePrincipalRegistryPort>(
    'zhin.agent.workroom-acceptance-principal-registry',
    'Generation/Profile-owned Reviewer and Sponsor principal facts',
  );

export interface ProfileWorkroomAcceptanceAuthorityOptions {
  readonly principals: WorkroomAcceptancePrincipalRegistryPort;
  readonly runState: Readonly<{
    read(projectId: string, runId: string): Promise<WorkroomRunState>;
  }>;
}

/** Exact current-target RBAC. Discussion and model metadata are never inputs. */
export class ProfileWorkroomAcceptanceAuthority implements WorkroomAcceptanceAuthorityPort {
  constructor(readonly options: ProfileWorkroomAcceptanceAuthorityOptions) {}

  async authorize(
    input: Readonly<WorkroomAcceptanceAuthorizationInput>,
  ): Promise<WorkroomAcceptanceAuthorizationDecision> {
    const reject = (reason: string) => deepFreeze({
      ...input,
      role: input.requiredRole,
      authorized: false as const,
      reason,
    });
    const state = await this.options.runState.read(input.projectId, input.runId);
    if (state.projectId !== input.projectId || state.runId !== input.runId
      || state.sequence !== input.expectedSequence) {
      return reject('Acceptance authority targets a stale Run sequence');
    }
    const task = state.tasks[input.taskKey];
    if (!task) return reject('Acceptance authority Task is absent');
    if (input.requiredRole === 'reviewer') {
      const assignment = state.reviewerAssignments[input.targetId];
      if (!assignment || task.currentReviewerAssignmentId !== assignment.id
        || assignment.taskKey !== input.taskKey) {
        return reject('Reviewer Assignment is not the current Task target');
      }
      if (assignment.producerPrincipalId === input.principalId) {
        return reject('Reviewer principal is the Candidate producer');
      }
    } else {
      const gate = state.sponsorGates[input.targetId];
      if (!gate || task.currentSponsorGateId !== gate.id || gate.taskKey !== input.taskKey) {
        return reject('Sponsor Gate is not the current Task target');
      }
    }
    const principal = await this.options.principals.resolve({
      projectId: input.projectId,
      runId: input.runId,
      principalId: input.principalId,
    });
    if (!principal || principal.principalId !== input.principalId
      || !principal.roles.includes(input.requiredRole)) {
      return reject(`Principal lacks exact Profile ${input.requiredRole} role`);
    }
    requireText(principal.profileRef, 'Profile ref');
    requireDigest(principal.profileDigest, 'Profile digest');
    requireText(principal.issuer, 'Profile authority issuer');
    requireText(principal.catalogRevision, 'Catalog revision');
    requireDigest(principal.projectDigest, 'Catalog Project digest');
    if (!Number.isSafeInteger(principal.revision) || principal.revision < 1) {
      return reject('Profile authority revision is invalid');
    }
    return deepFreeze({
      ...input,
      role: input.requiredRole,
      authorized: true as const,
      authorizedBy: `profile-authority:${principal.profileDigest}:${principal.revision}:${principal.issuer}`,
    });
  }
}

export interface WorkroomReviewerViewReadInput {
  readonly projectId: string;
  readonly runId: string;
  readonly assignmentId: string;
  readonly principalId: string;
}

export interface WorkroomReviewerViewReaderPort {
  read(input: WorkroomReviewerViewReadInput): Promise<Readonly<Record<string, unknown>>>;
}

export const workroomReviewerViewReaderToken = createToken<WorkroomReviewerViewReaderPort>(
  'zhin.agent.workroom-reviewer-view-reader',
  'Governed read-only Workroom Reviewer View with no Executor capability or workspace',
);

export interface WorkroomReviewerVerdictCommandBinding {
  readonly projectId: string;
  readonly runId: string;
  readonly assignmentId: string;
  readonly principalId: string;
}

export interface WorkroomReviewerVerdictCommandPort {
  /** Candidate/criteria remain typed payload; all authority scope is already fixed. */
  submit(verdict: ReviewerVerdict): Promise<WorkroomRunState>;
}

/**
 * Reviewer-only writer. The caller cannot claim work, select another target,
 * decide a Sponsor Gate, or invoke a generic Kernel transition.
 */
export function createWorkroomReviewerVerdictCommandPort(options: Readonly<{
  kernel: Pick<WorkroomKernel, 'submitReviewerVerdict'>;
  binding: WorkroomReviewerVerdictCommandBinding;
}>): WorkroomReviewerVerdictCommandPort {
  const binding = deepFreeze({
    projectId: requireText(options.binding.projectId, 'Reviewer command Project id'),
    runId: requireText(options.binding.runId, 'Reviewer command Run id'),
    assignmentId: requireText(options.binding.assignmentId, 'Reviewer command Assignment id'),
    principalId: requireText(options.binding.principalId, 'Reviewer command principal id'),
  });
  return Object.freeze({
    submit: async (verdict: ReviewerVerdict): Promise<WorkroomRunState> =>
      await options.kernel.submitReviewerVerdict(
        binding.projectId,
        binding.runId,
        binding.assignmentId,
        binding.principalId,
        deepFreeze(structuredClone(verdict)),
      ),
  });
}

export interface WorkroomReviewerViewReaderOptions {
  readonly runState: ProfileWorkroomAcceptanceAuthorityOptions['runState'];
  readonly reports: WorkroomAcceptedReportReader;
}

export class WorkroomReviewerViewReader implements WorkroomReviewerViewReaderPort {
  constructor(readonly options: WorkroomReviewerViewReaderOptions) {}

  async read(input: WorkroomReviewerViewReadInput): Promise<Readonly<Record<string, unknown>>> {
    const state = await this.options.runState.read(input.projectId, input.runId);
    const assignment = state.reviewerAssignments[input.assignmentId];
    if (!assignment || assignment.status !== 'claimed'
      || assignment.reviewerPrincipalId !== input.principalId
      || assignment.producerPrincipalId === input.principalId) {
      throw new Error('Reviewer View requires the independently claimed current Reviewer Assignment');
    }
    const task = state.tasks[assignment.taskKey];
    if (!task || task.currentReviewerAssignmentId !== assignment.id
      || task.revision !== assignment.taskRevision
      || task.candidateHash !== assignment.candidateHash) {
      throw new Error('Reviewer View target is stale');
    }
    const evaluation = assignment.evaluation;
    const report = await this.options.reports.read({
      projectId: input.projectId,
      runId: input.runId,
      taskKey: assignment.taskKey,
      reportRef: evaluation.candidate.reportRef,
      candidateHash: assignment.candidateHash,
      purpose: 'acceptance-review',
    });
    if (!report) throw new Error('Governed Reviewer Report View is unavailable');
    return deepFreeze({
      version: 1,
      projectId: input.projectId,
      runId: input.runId,
      taskKey: assignment.taskKey,
      taskRevision: assignment.taskRevision,
      reviewerAssignmentId: assignment.id,
      reviewerPrincipalId: input.principalId,
      producerPrincipalId: assignment.producerPrincipalId,
      candidateHash: assignment.candidateHash,
      contract: evaluation.contract,
      riskAssessment: evaluation.riskAssessment,
      checkResults: evaluation.checkResults,
      report,
      readOnly: true,
    });
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
