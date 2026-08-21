import {
  portfolioKernelCommandDigest,
  replayPortfolioAdmission,
} from '../portfolio/portfolio-admission.js';
import type {
  PortfolioJournalRepository,
  PortfolioKernelCommandAuthority,
} from '../portfolio/portfolio-journal.js';
import {
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import { replayWorkroom } from '../workroom/kernel-state.js';
import { parseWorkroomDispatchTaskDecision } from '../workroom/workroom-scheduler.js';
import type { PortfolioKernelCommandAuthorityPort } from './workroom-portfolio-capacity.js';
import { workroomSchedulerPortfolioOpaqueHeadId } from './workroom-portfolio-grant-assignment.js';

/**
 * Exact production authority for deterministic Assignment claim rejection.
 * Other Portfolio commands remain owned by the supplied authority chain.
 */
export class WorkroomPortfolioAssignmentFailureAuthority
implements PortfolioKernelCommandAuthorityPort {
  constructor(readonly options: Readonly<{
    generation: number;
    portfolioJournal: Pick<PortfolioJournalRepository, 'read'>;
    workroomJournal: Pick<WorkroomJournal, 'read'>;
    fallback?: PortfolioKernelCommandAuthorityPort;
  }>) {
    if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
      throw new Error('Portfolio Assignment failure authority generation is invalid');
    }
  }

  async authorize(
    input: Parameters<PortfolioKernelCommandAuthorityPort['authorize']>[0],
  ): Promise<PortfolioKernelCommandAuthority | undefined> {
    if (input.action !== 'assignment_failed') {
      return await this.options.fallback?.authorize(input);
    }
    if (input.generation !== this.options.generation || input.failureReason === undefined
      || input.kernelSequence === undefined || input.kernelFactDigest === undefined) return undefined;
    const facts = await this.options.portfolioJournal.read(input.portfolioId);
    const portfolio = replayPortfolioAdmission(input.portfolioId, facts);
    const grant = portfolio.grants[input.grant.grantId];
    const request = portfolio.requests[input.grant.requestId]?.request;
    if (!grant || !request || canonicalWorkroomJson(grant) !== canonicalWorkroomJson(input.grant)
      || grant.status !== 'consumed' || grant.assignmentRef !== input.assignmentRef) return undefined;
    const events = await this.options.workroomJournal.read(request.workRef.runId);
    const decisionEvent = events[request.schedulerSequence];
    if (!decisionEvent || decisionEvent.type !== 'scheduler.dispatch_requested') return undefined;
    const decision = parseWorkroomDispatchTaskDecision(decisionEvent.payload);
    if (decision.projectId !== grant.projectId || decision.runId !== request.workRef.runId
      || decision.policy.digest !== request.schedulerRevision
      || request.opaqueHeadId !== workroomSchedulerPortfolioOpaqueHeadId(decision)) return undefined;
    const state = replayWorkroom(events);
    if (state.sequence !== input.kernelSequence || digest(state) !== input.kernelFactDigest
      || Object.hasOwn(state.assignments, input.assignmentRef)) return undefined;
    if (failureReason(state.status, state.tasks[decision.taskKey]?.status,
      state.tasks[decision.taskKey]?.revision, decision.taskRevision) !== input.failureReason) return undefined;
    const claims = {
      portfolioId: input.portfolioId,
      action: 'assignment_failed' as const,
      projectId: grant.projectId,
      requestId: grant.requestId,
      grantId: grant.grantId,
      fence: grant.fence,
      assignmentRef: input.assignmentRef,
      failureReason: input.failureReason,
      kernelSequence: input.kernelSequence,
      kernelFactDigest: input.kernelFactDigest,
    };
    return Object.freeze({
      ...claims,
      commandDigest: portfolioKernelCommandDigest(claims),
      authorizedBy: [
        'workroom-kernel-assignment-failure:v1', this.options.generation,
        input.portfolioId, decision.projectId, decision.runId, state.sequence,
      ].map(String).map(encodeURIComponent).join(':'),
    });
  }
}

function failureReason(
  runStatus: string,
  taskStatus: string | undefined,
  taskRevision: number | undefined,
  decisionTaskRevision: number,
) {
  if (runStatus === 'completed' || runStatus === 'cancelled') return 'run_terminal' as const;
  if (taskStatus === 'accepted' || taskStatus === 'failed' || taskStatus === 'cancelled') {
    return 'task_terminal' as const;
  }
  if (taskRevision !== undefined && taskRevision !== decisionTaskRevision) return 'task_stale' as const;
  if (taskStatus === 'executing' || taskStatus === 'awaiting_acceptance' || taskStatus === 'cancelling') {
    return 'task_stale' as const;
  }
  return undefined;
}
