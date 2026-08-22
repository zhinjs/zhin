import { WorkroomPortfolioAssignmentFailureAuthority } from '../../src/plugin-runtime/workroom-portfolio-kernel-authority.js';
import {
  PortfolioAdmissionApplication,
  portfolioCapacityRequestDigest,
  portfolioKernelCommandDigest,
  portfolioValidatedBundleDigest,
} from '../../src/portfolio/portfolio-admission.js';
import {
  InMemoryPortfolioJournalRepository,
  createPortfolioPolicySnapshot,
  type PortfolioCapacityRequest,
  type PortfolioKernelCommandAuthority,
  type PortfolioValidatedBundleAuthority,
} from '../../src/portfolio/portfolio-journal.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';
import { replayWorkroom } from '../../src/workroom/kernel-state.js';
import { workroomSchedulerPortfolioOpaqueHeadId } from '../../src/plugin-runtime/workroom-portfolio-grant-assignment.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Workroom Portfolio Assignment failure authority', () => {
  it('signs only an exact consumed Grant backed by the terminal Kernel state proof', async () => {
    const decision = schedulerDecision();
    const events = workroomEvents(decision);
    const repository = new InMemoryPortfolioJournalRepository();
    const application = new PortfolioAdmissionApplication({
      portfolioId: 'portfolio-main', repository,
      ids: { eventId: (type, identity) => `${type}:${identity}` },
    });
    const policy = createPortfolioPolicySnapshot({
      revision: 1, globalBudgetMicros: 1_000, offerTtlTicks: 5, leaseTtlTicks: 10,
      leaseHeartbeatTicks: 2, maxLeaseQuantumTicks: 20, maxLeaseRenewals: 2, reclaimTtlTicks: 4,
      pools: { model: { poolId: 'model', capacityUnits: 1, rateUnitsPerWindow: 10,
        rateWindowTicks: 10, priceMicrosPerBudgetUnit: 1 } },
      projects: { 'project-a': { projectId: 'project-a', revision: 1, lane: 'normal', weight: 1,
        hardBudgetMicros: 100, allowedPools: ['model'], maxOutstandingRequests: 2,
        maxConcurrentGrants: 1, burstLimit: 2, starvationTicks: 3, status: 'active' } },
    });
    await application.pinPolicy(policy, { principalId: 'sponsor:1', authorizedBy: 'root:1',
      reasonDigest: SHA, targetDigest: policy.digest, expectedRevision: 0 });
    const request = capacityRequest(decision);
    const bundle = bundleAuthority(request);
    await application.submit(request, bundle);
    const offered = (await application.decideAdmission())!;
    const consumeClaims = { portfolioId: 'portfolio-main', action: 'consume' as const,
      projectId: offered.projectId, requestId: offered.requestId, grantId: offered.grantId,
      fence: offered.fence, assignmentRef: 'assignment:never-created' };
    await application.consume({ grantId: offered.grantId, projectId: offered.projectId,
      fence: offered.fence, assignmentRef: consumeClaims.assignmentRef }, {
      ...consumeClaims, commandDigest: portfolioKernelCommandDigest(consumeClaims), authorizedBy: 'kernel:consume',
    });
    const grant = (await application.read()).grants[offered.grantId]!;
    const kernel = replayWorkroom(events);
    const authority = new WorkroomPortfolioAssignmentFailureAuthority({
      generation: 7, portfolioJournal: repository, workroomJournal: { read: async () => events },
    });
    const input = { generation: 7, portfolioId: 'portfolio-main', action: 'assignment_failed' as const,
      grant, assignmentRef: consumeClaims.assignmentRef, failureReason: 'task_terminal' as const,
      kernelSequence: kernel.sequence, kernelFactDigest: digest(kernel) };

    const authorized = await authority.authorize(input);

    expect(authorized).toMatchObject({
      action: 'assignment_failed', requestId: request.requestId, grantId: grant.grantId,
      assignmentRef: consumeClaims.assignmentRef, failureReason: 'task_terminal',
      kernelSequence: kernel.sequence, kernelFactDigest: digest(kernel),
    });
    expect(authorized?.commandDigest).toBe(portfolioKernelCommandDigest(commandClaims(authorized!)));
    await expect(authority.authorize({ ...input, kernelFactDigest: `sha256:${'b'.repeat(64)}` }))
      .resolves.toBeUndefined();
    await expect(authority.authorize({ ...input, failureReason: 'task_stale' }))
      .resolves.toBeUndefined();
  });
});

function schedulerDecision() {
  const body = { version: 1 as const, type: 'dispatch_task' as const, projectId: 'project-a',
    runId: 'run-a', expectedSequence: 1, taskKey: 'task-a', taskRevision: 1, role: 'executor',
    sponsorLane: 'normal' as const, reason: 'scheduler_order' as const,
    policy: { ref: 'scheduler-policy:1', revision: 1, digest: SHA } };
  const decisionDigest = digest(body);
  return Object.freeze({ ...body, decisionId: `scheduler:${decisionDigest.slice(7)}`, digest: decisionDigest });
}

function workroomEvents(decision: ReturnType<typeof schedulerDecision>): readonly WorkroomEvent[] {
  return Object.freeze([
    event(0, 'run.created', { projectId: 'project-a', title: 'governed-title' }),
    event(1, 'task.planned', { taskKey: 'task-a', title: 'governed-task', required: true, maxAttempts: 2 }),
    event(2, 'scheduler.dispatch_requested', decision),
    event(3, 'task.failed', { taskKey: 'task-a', reason: 'superseded before claim' }),
  ]);
}

function event(sequence: number, type: WorkroomEvent['type'], payload: object): WorkroomEvent {
  return { version: 1, eventId: `event:${sequence}`, runId: 'run-a', sequence,
    occurredAt: sequence, type, payload };
}

function capacityRequest(decision: ReturnType<typeof schedulerDecision>): PortfolioCapacityRequest {
  return { requestId: 'request-a', projectId: 'project-a', workRef: { runId: 'run-a',
    profileRevisionId: 'profile:1', profileDigest: SHA }, schedulerRevision: decision.policy.digest,
    schedulerSequence: 2, localOrder: 1, projectPolicyRevision: 1,
    opaqueHeadId: workroomSchedulerPortfolioOpaqueHeadId(decision), payloadDigest: SHA,
    resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 5 }] },
    preemptibility: 'checkpointable', starvationAt: 3 };
}

function bundleAuthority(request: PortfolioCapacityRequest): PortfolioValidatedBundleAuthority {
  const claims = { requestDigest: portfolioCapacityRequestDigest(request), resourceBundleDigest: digest(request.resourceBundle),
    catalogGenerationId: 'catalog:7', catalogRevision: 1, catalogDigest: SHA,
    profileRevisionId: request.workRef.profileRevisionId, profileDigest: request.workRef.profileDigest,
    profileCeilingDigest: SHA, reservedCostMicros: 5 };
  return { ...claims, validatedBundleDigest: portfolioValidatedBundleDigest(claims) };
}

function commandClaims(authority: PortfolioKernelCommandAuthority) {
  const { commandDigest: ignoredDigest, authorizedBy: ignoredAuthority, ...claims } = authority;
  void ignoredDigest; void ignoredAuthority;
  return claims;
}
