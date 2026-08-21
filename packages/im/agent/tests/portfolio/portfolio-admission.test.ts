import {
  PortfolioAdmissionApplication,
  portfolioCapacityRequestDigest,
  portfolioClockDigest,
  portfolioKernelCommandDigest,
  portfolioProjectBudget,
  portfolioRequestStatus,
  portfolioUsageReceiptDigest,
  portfolioValidatedBundleDigest,
} from '../../src/portfolio/portfolio-admission.js';
import {
  InMemoryPortfolioJournalRepository,
  createPortfolioPolicySnapshot,
  parsePortfolioFactDraft,
  parsePortfolioResourceBundle,
  type PortfolioCapacityRequest,
  type PortfolioClockAuthority,
  type PortfolioGovernanceProof,
  type PortfolioKernelCommandAuthority,
  type PortfolioProjectPolicy,
  type PortfolioValidatedBundleAuthority,
  type PortfolioUsageGatewayAuthority,
} from '../../src/portfolio/portfolio-journal.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('PortfolioAdmissionApplication', () => {
  it('atomically reserves a bundle, refunds an expired offer, and increments its fence', async () => {
    const application = await createApplication();
    await submit(application, request('request-1', 'project-a', 1));
    const first = await application.decideAdmission();
    expect(first?.resourceBundle.demands.map(item => item.poolId)).toEqual(['executor', 'model']);
    expect(first?.fence).toBe(1);
    expect(portfolioProjectBudget(await application.read(), 'project-a')).toMatchObject({
      reservedMicros: 50,
      availableMicros: 50,
    });

    await application.advanceClock(clock(3));
    expect(portfolioRequestStatus(await application.read(), 'request-1')).toBe('pending');
    expect(portfolioProjectBudget(await application.read(), 'project-a').reservedMicros).toBe(0);
    expect((await application.decideAdmission())?.fence).toBe(2);
  });

  it('keeps lost usage reserved, settles a late overrun honestly, and never reclaims atomic work', async () => {
    const application = await createApplication();
    await submit(application, request('atomic', 'project-a', 1, 'atomic'));
    const atomic = (await application.decideAdmission())!;
    const consume = {
      grantId: atomic.grantId,
      projectId: atomic.projectId,
      fence: atomic.fence,
      assignmentRef: 'assignment:atomic',
    };
    await application.consume(consume, kernelCommand(atomic, 'consume', consume.assignmentRef));
    await submit(application, request('urgent', 'project-b', 1));
    expect(await application.decideAdmission()).toBeNull();
    expect(Object.keys((await application.read()).reclaims)).toHaveLength(0);

    await application.advanceClock(clock(6));
    expect(portfolioRequestStatus(await application.read(), 'atomic')).toBe('usage_blocked');
    expect(portfolioProjectBudget(await application.read(), 'project-a').reservedMicros).toBe(50);
    await application.settleUsage(usageReceipt(atomic, 125));
    expect(portfolioProjectBudget(await application.read(), 'project-a')).toMatchObject({
      spentMicros: 125,
      availableMicros: -25,
    });
  });

  it('rejects stale sponsor authority and validated bundle drift', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const application = new PortfolioAdmissionApplication({
      portfolioId: 'portfolio-main', repository,
      ids: { eventId: (type, identity) => `${type}:${identity}` },
    });
    const snapshot = policy();
    await expect(application.pinPolicy(snapshot, governance(SHA, 0))).rejects.toThrow(/scope\/revision/u);
    await application.pinPolicy(snapshot, governance(snapshot.digest, 0));
    const value = request('drift', 'project-a', 1);
    const authority = bundleAuthority(value);
    await expect(application.submit(value, {
      ...authority, catalogRevision: authority.catalogRevision + 1,
    })).rejects.toThrow(/authority\/request drift/u);
  });

  it('rejects forged terminal Grant and Reclaim facts at the journal boundary', async () => {
    const application = await createApplication();
    await submit(application, request('victim', 'project-a', 1));
    const grant = (await application.decideAdmission())!;
    expect(() => parsePortfolioFactDraft({
      eventId: 'forged:grant', occurredAt: 0, type: 'capacity.grant_offered',
      payload: { grant: { ...grant, status: 'settled' } },
    })).toThrow(/cannot forge/u);
    await application.consume(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:victim' },
      kernelCommand(grant, 'consume', 'assignment:victim'),
    );
    await submit(application, request('candidate', 'project-b', 1));
    expect(await application.decideAdmission()).toBeNull();
    const reclaim = Object.values((await application.read()).reclaims)[0];
    expect(reclaim).toBeDefined();
    expect(() => parsePortfolioFactDraft({
      eventId: 'forged:reclaim', occurredAt: 0, type: 'capacity.reclaim_requested',
      payload: { reclaim: { ...reclaim, status: 'checkpointed' } },
    })).toThrow(/cannot forge/u);
  });

  it('makes a checkpointed Reclaim acknowledgement idempotent only for the exact checkpoint', async () => {
    const application = await createApplication();
    await submit(application, request('victim', 'project-a', 1));
    const grant = (await application.decideAdmission())!;
    await application.consume(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:victim' },
      kernelCommand(grant, 'consume', 'assignment:victim'),
    );
    await submit(application, request('candidate', 'project-b', 1));
    expect(await application.decideAdmission()).toBeNull();
    const reclaim = Object.values((await application.read()).reclaims)[0]!;
    const checkpointRef = 'checkpoint:victim:1';
    const checkpointDigest = SHA;
    const input = {
      reclaimId: reclaim.reclaimId, projectId: grant.projectId, fence: grant.fence,
      outcome: 'checkpointed' as const, checkpointRef, checkpointDigest,
    };
    await application.acknowledgeReclaim(
      input, reclaimCommand(grant, reclaim.reclaimId, checkpointRef, checkpointDigest),
    );
    await application.acknowledgeReclaim(
      input, reclaimCommand(grant, reclaim.reclaimId, checkpointRef, checkpointDigest),
    );
    await expect(application.acknowledgeReclaim(
      { ...input, checkpointRef: 'checkpoint:victim:other' },
      reclaimCommand(grant, reclaim.reclaimId, 'checkpoint:victim:other', checkpointDigest),
    )).rejects.toThrow(/checkpoint/u);
  });

  it('renews a live lease only within its pinned heartbeat, renewal and max-quantum policy', async () => {
    const application = await createApplication();
    await submit(application, request('renewable', 'project-a', 1));
    const grant = (await application.decideAdmission())!;
    await application.consume(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:renewable' },
      kernelCommand(grant, 'consume', 'assignment:renewable'),
    );

    await application.advanceClock(clock(1));
    let state = await application.read();
    await application.renewLease(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence,
        assignmentRef: 'assignment:renewable', heartbeatSequence: 1 },
      renewalCommand(state, grant, 'assignment:renewable', 1),
    );
    state = await application.read();
    expect(state.grants[grant.grantId]).toMatchObject({
      leaseExpiresAt: 6, renewalCount: 1, lastHeartbeatSequence: 1,
    });
    const replaySequence = state.sequence;
    await application.renewLease(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence,
        assignmentRef: 'assignment:renewable', heartbeatSequence: 1 },
      renewalCommand(state, grant, 'assignment:renewable', 1),
    );
    expect((await application.read()).sequence).toBe(replaySequence);

    await application.advanceClock(clock(2));
    state = await application.read();
    await application.renewLease(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence,
        assignmentRef: 'assignment:renewable', heartbeatSequence: 2 },
      renewalCommand(state, grant, 'assignment:renewable', 2),
    );
    expect((await application.read()).grants[grant.grantId]).toMatchObject({
      leaseExpiresAt: 7, renewalCount: 2, lastHeartbeatSequence: 2,
    });

    await application.advanceClock(clock(3));
    state = await application.read();
    await expect(application.renewLease(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence,
        assignmentRef: 'assignment:renewable', heartbeatSequence: 3 },
      renewalCommand(state, grant, 'assignment:renewable', 3),
    )).rejects.toThrow(/renewal|quantum/u);
  });

  it('refuses Lease renewal while a starved Capacity Request reserves the next release', async () => {
    const application = await createApplication();
    await submit(application, request('holder', 'project-a', 1));
    const grant = (await application.decideAdmission())!;
    await application.consume(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:holder' },
      kernelCommand(grant, 'consume', 'assignment:holder'),
    );
    await submit(application, request('starved', 'project-b', 1));
    await application.advanceClock(clock(3));
    const state = await application.read();

    await expect(application.renewLease(
      { grantId: grant.grantId, projectId: grant.projectId, fence: grant.fence,
        assignmentRef: 'assignment:holder', heartbeatSequence: 1 },
      renewalCommand(state, grant, 'assignment:holder', 1),
    )).rejects.toThrow(/starvation/u);
    expect((await application.read()).grants[grant.grantId]?.renewalCount).toBe(0);
  });

  it('normalizes projects without requests and counts a post-normalization Grant for an older request', async () => {
    const application = await createApplication();
    await submit(application, request('older-request', 'project-a', 1));
    await application.normalizeService(2);
    const grant = await application.decideAdmission();
    expect(grant && 'grantId' in grant).toBe(true);
    await application.normalizeService(2);
    const once = (await application.read()).normalizedService['project-a']!;
    expect(once).toBeGreaterThan(0);
    expect((await application.read()).normalizedService['project-b']).toBe(0);
    await application.normalizeService(2);
    expect((await application.read()).normalizedService['project-a']).toBeLessThan(once);
  });
});

async function createApplication() {
  const repository = new InMemoryPortfolioJournalRepository();
  const application = new PortfolioAdmissionApplication({
    portfolioId: 'portfolio-main', repository,
    ids: { eventId: (type, identity) => `${type}:${identity}` },
  });
  const snapshot = policy();
  await application.pinPolicy(snapshot, governance(snapshot.digest, 0));
  return application;
}

function kernelCommand(
  grant: { grantId: string; requestId: string; projectId: string; fence: number },
  action: 'consume' | 'reclaim_acknowledge',
  assignmentRef: string,
): PortfolioKernelCommandAuthority {
  const claims = {
    portfolioId: 'portfolio-main', action, projectId: grant.projectId,
    requestId: grant.requestId, grantId: grant.grantId, fence: grant.fence, assignmentRef,
  } as const;
  return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'workroom-kernel:1' };
}

function reclaimCommand(
  grant: { grantId: string; requestId: string; projectId: string; fence: number },
  reclaimId: string,
  checkpointRef: string,
  checkpointDigest: string,
): PortfolioKernelCommandAuthority {
  const claims = {
    portfolioId: 'portfolio-main', action: 'reclaim_acknowledge' as const,
    projectId: grant.projectId, requestId: grant.requestId, grantId: grant.grantId,
    fence: grant.fence, assignmentRef: 'assignment:victim', reclaimId,
    outcome: 'checkpointed' as const, checkpointRef, checkpointDigest,
  };
  return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'workroom-kernel:1' };
}

function renewalCommand(
  state: Awaited<ReturnType<PortfolioAdmissionApplication['read']>>,
  grant: { grantId: string; requestId: string; projectId: string; fence: number },
  assignmentRef: string,
  heartbeatSequence: number,
): PortfolioKernelCommandAuthority {
  const claims = {
    portfolioId: 'portfolio-main', action: 'renew' as const,
    projectId: grant.projectId, requestId: grant.requestId, grantId: grant.grantId,
    fence: grant.fence, assignmentRef, heartbeatSequence,
    clockSequence: state.clockSequence, clockDigest: state.clockDigest!,
    policyDigest: state.policy!.digest, usageSettlementCursor: state.usageSettlementCursor,
  };
  return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'workroom-kernel:1' };
}

function usageReceipt(
  grant: { grantId: string; requestId: string; fence: number },
  actualCostMicros: number,
): PortfolioUsageGatewayAuthority {
  const claims = {
    portfolioId: 'portfolio-main', receiptId: 'receipt:late', requestId: grant.requestId,
    grantId: grant.grantId, fence: grant.fence, actualCostMicros, settlementRef: 'provider:late',
  };
  return { ...claims, receiptDigest: portfolioUsageReceiptDigest(claims), authenticatedBy: 'usage-gateway:1' };
}

function clock(now: number): PortfolioClockAuthority {
  const claims = { portfolioId: 'portfolio-main', now };
  return { ...claims, clockDigest: portfolioClockDigest(claims), authorizedBy: 'portfolio-clock:1' };
}

async function submit(application: PortfolioAdmissionApplication, value: PortfolioCapacityRequest) {
  await application.submit(value, bundleAuthority(value));
}

function governance(targetDigest: string, expectedRevision: number): PortfolioGovernanceProof {
  return {
    principalId: 'sponsor:portfolio-main',
    authorizedBy: 'portfolio-authority:1',
    reasonDigest: SHA,
    targetDigest,
    expectedRevision,
  };
}

function bundleAuthority(value: PortfolioCapacityRequest): PortfolioValidatedBundleAuthority {
  const claims = {
    requestDigest: portfolioCapacityRequestDigest(value),
    resourceBundleDigest: digestCanonicalWorkroomValue(parsePortfolioResourceBundle(value.resourceBundle)),
    catalogGenerationId: 'generation:1',
    catalogRevision: 1,
    catalogDigest: SHA,
    profileRevisionId: value.workRef.profileRevisionId,
    profileDigest: value.workRef.profileDigest,
    profileCeilingDigest: SHA,
    reservedCostMicros: 50,
  };
  return { ...claims, validatedBundleDigest: portfolioValidatedBundleDigest(claims) };
}

function policy() {
  return createPortfolioPolicySnapshot({
    revision: 1,
    globalBudgetMicros: 1_000,
    offerTtlTicks: 2,
    leaseTtlTicks: 5,
    leaseHeartbeatTicks: 1,
    maxLeaseQuantumTicks: 7,
    maxLeaseRenewals: 2,
    reclaimTtlTicks: 2,
    pools: {
      model: { poolId: 'model', capacityUnits: 1, rateUnitsPerWindow: 100, rateWindowTicks: 10, priceMicrosPerBudgetUnit: 10 },
      executor: { poolId: 'executor', capacityUnits: 1, rateUnitsPerWindow: 100, rateWindowTicks: 10, priceMicrosPerBudgetUnit: 0 },
    },
    projects: {
      'project-a': projectPolicy('project-a', 'normal'),
      'project-b': projectPolicy('project-b', 'urgent'),
    },
  });
}

function projectPolicy(projectId: string, lane: 'urgent' | 'normal'): PortfolioProjectPolicy {
  return {
    projectId, revision: 1, lane, weight: 1, hardBudgetMicros: 100,
    allowedPools: ['executor', 'model'], maxOutstandingRequests: 4,
    maxConcurrentGrants: 1, burstLimit: 2, starvationTicks: 3, status: 'active',
  };
}

function request(
  requestId: string,
  projectId: string,
  schedulerSequence: number,
  preemptibility: 'checkpointable' | 'atomic' = 'checkpointable',
): PortfolioCapacityRequest {
  return {
    requestId, projectId,
    workRef: { runId: `run:${projectId}`, profileRevisionId: 'profile:1', profileDigest: SHA },
    schedulerRevision: 'scheduler:1', schedulerSequence, localOrder: schedulerSequence,
    projectPolicyRevision: 1, opaqueHeadId: `head:${schedulerSequence}`, payloadDigest: SHA,
    resourceBundle: { demands: [
      { poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 5 },
      { poolId: 'executor', capacityUnits: 1, rateUnits: 1, budgetUnits: 0 },
    ] },
    preemptibility,
    starvationAt: 3,
  };
}
