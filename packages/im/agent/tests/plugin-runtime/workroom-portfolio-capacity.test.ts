import {
  GenerationOwnedPortfolioCapacityRuntime,
  type PortfolioKernelCommandAuthorityPort,
  type WorkroomSchedulerCapacityRequest,
} from '../../src/plugin-runtime/workroom-portfolio-capacity.js';
import {
  InMemoryPortfolioJournalRepository,
  createPortfolioPolicySnapshot,
  type PortfolioCapacityRequest,
  type PortfolioGovernanceProof,
  type PortfolioClockAuthority,
  type PortfolioProjectPolicy,
} from '../../src/portfolio/portfolio-journal.js';
import {
  portfolioClockDigest,
  portfolioKernelCommandDigest,
  portfolioProjectBudget,
  replayPortfolioAdmission,
} from '../../src/portfolio/portfolio-admission.js';
import type { ValidatedAtomicResourceBundle } from '../../src/portfolio/resource-bundle.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('GenerationOwnedPortfolioCapacityRuntime', () => {
  it('fails closed on a stale generation or unavailable Policy/Catalog authority', async () => {
    const schedulerRequest = input();
    const runtime = createRuntime({ policy: undefined, bundle: undefined });
    await expect(runtime.request({ ...schedulerRequest, generation: 8 })).rejects.toThrow(/generation/u);
    await expect(runtime.request(schedulerRequest)).rejects.toThrow(/Policy authority is unavailable/u);

    const withoutBundle = createRuntime({ policy: policyAuthority(), bundle: undefined });
    await expect(withoutBundle.request(schedulerRequest)).rejects.toThrow(/Bundle authority is unavailable/u);
  });

  it('persists an exact generation/Profile/Catalog-bound atomic Grant across runtime restart', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const schedulerRequest = input();
    const runtime = createRuntime({ repository, policy: policyAuthority(), bundle: validated(schedulerRequest) });
    const grant = await runtime.request(schedulerRequest);
    expect(grant).toMatchObject({
      requestId: schedulerRequest.capacityRequest.requestId,
      catalogGenerationId: 'catalog-generation:7',
      catalogRevision: schedulerRequest.catalogRevision,
      profileRevisionId: schedulerRequest.capacityRequest.workRef.profileRevisionId,
      reservedCostMicros: 50,
      status: 'offered',
    });

    const restarted = createRuntime({ repository, policy: policyAuthority(), bundle: validated(schedulerRequest) });
    expect(await restarted.request(schedulerRequest)).toBeNull();
    expect((await repository.read('portfolio-main')).map(fact => fact.type)).toEqual([
      'portfolio.policy_pinned', 'capacity.requested', 'capacity.grant_offered',
    ]);
  });

  it('rejects a validated bundle that drifted from the exact scheduler request', async () => {
    const schedulerRequest = input();
    const drifted = validated(schedulerRequest);
    await expect(createRuntime({
      policy: policyAuthority(),
      bundle: { ...drifted, catalogRef: { ...drifted.catalogRef, revision: 3 } },
    }).request(schedulerRequest)).rejects.toThrow(/escaped its exact/u);
  });

  it('requests exact Kernel renewal authority from the current clock/policy/usage cursor', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const schedulerRequest = input();
    const authorized: Parameters<PortfolioKernelCommandAuthorityPort['authorize']>[0][] = [];
    const runtime = createRuntime({
      repository, policy: policyAuthority(), bundle: validated(schedulerRequest),
      kernel: { authorize: async value => {
        authorized.push(value);
        const claims = {
          portfolioId: value.portfolioId, action: value.action, projectId: value.grant.projectId,
          requestId: value.grant.requestId, grantId: value.grant.grantId, fence: value.grant.fence,
          assignmentRef: value.assignmentRef,
          ...(value.heartbeatSequence === undefined ? {} : { heartbeatSequence: value.heartbeatSequence }),
          ...(value.clockSequence === undefined ? {} : { clockSequence: value.clockSequence }),
          ...(value.clockDigest === undefined ? {} : { clockDigest: value.clockDigest }),
          ...(value.policyDigest === undefined ? {} : { policyDigest: value.policyDigest }),
          ...(value.usageSettlementCursor === undefined
            ? {}
            : { usageSettlementCursor: value.usageSettlementCursor }),
        };
        return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'kernel:1' };
      } },
      clock: portfolioClock('portfolio-main', 1),
    });
    const grant = (await runtime.request(schedulerRequest))!;
    await runtime.consume({ generation: 7, portfolioId: 'portfolio-main', grantId: grant.grantId,
      projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:1' });
    await runtime.advanceClock('portfolio-main');
    await runtime.renewLease({ generation: 7, portfolioId: 'portfolio-main', grantId: grant.grantId,
      projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:1', heartbeatSequence: 1 });

    expect(authorized.at(-1)).toMatchObject({
      action: 'renew', heartbeatSequence: 1, clockSequence: 4,
      policyDigest: policyAuthority().policy.digest, usageSettlementCursor: -1,
    });
    expect(replayPortfolioAdmission('portfolio-main', await repository.read('portfolio-main'))
      .grants[grant.grantId]).toMatchObject({ leaseExpiresAt: 6, renewalCount: 1 });
  });

  it('releases a consumed reservation only after exact Kernel stale/terminal proof', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const schedulerRequest = input();
    const runtime = createRuntime({
      repository, policy: policyAuthority(), bundle: validated(schedulerRequest),
      kernel: { authorize: async value => {
        const claims = kernelClaims(value);
        return { ...claims, commandDigest: portfolioKernelCommandDigest(claims), authorizedBy: 'kernel:1' };
      } },
    });
    const grant = (await runtime.request(schedulerRequest))!;
    await runtime.consume({ generation: 7, portfolioId: 'portfolio-main', grantId: grant.grantId,
      projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:stale' });
    await runtime.failAssignment({
      generation: 7, portfolioId: 'portfolio-main', grantId: grant.grantId,
      projectId: grant.projectId, fence: grant.fence, assignmentRef: 'assignment:stale',
      reason: 'task_stale', kernelSequence: 17, kernelFactDigest: SHA,
    });

    const facts = await repository.read('portfolio-main');
    expect(facts.at(-1)).toMatchObject({ type: 'capacity.grant_assignment_failed' });
    const state = replayPortfolioAdmission('portfolio-main', facts);
    expect(state.grants[grant.grantId]?.status).toBe('assignment_failed');
    expect(portfolioProjectBudget(state, grant.projectId)).toMatchObject({
      reservedMicros: 0, availableMicros: 100,
    });
  });
});

function kernelClaims(value: Parameters<PortfolioKernelCommandAuthorityPort['authorize']>[0]) {
  return {
    portfolioId: value.portfolioId, action: value.action, projectId: value.grant.projectId,
    requestId: value.grant.requestId, grantId: value.grant.grantId, fence: value.grant.fence,
    assignmentRef: value.assignmentRef,
    ...(value.reclaimId === undefined ? {} : { reclaimId: value.reclaimId }),
    ...(value.outcome === undefined ? {} : { outcome: value.outcome }),
    ...(value.checkpointRef === undefined ? {} : { checkpointRef: value.checkpointRef }),
    ...(value.checkpointDigest === undefined ? {} : { checkpointDigest: value.checkpointDigest }),
    ...(value.heartbeatSequence === undefined ? {} : { heartbeatSequence: value.heartbeatSequence }),
    ...(value.clockSequence === undefined ? {} : { clockSequence: value.clockSequence }),
    ...(value.clockDigest === undefined ? {} : { clockDigest: value.clockDigest }),
    ...(value.policyDigest === undefined ? {} : { policyDigest: value.policyDigest }),
    ...(value.usageSettlementCursor === undefined ? {} : { usageSettlementCursor: value.usageSettlementCursor }),
    ...(value.failureReason === undefined ? {} : { failureReason: value.failureReason }),
    ...(value.kernelSequence === undefined ? {} : { kernelSequence: value.kernelSequence }),
    ...(value.kernelFactDigest === undefined ? {} : { kernelFactDigest: value.kernelFactDigest }),
  };
}

function createRuntime(options: Readonly<{
  repository?: InMemoryPortfolioJournalRepository;
  policy: ReturnType<typeof policyAuthority> | undefined;
  bundle: ValidatedAtomicResourceBundle | undefined;
  kernel?: PortfolioKernelCommandAuthorityPort;
  clock?: PortfolioClockAuthority;
}>) {
  return new GenerationOwnedPortfolioCapacityRuntime({
    generation: 7,
    repository: options.repository ?? new InMemoryPortfolioJournalRepository(),
    policyAuthority: { resolve: async () => options.policy },
    bundleAuthority: { validate: async () => options.bundle },
    kernelAuthority: options.kernel ?? { authorize: async () => undefined },
    usageAuthority: { authenticate: async () => undefined },
    clockAuthority: { read: async () => options.clock },
  });
}

function portfolioClock(portfolioId: string, now: number): PortfolioClockAuthority {
  const claims = { portfolioId, now };
  return { ...claims, clockDigest: portfolioClockDigest(claims), authorizedBy: 'portfolio-clock:1' };
}

function policyAuthority() {
  const policy = createPortfolioPolicySnapshot({
    revision: 1, globalBudgetMicros: 1_000, offerTtlTicks: 2, leaseTtlTicks: 5,
    leaseHeartbeatTicks: 1, maxLeaseQuantumTicks: 7, maxLeaseRenewals: 2,
    reclaimTtlTicks: 2,
    pools: {
      model: { poolId: 'model', capacityUnits: 1, rateUnitsPerWindow: 10, rateWindowTicks: 10, priceMicrosPerBudgetUnit: 10 },
      executor: { poolId: 'executor', capacityUnits: 1, rateUnitsPerWindow: 10, rateWindowTicks: 10, priceMicrosPerBudgetUnit: 0 },
    },
    projects: { 'project-a': projectPolicy() },
  });
  return { policy, governance: governance(policy.digest) };
}

function governance(targetDigest: string): PortfolioGovernanceProof {
  return {
    principalId: 'sponsor:main', authorizedBy: 'portfolio-authority:1', reasonDigest: SHA,
    targetDigest, expectedRevision: 0,
  };
}

function projectPolicy(): PortfolioProjectPolicy {
  return {
    projectId: 'project-a', revision: 1, lane: 'normal', weight: 1, hardBudgetMicros: 100,
    allowedPools: ['executor', 'model'], maxOutstandingRequests: 2, maxConcurrentGrants: 1,
    burstLimit: 1, starvationTicks: 3, status: 'active',
  };
}

function input(): WorkroomSchedulerCapacityRequest {
  return {
    generation: 7, portfolioId: 'portfolio-main', tenantId: 'tenant-main',
    catalogRevision: 2, catalogDigest: SHA, capacityRequest: capacityRequest(),
  };
}

function capacityRequest(): PortfolioCapacityRequest {
  return {
    requestId: 'request-1', projectId: 'project-a',
    workRef: { runId: 'run-1', profileRevisionId: 'profile:1', profileDigest: SHA },
    schedulerRevision: 'scheduler:1', schedulerSequence: 1, localOrder: 1,
    projectPolicyRevision: 1, opaqueHeadId: 'head:1', payloadDigest: SHA,
    resourceBundle: { demands: [
      { poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 5 },
      { poolId: 'executor', capacityUnits: 1, rateUnits: 1, budgetUnits: 0 },
    ] },
    preemptibility: 'checkpointable', starvationAt: 3,
  };
}

function validated(value: WorkroomSchedulerCapacityRequest): ValidatedAtomicResourceBundle {
  return {
    requestId: value.capacityRequest.requestId,
    projectId: value.capacityRequest.projectId,
    workRef: value.capacityRequest.workRef,
    catalogRef: { generationId: 'catalog-generation:7', revision: value.catalogRevision, digest: value.catalogDigest },
    profileAuthorityRef: {
      tenantId: value.tenantId, projectId: value.capacityRequest.projectId,
      profileRevisionId: value.capacityRequest.workRef.profileRevisionId,
      profileDigest: value.capacityRequest.workRef.profileDigest, resourceCeilingDigest: SHA,
    },
    region: 'local', trustDomain: 'trusted', compatibilityGroup: 'default',
    model: {
      poolId: 'model', providerId: 'provider:1', modelTier: 'standard', capacityUnits: 1,
      rateUnits: 1, worstCaseUsageUnits: 5, worstCaseCostMicros: 50,
    },
    executor: {
      poolId: 'executor', executorPoolId: 'executor:1', sandboxId: 'sandbox:1',
      workspaceProviderId: 'workspace:1', capacityUnits: 1, rateUnits: 1,
      worstCaseUsageUnits: 0, worstCaseCostMicros: 0,
    },
    rateReservations: [{ poolId: 'executor', units: 1 }, { poolId: 'model', units: 1 }],
    totalWorstCaseCostMicros: 50,
  };
}
