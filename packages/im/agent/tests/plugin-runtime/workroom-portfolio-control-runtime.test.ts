import {
  WorkroomPortfolioControlRuntime,
} from '../../src/plugin-runtime/workroom-portfolio-control-runtime.js';
import { GenerationOwnedPortfolioCapacityRuntime } from '../../src/plugin-runtime/workroom-portfolio-capacity.js';
import {
  MemoryPortfolioControlOutboxRepository,
  replayPortfolioControlOutbox,
  type PortfolioControlAck,
  type PortfolioControlOutboxItem,
} from '../../src/portfolio/capacity-control-outbox.js';
import { vi } from 'vitest';
import { PortfolioGrantAssignmentCompensatedError } from '../../src/plugin-runtime/workroom-portfolio-grant-assignment.js';
import {
  InMemoryPortfolioJournalRepository,
  createPortfolioPolicySnapshot,
  parsePortfolioResourceBundle,
  type PortfolioCapacityRequest,
  type PortfolioGovernanceProof,
  type PortfolioKernelCommandAuthority,
  type PortfolioProjectPolicy,
} from '../../src/portfolio/portfolio-journal.js';
import {
  portfolioClockDigest,
  portfolioCapacityRequestDigest,
  portfolioKernelCommandDigest,
  portfolioValidatedBundleDigest,
  replayPortfolioAdmission,
} from '../../src/portfolio/portfolio-admission.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { ValidatedAtomicResourceBundle } from '../../src/portfolio/resource-bundle.js';

describe('Workroom Portfolio Control Runtime', () => {
  it('releases checkpointable capacity only after authenticated checkpoint ack', async () => {
    const journal = new InMemoryPortfolioJournalRepository();
    const capacity = capacityRuntime(journal);
    const first = schedulerInput(request('victim', 'project-a', 'checkpointable'));
    const grant = await capacity.request(first);
    expect(grant?.status).toBe('offered');
    const outbox = new MemoryPortfolioControlOutboxRepository();
    const control = controlRuntime(journal, outbox, capacity);
    expect(await control.drain(signal())).toBe(1);
    expect(replayPortfolioAdmission('portfolio-main', await journal.read('portfolio-main'))
      .grants[grant!.grantId]?.status).toBe('consumed');

    const candidate = schedulerInput(request('urgent', 'project-b', 'checkpointable'));
    expect(await capacity.request(candidate)).toBeNull();
    let state = replayPortfolioAdmission('portfolio-main', await journal.read('portfolio-main'));
    const reclaim = Object.values(state.reclaims)[0]!;
    expect(state.grants[grant!.grantId]?.status).toBe('reclaim_requested');
    expect(reclaim.status).toBe('pending');

    expect(await control.drain(signal())).toBe(1);
    state = replayPortfolioAdmission('portfolio-main', await journal.read('portfolio-main'));
    expect(state.reclaims[reclaim.reclaimId]?.status).toBe('checkpointed');
    expect(state.grants[grant!.grantId]?.status).toBe('usage_pending');
    expect(await capacity.request(candidate)).toMatchObject({ projectId: 'project-b', status: 'offered' });
  });

  it('never creates a reclaim outbox item for atomic work', async () => {
    const journal = new InMemoryPortfolioJournalRepository();
    const capacity = capacityRuntime(journal);
    const atomic = schedulerInput(request('atomic', 'project-a', 'atomic'));
    await capacity.request(atomic);
    const outbox = new MemoryPortfolioControlOutboxRepository();
    const control = controlRuntime(journal, outbox, capacity);
    await control.drain(signal());
    expect(await capacity.request(schedulerInput(request('urgent', 'project-b', 'checkpointable')))).toBeNull();
    await control.drain(signal());
    const events = await outbox.read('portfolio-main');
    expect(JSON.stringify(events)).not.toContain('reclaim_request');
  });

  it('reconciles a lost delivery response after restart without sending the Grant twice', async () => {
    const journal = new InMemoryPortfolioJournalRepository();
    const capacity = capacityRuntime(journal);
    await capacity.request(schedulerInput(request('lost', 'project-a', 'checkpointable')));
    const outbox = new MemoryPortfolioControlOutboxRepository();
    const deliver = vi.fn(async () => { throw new Error('response lost'); });
    const reconcile = vi.fn(async (item: PortfolioControlOutboxItem) => acknowledgement(item));
    const first = controlRuntime(journal, outbox, capacity, { deliver, reconcile });
    expect(await first.drain(signal())).toBe(0);
    expect(Object.values(replayPortfolioControlOutbox(
      'portfolio-main', await outbox.read('portfolio-main'),
    ).items)[0]?.status).toBe('outcome_unknown');

    const restarted = controlRuntime(journal, outbox, capacity, { deliver, reconcile });
    expect(await restarted.drain(signal())).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('persists a terminal tombstone for an undelivered expired Grant offer', async () => {
    const journal = new InMemoryPortfolioJournalRepository();
    const capacity = capacityRuntime(journal, 3);
    await capacity.request(schedulerInput(request('expired', 'project-a', 'checkpointable')));
    await capacity.advanceClock('portfolio-main');
    const outbox = new MemoryPortfolioControlOutboxRepository();
    const deliver = vi.fn(async (item: PortfolioControlOutboxItem) => acknowledgement(item));
    const control = controlRuntime(journal, outbox, capacity, { deliver, reconcile: deliver });

    expect(await control.drain(signal())).toBe(0);
    expect(Object.values(replayPortfolioControlOutbox(
      'portfolio-main', await outbox.read('portfolio-main'),
    ).items)[0]?.status).toBe('closed');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('keeps the durable Grant source pending without churn until route authority recovers', async () => {
    const journal = new InMemoryPortfolioJournalRepository();
    const capacity = capacityRuntime(journal);
    await capacity.request(schedulerInput(request('blocked-route', 'project-a', 'checkpointable')));
    const outbox = new MemoryPortfolioControlOutboxRepository();
    let routeReady = false;
    const control = new WorkroomPortfolioControlRuntime({
      generation: 7, workerId: 'portfolio-worker:7', journal, outbox, capacity,
      route: { resolve: async input => routeReady ? {
        projectId: input.projectId, routeRef: `workroom:${input.projectId}`, routeDigest: sha('7'),
        authorityRef: 'catalog:1', authorityDigest: sha('8'),
      } : undefined },
      delivery: { deliver: async item => acknowledgement(item), reconcile: async item => acknowledgement(item) },
      acknowledgements: { authenticate: async () => true },
    });

    expect(await control.drain(signal())).toBe(0);
    const blockedEvents = await outbox.read('portfolio-main');
    expect(replayPortfolioControlOutbox('portfolio-main', blockedEvents)).toMatchObject({
      sourceCursor: 1, items: {},
    });
    expect(await control.drain(signal())).toBe(0);
    expect(await outbox.read('portfolio-main')).toEqual(blockedEvents);
    routeReady = true;
    expect(await control.drain(signal())).toBe(1);
  });

  it('closes a deterministically compensated Grant instead of retrying it as outcome unknown', async () => {
    const journal = new InMemoryPortfolioJournalRepository();
    const capacity = capacityRuntime(journal);
    await capacity.request(schedulerInput(request('stale', 'project-a', 'checkpointable')));
    const outbox = new MemoryPortfolioControlOutboxRepository();
    const deliver = vi.fn(async (item: PortfolioControlOutboxItem) => {
      const body = {
        version: 1 as const, itemId: item.itemId, portfolioId: item.portfolioId,
        projectId: item.projectId, grantId: item.payload.grant.grantId,
        grantFence: item.payload.grant.fence, deliveryFence: item.deliveryFence,
        assignmentRef: 'assignment:stale', reason: 'task_stale' as const,
        kernelSequence: 17, kernelFactDigest: sha('b'), proofDigest: sha('c'),
      };
      throw new PortfolioGrantAssignmentCompensatedError({ ...body, digest: digest(body) });
    });
    const control = controlRuntime(journal, outbox, capacity, { deliver, reconcile: deliver });

    expect(await control.drain(signal())).toBe(1);
    const item = Object.values(replayPortfolioControlOutbox(
      'portfolio-main', await outbox.read('portfolio-main'),
    ).items)[0]!;
    expect(item).toMatchObject({ status: 'closed', compensation: {
      assignmentRef: 'assignment:stale', reason: 'task_stale',
    } });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await control.drain(signal())).toBe(0);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

function controlRuntime(
  journal: InMemoryPortfolioJournalRepository,
  outbox: MemoryPortfolioControlOutboxRepository,
  capacity: GenerationOwnedPortfolioCapacityRuntime,
  delivery = {
    deliver: async (item: PortfolioControlOutboxItem) => acknowledgement(item),
    reconcile: async (item: PortfolioControlOutboxItem) => acknowledgement(item),
  },
) {
  return new WorkroomPortfolioControlRuntime({
    generation: 7, workerId: 'portfolio-worker:7', journal, outbox, capacity,
    route: { resolve: async input => ({
      projectId: input.projectId, routeRef: `workroom:${input.projectId}`, routeDigest: sha('7'),
      authorityRef: 'catalog:1', authorityDigest: sha('8'),
    }) },
    delivery,
    acknowledgements: { authenticate: async () => true },
  });
}

function acknowledgement(item: PortfolioControlOutboxItem): PortfolioControlAck {
  const common = {
    version: 1 as const, ackId: `ack:${item.itemId}`, portfolioId: item.portfolioId,
    projectId: item.projectId, itemId: item.itemId, grantId: item.payload.grant.grantId,
    grantFence: item.payload.grant.fence, deliveryFence: item.deliveryFence,
    assignmentRef: 'assignment:victim', assignmentAttempt: 1, assignmentFence: 11,
    producer: { principalId: `kernel:${item.projectId}`, authorityRef: 'kernel-authority:1', authorityDigest: sha('9') },
    observedAt: 0,
  };
  if (item.payload.kind === 'grant_offer') {
    const body = { ...common, kind: 'grant_accepted' as const, requestId: item.payload.grant.requestId };
    return { ...body, digest: digest(body) };
  }
  const body = { ...common, kind: 'reclaim_acknowledged' as const,
    reclaimId: item.payload.reclaim.reclaimId, outcome: 'checkpointed' as const,
    checkpoint: { ref: 'checkpoint:victim:1', digest: sha('a') } };
  return { ...body, digest: digest(body) };
}

function capacityRuntime(journal: InMemoryPortfolioJournalRepository, clockNow?: number) {
  const snapshot = policy();
  return new GenerationOwnedPortfolioCapacityRuntime({
    generation: 7, repository: journal,
    policyAuthority: { resolve: async () => ({ policy: snapshot, governance: governance(snapshot.digest) }) },
    bundleAuthority: { validate: async input => validated(input.capacityRequest) },
    kernelAuthority: { authorize: async input => kernelAuthority(input) },
    usageAuthority: { authenticate: async () => undefined },
    clockAuthority: { read: async input => clockNow === undefined ? undefined : clock(input.portfolioId, clockNow) },
  });
}

function clock(portfolioId: string, now: number) {
  const claims = { portfolioId, now };
  return { ...claims, clockDigest: portfolioClockDigest(claims), authorizedBy: 'portfolio-clock:1' };
}

function kernelAuthority(input: Readonly<{
  portfolioId: string; action: 'consume' | 'reclaim_acknowledge';
  grant: { projectId: string; requestId: string; grantId: string; fence: number };
  assignmentRef: string; reclaimId?: string; outcome?: 'checkpointed' | 'declined'; checkpointRef?: string;
  checkpointDigest?: string;
}>): PortfolioKernelCommandAuthority {
  const claims = {
    portfolioId: input.portfolioId, action: input.action, projectId: input.grant.projectId,
    requestId: input.grant.requestId, grantId: input.grant.grantId, fence: input.grant.fence,
    assignmentRef: input.assignmentRef,
    ...(input.reclaimId ? { reclaimId: input.reclaimId } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.checkpointRef ? { checkpointRef: input.checkpointRef } : {}),
    ...(input.checkpointDigest ? { checkpointDigest: input.checkpointDigest } : {}),
  };
  return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'kernel-authority:1' };
}

function policy() {
  return createPortfolioPolicySnapshot({
    revision: 1, globalBudgetMicros: 1_000, offerTtlTicks: 2, leaseTtlTicks: 5, reclaimTtlTicks: 2,
    leaseHeartbeatTicks: 1, maxLeaseQuantumTicks: 7, maxLeaseRenewals: 2,
    pools: { model: { poolId: 'model', capacityUnits: 1, rateUnitsPerWindow: 100,
      rateWindowTicks: 10, priceMicrosPerBudgetUnit: 10 } },
    projects: { 'project-a': project('project-a', 'normal'), 'project-b': project('project-b', 'urgent') },
  });
}
function project(projectId: string, lane: 'urgent' | 'normal'): PortfolioProjectPolicy {
  return { projectId, revision: 1, lane, weight: 1, hardBudgetMicros: 100,
    allowedPools: ['model'], maxOutstandingRequests: 4, maxConcurrentGrants: 1,
    burstLimit: 2, starvationTicks: 3, status: 'active' };
}
function request(id: string, projectId: string, preemptibility: 'checkpointable' | 'atomic'): PortfolioCapacityRequest {
  return { requestId: id, projectId, workRef: { runId: `run:${projectId}`,
    profileRevisionId: 'profile:1', profileDigest: sha('1') }, schedulerRevision: 'scheduler:1',
    schedulerSequence: 1, localOrder: 1, projectPolicyRevision: 1, opaqueHeadId: `head:${id}`,
    payloadDigest: sha('2'), resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 1,
      rateUnits: 1, budgetUnits: 5 }] }, preemptibility, starvationAt: 1 };
}
function schedulerInput(capacityRequest: PortfolioCapacityRequest) {
  return { generation: 7, portfolioId: 'portfolio-main', tenantId: 'tenant-main',
    catalogRevision: 1, catalogDigest: sha('3'), capacityRequest };
}
function validated(value: PortfolioCapacityRequest): ValidatedAtomicResourceBundle {
  return { requestId: value.requestId, projectId: value.projectId, workRef: value.workRef,
    catalogRef: { generationId: 'catalog-generation:7', revision: 1, digest: sha('3') },
    profileAuthorityRef: { tenantId: 'tenant-main', projectId: value.projectId,
      profileRevisionId: value.workRef.profileRevisionId, profileDigest: value.workRef.profileDigest,
      resourceCeilingDigest: sha('4') }, region: 'local', trustDomain: 'trusted',
    compatibilityGroup: 'default', model: { poolId: 'model', providerId: 'provider:1',
      modelTier: 'standard', capacityUnits: 1, rateUnits: 1, worstCaseUsageUnits: 5,
      worstCaseCostMicros: 50 }, rateReservations: [{ poolId: 'model', units: 1 }],
    totalWorstCaseCostMicros: 50 };
}
function bundleAuthority(value: PortfolioCapacityRequest) {
  const claims = { requestDigest: portfolioCapacityRequestDigest(value),
    resourceBundleDigest: digest(parsePortfolioResourceBundle(value.resourceBundle)),
    catalogGenerationId: 'catalog-generation:7', catalogRevision: 1, catalogDigest: sha('3'),
    profileRevisionId: value.workRef.profileRevisionId, profileDigest: value.workRef.profileDigest,
    profileCeilingDigest: sha('4'), reservedCostMicros: 50 };
  return { ...claims, validatedBundleDigest: portfolioValidatedBundleDigest(claims) };
}
function governance(targetDigest: string): PortfolioGovernanceProof {
  return { principalId: 'sponsor:main', authorizedBy: 'portfolio-authority:1', reasonDigest: sha('5'),
    targetDigest, expectedRevision: 0 };
}
function signal(): AbortSignal { return new AbortController().signal; }
function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
