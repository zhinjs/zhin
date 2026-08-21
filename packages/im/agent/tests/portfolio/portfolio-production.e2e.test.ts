import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PortfolioAdmissionApplication,
  portfolioCapacityRequestDigest,
  portfolioClockDigest,
  portfolioKernelCommandDigest,
  portfolioUsageReceiptDigest,
  portfolioValidatedBundleDigest,
  replayPortfolioAdmission,
} from '../../src/portfolio/portfolio-admission.js';
import {
  InMemoryPortfolioJournalRepository,
  createPortfolioPolicySnapshot,
  parsePortfolioCapacityRequest,
  parsePortfolioResourceBundle,
  type PortfolioCapacityGrant,
  type PortfolioCapacityRequest,
  type PortfolioGovernanceProof,
  type PortfolioKernelCommandAuthority,
  type PortfolioProjectPolicy,
} from '../../src/portfolio/portfolio-journal.js';
import {
  WorkroomPortfolioSponsorRuntime,
  type PortfolioSponsorCommandAuthorityPort,
} from '../../src/plugin-runtime/workroom-portfolio-sponsor.js';
import { createPortfolioSponsorProjection } from '../../src/portfolio/sponsor-projection.js';
import {
  createPortfolioControlItem,
  replayPortfolioControlOutbox,
} from '../../src/portfolio/capacity-control-outbox.js';
import { FilePortfolioControlOutboxRepository } from '../../src/portfolio/file-capacity-control-outbox.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Portfolio production multi-Project E2E', () => {
  it('enforces a 2:1 weighted share and lets low work cross sustained urgent traffic at starvation', async () => {
    const weighted = await application(policy({
      alpha: project('alpha', 'normal', 2), beta: project('beta', 'normal', 1),
    }));
    await submit(weighted, request('alpha-1', 'alpha', 1));
    await submit(weighted, request('beta-1', 'beta', 1));
    const first = (await weighted.decideAdmission())!;
    expect(first.projectId).toBe('alpha');
    await consumeAndSettle(weighted, first);
    await submit(weighted, request('alpha-2', 'alpha', 2));
    const second = (await weighted.decideAdmission())!;
    expect(second.projectId).toBe('beta');
    await consumeAndSettle(weighted, second);
    expect((await weighted.decideAdmission())?.projectId).toBe('alpha');

    const starvation = await application(policy({
      urgent: project('urgent', 'urgent', 1), low: project('low', 'low', 1),
    }));
    await submit(starvation, request('low-1', 'low', 1, { starvationAt: 3 }));
    for (let tick = 0; tick < 3; tick += 1) {
      await submit(starvation, request(`urgent-${tick}`, 'urgent', tick + 1, { starvationAt: 100 }));
      const grant = (await starvation.decideAdmission())!;
      expect(grant.projectId).toBe('urgent');
      await consumeAndSettle(starvation, grant);
      await starvation.advanceClock(clock(tick + 1));
    }
    await submit(starvation, request('urgent-3', 'urgent', 4, { starvationAt: 100 }));
    expect((await starvation.decideAdmission())?.projectId).toBe('low');
  });

  it('keeps atomic bundles all-or-none and never reclaims an atomic holder', async () => {
    const app = await application(policy({
      holder: project('holder', 'normal', 1, ['executor']),
      bundle: project('bundle', 'urgent', 1, ['executor', 'model']),
      free: project('free', 'normal', 1, ['model']),
    }, { model: pool('model', 1), executor: pool('executor', 1) }));
    await submit(app, request('holder', 'holder', 1, {
      preemptibility: 'atomic', demands: [demand('executor')],
    }));
    const holder = (await app.decideAdmission())!;
    await app.consume(consumeInput(holder), kernelCommand(holder, 'consume', 'assignment:holder'));
    await submit(app, request('bundle', 'bundle', 1, {
      demands: [demand('model'), demand('executor')],
    }));
    expect(await app.decideAdmission()).toBeNull();
    expect(Object.keys((await app.read()).reclaims)).toHaveLength(0);
    await submit(app, request('free', 'free', 1, { demands: [demand('model')] }));
    expect((await app.decideAdmission())?.projectId).toBe('free');
  });

  it('conserves Sponsor budget transfer, pauses/resumes admission, and keeps discussion non-authoritative', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const snapshot = policy({ alpha: project('alpha', 'normal', 1, ['model'], 100),
      beta: project('beta', 'normal', 1, ['model'], 0) });
    const app = await application(snapshot, repository);
    await submit(app, request('beta-work', 'beta', 1, { budgetUnits: 5 }));
    expect(await app.decideAdmission()).toBeNull();
    const sponsor = new WorkroomPortfolioSponsorRuntime({ generation: 7, repository, authority: sponsorAuthority() });
    await sponsor.execute('portfolio-main', { kind: 'transfer_budget', commandId: 'transfer',
      fromProjectId: 'alpha', toProjectId: 'beta', amountMicros: 50,
      expectedFromRevision: 1, expectedToRevision: 1 }, { principalId: 'sponsor:main' });
    await sponsor.execute('portfolio-main', { kind: 'set_status', commandId: 'pause', projectId: 'beta',
      expectedProjectRevision: 2, status: 'paused' }, { principalId: 'sponsor:main' });
    expect(await app.decideAdmission()).toBeNull();
    await sponsor.execute('portfolio-main', { kind: 'set_status', commandId: 'resume', projectId: 'beta',
      expectedProjectRevision: 3, status: 'active' }, { principalId: 'sponsor:main' });
    expect((await app.decideAdmission())?.projectId).toBe('beta');
    expect(() => parsePortfolioCapacityRequest({ ...request('leak', 'alpha', 2),
      memory: 'PROJECT_B_PRIVATE_MEMORY' })).toThrow('memory');
    expect(JSON.stringify(createPortfolioSponsorProjection(await app.read())))
      .not.toContain('PROJECT_B_PRIVATE_MEMORY');
  });

  it('replays checkpoint/expiry/unknown-late-receipt and durable outbox restart without content leakage', async () => {
    const app = await application(policy({
      normal: project('normal', 'normal', 1), urgent: project('urgent', 'urgent', 1),
    }));
    await submit(app, request('expiring', 'normal', 1));
    const expired = (await app.decideAdmission())!;
    await app.advanceClock(clock(3));
    expect((await app.read()).grants[expired.grantId]?.status).toBe('expired');
    const live = (await app.decideAdmission())!;
    await app.consume(consumeInput(live), kernelCommand(live, 'consume', `assignment:${live.requestId}`));
    await app.advanceClock(clock(8));
    expect((await app.read()).grants[live.grantId]?.status).toBe('usage_unknown');
    await app.settleUsage(usageReceipt(live, 7));
    expect((await app.read()).grants[live.grantId]).toMatchObject({ status: 'settled', actualCostMicros: 7 });

    await submit(app, request('victim', 'normal', 2));
    const victim = (await app.decideAdmission())!;
    await app.consume(consumeInput(victim), kernelCommand(victim, 'consume', 'assignment:victim'));
    await submit(app, request('urgent', 'urgent', 1, { starvationAt: 9 }));
    await app.advanceClock(clock(9));
    expect(await app.decideAdmission()).toBeNull();
    const state = await app.read();
    const reclaim = Object.values(state.reclaims).find(item => item.grantId === victim.grantId)!;
    await app.acknowledgeReclaim({ reclaimId: reclaim.reclaimId, projectId: victim.projectId,
      fence: victim.fence, outcome: 'checkpointed', checkpointRef: 'checkpoint:victim', checkpointDigest: SHA },
    reclaimCommand(victim, reclaim.reclaimId));
    expect((await app.read()).grants[victim.grantId]?.status).toBe('usage_pending');

    const directory = await mkdtemp(join(tmpdir(), 'zhin-portfolio-e2e-outbox-'));
    const fact = (await app.options.repository.read('portfolio-main')).find(item =>
      item.type === 'capacity.grant_offered')!;
    if (fact.type !== 'capacity.grant_offered') throw new Error('expected grant fact');
    const outboxFact = { ...fact, sequence: 0, payload: { grant: { ...fact.payload.grant, issuedSequence: 0 } } };
    const item = createPortfolioControlItem(outboxFact, outboxFact.payload.grant, {
      projectId: outboxFact.payload.grant.projectId, routeRef: 'workroom:normal', routeDigest: SHA,
      authorityRef: 'catalog:1', authorityDigest: SHA,
    });
    const first = new FilePortfolioControlOutboxRepository(directory);
    await first.append('portfolio-main', -1, { type: 'source.scanned', payload: {
      sourceSequence: 0, sourceEventId: outboxFact.eventId,
      sourceEventDigest: digest(outboxFact), item,
    } });
    const restarted = new FilePortfolioControlOutboxRepository(directory);
    expect(replayPortfolioControlOutbox('portfolio-main', await restarted.read('portfolio-main')))
      .toMatchObject({ sourceCursor: 0, items: { [item.itemId]: { status: 'pending' } } });
    await expect(restarted.append('portfolio-main', -1, { type: 'source.scanned', payload: {
      sourceSequence: 0, sourceEventId: outboxFact.eventId, sourceEventDigest: digest(outboxFact), item,
    } })).rejects.toThrow('sequence conflict');
  });
});

async function application(
  snapshot: ReturnType<typeof policy>,
  repository = new InMemoryPortfolioJournalRepository(),
) {
  const app = new PortfolioAdmissionApplication({ portfolioId: 'portfolio-main', repository,
    ids: { eventId: (type, identity) => `${type}:${identity}` } });
  await app.pinPolicy(snapshot, governance(snapshot.digest, 0));
  return app;
}

function policy(
  projects: Record<string, PortfolioProjectPolicy>,
  pools: Record<string, ReturnType<typeof pool>> = { model: pool('model', 1) },
) {
  return createPortfolioPolicySnapshot({ revision: 1, globalBudgetMicros: 10_000,
    offerTtlTicks: 2, leaseTtlTicks: 5, leaseHeartbeatTicks: 1,
    maxLeaseQuantumTicks: 7, maxLeaseRenewals: 2, reclaimTtlTicks: 2, pools, projects });
}

function project(projectId: string, lane: 'urgent' | 'normal' | 'low', weight: number,
  allowedPools = ['model'], hardBudgetMicros = 1_000): PortfolioProjectPolicy {
  return { projectId, revision: 1, lane, weight, hardBudgetMicros, allowedPools,
    maxOutstandingRequests: 20, maxConcurrentGrants: 2, burstLimit: 10,
    starvationTicks: 3, status: 'active' };
}

function pool(poolId: string, capacityUnits: number) {
  return { poolId, capacityUnits, rateUnitsPerWindow: 1_000, rateWindowTicks: 10,
    priceMicrosPerBudgetUnit: 10 };
}

function demand(poolId: string, budgetUnits = 1) {
  return { poolId, capacityUnits: 1, rateUnits: 1, budgetUnits };
}

function request(id: string, projectId: string, localOrder: number, overrides: Readonly<{
  starvationAt?: number; preemptibility?: 'checkpointable' | 'atomic';
  demands?: readonly ReturnType<typeof demand>[]; budgetUnits?: number;
}> = {}): PortfolioCapacityRequest {
  return { requestId: id, projectId, workRef: { runId: `run:${projectId}`, profileRevisionId: 'profile:1', profileDigest: SHA },
    schedulerRevision: 'scheduler:1', schedulerSequence: localOrder, localOrder,
    projectPolicyRevision: 1, opaqueHeadId: `head:${id}`, payloadDigest: SHA,
    resourceBundle: { demands: overrides.demands ?? [demand('model', overrides.budgetUnits)] },
    preemptibility: overrides.preemptibility ?? 'checkpointable', starvationAt: overrides.starvationAt ?? 100 };
}

async function submit(app: PortfolioAdmissionApplication, value: PortfolioCapacityRequest) {
  const state = await app.read();
  const reservedCostMicros = value.resourceBundle.demands.reduce((sum, item) =>
    sum + item.budgetUnits * state.policy!.pools[item.poolId]!.priceMicrosPerBudgetUnit, 0);
  const claims = { requestDigest: portfolioCapacityRequestDigest(value),
    resourceBundleDigest: digest(parsePortfolioResourceBundle(value.resourceBundle)),
    catalogGenerationId: 'catalog:1', catalogRevision: 1, catalogDigest: SHA,
    profileRevisionId: value.workRef.profileRevisionId, profileDigest: value.workRef.profileDigest,
    profileCeilingDigest: SHA, reservedCostMicros };
  await app.submit(value, { ...claims, validatedBundleDigest: portfolioValidatedBundleDigest(claims) });
}

async function consumeAndSettle(app: PortfolioAdmissionApplication, grant: PortfolioCapacityGrant) {
  const assignmentRef = `assignment:${grant.grantId}`;
  await app.consume({ ...consumeInput(grant), assignmentRef }, kernelCommand(grant, 'consume', assignmentRef));
  await app.settleUsage(usageReceipt(grant, grant.reservedCostMicros));
}

function consumeInput(grant: PortfolioCapacityGrant) {
  return { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence,
    assignmentRef: `assignment:${grant.requestId}` };
}

function kernelCommand(grant: PortfolioCapacityGrant, action: 'consume', assignmentRef: string): PortfolioKernelCommandAuthority {
  const claims = { portfolioId: 'portfolio-main', action, projectId: grant.projectId,
    requestId: grant.requestId, grantId: grant.grantId, fence: grant.fence, assignmentRef };
  return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'kernel:1' };
}

function reclaimCommand(grant: PortfolioCapacityGrant, reclaimId: string): PortfolioKernelCommandAuthority {
  const claims = { portfolioId: 'portfolio-main', action: 'reclaim_acknowledge' as const,
    projectId: grant.projectId, requestId: grant.requestId, grantId: grant.grantId, fence: grant.fence,
    assignmentRef: `assignment:${grant.requestId}`, reclaimId, outcome: 'checkpointed' as const,
    checkpointRef: 'checkpoint:victim', checkpointDigest: SHA };
  return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'kernel:1' };
}

function usageReceipt(grant: PortfolioCapacityGrant, actualCostMicros: number) {
  const claims = { portfolioId: 'portfolio-main', receiptId: `receipt:${grant.grantId}`,
    requestId: grant.requestId, grantId: grant.grantId, fence: grant.fence,
    actualCostMicros, settlementRef: `provider:${grant.grantId}` };
  return { ...claims, receiptDigest: portfolioUsageReceiptDigest(claims), authenticatedBy: 'usage:1' };
}

function clock(now: number) {
  const claims = { portfolioId: 'portfolio-main', now };
  return { ...claims, clockDigest: portfolioClockDigest(claims), authorizedBy: 'clock:1' };
}

function governance(targetDigest: string, expectedRevision: number): PortfolioGovernanceProof {
  return { principalId: 'sponsor:main', authorizedBy: 'portfolio-authority:1', reasonDigest: SHA,
    targetDigest, expectedRevision };
}

function sponsorAuthority(): PortfolioSponsorCommandAuthorityPort {
  return { authorize: async input => ({ commandDigest: input.commandDigest,
    sourceSequence: input.sourceSequence, authorizedBy: 'sponsor-authority:1',
    projectProofs: Object.fromEntries(input.projectCandidates.map(candidate => [candidate.projectId,
      governance(digest(candidate), candidate.revision - 1)])) }) };
}
