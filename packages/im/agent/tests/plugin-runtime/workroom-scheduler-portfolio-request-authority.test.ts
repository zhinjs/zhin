import { describe, expect, it } from 'vitest';
import {
  PinnedProfileWorkroomSchedulerPortfolioRequestAuthority,
  workroomSchedulerPortfolioScopeBindingDigest,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-request-authority.js';
import {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-contract.js';
import { createPortfolioPolicySnapshot } from '../../src/portfolio/portfolio-journal.js';
import {
  createWorkroomSchedulerPolicySnapshot,
  decideWorkroomSchedule,
} from '../../src/workroom/workroom-scheduler.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';

describe('pinned Profile Workroom Scheduler Portfolio Request authority', () => {
  it('constructs one content-free request from exact Kernel, Profile, Portfolio, and Catalog facts', async () => {
    const decision = decideWorkroomSchedule(readyJournal())!;
    const route = {
      kind: 'local' as const,
      agentDefinitionId: 'developer',
      authorityRef: 'local:generation:7:developer',
    };
    const scopeBody = {
      version: 1 as const,
      generation: 7,
      projectId: 'project-1',
      workroomCatalogRevision: sha('b'),
      profileRevisionId: 'profile-1',
      profileDigest: sha('a'),
      portfolioId: 'portfolio-main',
      tenantId: 'tenant-main',
      portfolioPolicyRevision: portfolioPolicy().revision,
      portfolioPolicyDigest: portfolioPolicy().digest,
      portfolioClockAnchor: 37,
      portfolioClockDigest: sha('f'),
      resourceCatalogGenerationId: 'resource-catalog:generation:7',
      resourceCatalogRevision: 3,
      resourceCatalogDigest: sha('c'),
    };
    const authority = new PinnedProfileWorkroomSchedulerPortfolioRequestAuthority({
      generation: 7,
      journal: { read: async () => withDispatch(decision) },
      profiles: { read: async () => pinnedProfile() },
      scopes: { resolve: async () => ({
        ...scopeBody,
        bindingDigest: workroomSchedulerPortfolioScopeBindingDigest(scopeBody),
      }) },
      policies: { resolve: async () => ({ policy: portfolioPolicy(), governance: {
        principalId: 'sponsor-1', authorizedBy: 'catalog:sponsor-1', reasonDigest: sha('d'),
        targetDigest: sha('e'), expectedRevision: 0,
      } }) },
      bundles: { validate: async input => validatedBundle(input) },
    });

    const result = await authority.resolve({
      generation: 7,
      decision,
      route,
      catalog: workroomCatalog(),
    });

    expect(result).toEqual({
      generation: 7,
      portfolioId: 'portfolio-main',
      tenantId: 'tenant-main',
      catalogRevision: 3,
      catalogDigest: sha('c'),
      capacityRequest: {
        requestId: workroomSchedulerPortfolioRequestId(decision, route),
        projectId: 'project-1',
        workRef: { runId: 'run-1', profileRevisionId: 'profile-1', profileDigest: sha('a') },
        schedulerRevision: decision.policy.digest,
        schedulerSequence: 3,
        localOrder: 3,
        projectPolicyRevision: 2,
        opaqueHeadId: workroomSchedulerPortfolioOpaqueHeadId(decision),
        payloadDigest: workroomSchedulerPortfolioPayloadDigest(decision, route),
        resourceBundle: { demands: [
          { poolId: 'executor-main', capacityUnits: 1, rateUnits: 1, budgetUnits: 0 },
          { poolId: 'model-main', capacityUnits: 1, rateUnits: 2, budgetUnits: 50 },
        ] },
        preemptibility: 'atomic',
        starvationAt: 47,
      },
    });
    expect(JSON.stringify(result)).not.toContain('Build secret release');
    await expect(authority.resolve({
      generation: 7,
      decision,
      route,
      catalog: workroomCatalog(),
    })).resolves.toEqual(result);
  });

  it('fails closed when the pinned Profile has no exact resource requirement for the Task', async () => {
    const decision = decideWorkroomSchedule(readyJournal())!;
    const bundles = { validate: async () => { throw new Error('must not validate'); } };
    const authority = new PinnedProfileWorkroomSchedulerPortfolioRequestAuthority({
      ...validOptions(decision),
      profiles: { read: async () => pinnedProfile(false) },
      bundles,
    });

    await expect(authority.resolve({
      generation: 7,
      decision,
      route: localRoute(),
      catalog: workroomCatalog(),
    })).resolves.toBeUndefined();
  });

  it('rejects a stale Kernel Task revision even when the old dispatch fact still exists', async () => {
    const decision = decideWorkroomSchedule(readyJournal())!;
    const authority = new PinnedProfileWorkroomSchedulerPortfolioRequestAuthority({
      ...validOptions(decision),
      journal: { read: async () => [
        ...withDispatch(decision),
        event(4, 'task.revised', { taskKey: 'build' }),
      ] },
    });

    await expect(authority.resolve({
      generation: 7,
      decision,
      route: localRoute(),
      catalog: workroomCatalog(),
    })).resolves.toBeUndefined();
  });

  it('rejects Catalog bundle validation that changes a Profile-pinned quantity', async () => {
    const decision = decideWorkroomSchedule(readyJournal())!;
    const authority = new PinnedProfileWorkroomSchedulerPortfolioRequestAuthority({
      ...validOptions(decision),
      bundles: { validate: async input => ({
        ...validatedBundle(input),
        model: { ...validatedBundle(input).model, rateUnits: 3 },
      }) },
    });

    await expect(authority.resolve({
      generation: 7,
      decision,
      route: localRoute(),
      catalog: workroomCatalog(),
    })).rejects.toThrow('exactly echo');
  });
});

function pinnedProfile(withResources = true) {
  return {
    projectId: 'project-1',
    registryRevision: 4,
    active: { revisionId: 'profile-1', compiledDigest: sha('a'), activatedAtRegistryRevision: 3 },
    runPins: { 'run-1': {
      projectId: 'project-1', runId: 'run-1', profileRevisionId: 'profile-1',
      profileDigest: sha('a'), activationRegistryRevision: 3, pinnedAtRegistryRevision: 4,
    } },
    revisions: { 'profile-1': {
      revisionId: 'profile-1', projectId: 'project-1', compiledDigest: sha('a'),
      compiledProfile: {
        revisionId: 'profile-1', projectId: 'project-1', digest: sha('a'),
        workflows: [{ id: 'build-workflow', digest: sha('9'), tasks: [{
          key: 'build', role: 'executor', requires: { tools: [], skills: [] },
          ...(withResources ? { resourceRequirements: { demands: [
              { poolId: 'model-main', capacityUnits: 1, rateUnits: 2, budgetUnits: 50 },
              { poolId: 'executor-main', capacityUnits: 1, rateUnits: 1, budgetUnits: 0 },
            ] } } : {}),
        }] }],
      },
    } },
  } as never;
}

function validOptions(decision: NonNullable<ReturnType<typeof decideWorkroomSchedule>>) {
  const scope = {
    version: 1 as const, generation: 7, projectId: 'project-1',
    workroomCatalogRevision: sha('b'), profileRevisionId: 'profile-1', profileDigest: sha('a'),
    portfolioId: 'portfolio-main', tenantId: 'tenant-main',
    portfolioPolicyRevision: portfolioPolicy().revision,
    portfolioPolicyDigest: portfolioPolicy().digest,
    portfolioClockAnchor: 37,
    portfolioClockDigest: sha('f'),
    resourceCatalogGenerationId: 'resource-catalog:generation:7',
    resourceCatalogRevision: 3, resourceCatalogDigest: sha('c'),
  };
  return {
    generation: 7,
    journal: { read: async () => withDispatch(decision) },
    profiles: { read: async () => pinnedProfile() },
    scopes: { resolve: async () => ({
      ...scope, bindingDigest: workroomSchedulerPortfolioScopeBindingDigest(scope),
    }) },
    policies: { resolve: async () => ({ policy: portfolioPolicy(), governance: {
      principalId: 'sponsor-1', authorizedBy: 'catalog:sponsor-1', reasonDigest: sha('d'),
      targetDigest: sha('e'), expectedRevision: 0,
    } }) },
    bundles: { validate: async (input: Parameters<
      ConstructorParameters<typeof PinnedProfileWorkroomSchedulerPortfolioRequestAuthority>[0]['bundles']['validate']
    >[0]) => validatedBundle(input) },
  };
}

function localRoute() {
  return {
    kind: 'local' as const,
    agentDefinitionId: 'developer',
    authorityRef: 'local:generation:7:developer',
  };
}

function portfolioPolicy() {
  return createPortfolioPolicySnapshot({
    revision: 5,
    globalBudgetMicros: 10_000,
    offerTtlTicks: 5,
    leaseTtlTicks: 10,
    leaseHeartbeatTicks: 2,
    maxLeaseQuantumTicks: 20,
    maxLeaseRenewals: 1,
    reclaimTtlTicks: 5,
    pools: {
      'executor-main': { poolId: 'executor-main', capacityUnits: 2, rateUnitsPerWindow: 10,
        rateWindowTicks: 10, priceMicrosPerBudgetUnit: 0 },
      'model-main': { poolId: 'model-main', capacityUnits: 2, rateUnitsPerWindow: 10,
        rateWindowTicks: 10, priceMicrosPerBudgetUnit: 10 },
    },
    projects: { 'project-1': {
      projectId: 'project-1', revision: 2, lane: 'normal', weight: 1,
      hardBudgetMicros: 1_000, allowedPools: ['executor-main', 'model-main'],
      maxOutstandingRequests: 2, maxConcurrentGrants: 1, burstLimit: 1,
      starvationTicks: 7, status: 'active',
    } },
  });
}

function validatedBundle(input: Parameters<
  ConstructorParameters<typeof PinnedProfileWorkroomSchedulerPortfolioRequestAuthority>[0]['bundles']['validate']
>[0]) {
  return {
    requestId: input.capacityRequest.requestId,
    projectId: input.capacityRequest.projectId,
    workRef: input.capacityRequest.workRef,
    catalogRef: { generationId: 'resource-catalog:generation:7', revision: 3, digest: sha('c') },
    profileAuthorityRef: {
      tenantId: 'tenant-main', projectId: 'project-1', profileRevisionId: 'profile-1',
      profileDigest: sha('a'), resourceCeilingDigest: sha('e'),
    },
    region: 'local', trustDomain: 'trusted', compatibilityGroup: 'default',
    model: { poolId: 'model-main', providerId: 'provider-1', modelTier: 'standard',
      capacityUnits: 1, rateUnits: 2, worstCaseUsageUnits: 50, worstCaseCostMicros: 500 },
    executor: { poolId: 'executor-main', executorPoolId: 'executor-1', sandboxId: 'sandbox-1',
      workspaceProviderId: 'workspace-1', capacityUnits: 1, rateUnits: 1,
      worstCaseUsageUnits: 0, worstCaseCostMicros: 0 },
    rateReservations: [{ poolId: 'executor-main', units: 1 }, { poolId: 'model-main', units: 2 }],
    totalWorstCaseCostMicros: 500,
  };
}

function workroomCatalog() {
  return { revision: sha('b'), definitions: { 'project-1': {
    name: 'Software', enabled: true, members: [{ agent: 'developer', role: 'executor' }],
  } } } as never;
}

function readyJournal(): readonly WorkroomEvent[] {
  const policy = createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler://1', revision: 1, pinnedAtSequence: 1, capacity: 1,
    agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
    preemptionDeadlineMs: 50,
  });
  return [
    event(0, 'run.created', { projectId: 'project-1', title: 'Private run title' }),
    event(1, 'plan.admitted', { schedulerPolicy: policy, plan: admittedPlan(policy) }),
    event(2, 'task.planned', {
      taskKey: 'build', title: 'Build secret release', role: 'executor', required: true, maxAttempts: 1,
      sponsorLane: 'normal', localRank: 0, deadline: 1_000, enqueuedAt: 10,
      dependsOn: [], preemptibility: 'atomic',
    }),
  ];
}

function admittedPlan(policy: ReturnType<typeof createWorkroomSchedulerPolicySnapshot>) {
  return WorkflowPlanBuilder.create({
    proposalId: 'proposal-1',
    projectId: 'project-1',
    strategy: { id: 'build-workflow', version: 'profile-1', digest: sha('9') },
    parameterDigest: sha('1'),
    authority: {
      projectRevision: sha('b'),
      projectDigest: sha('2'),
      profileRevisionId: 'profile-1',
      profileDigest: sha('a'),
      planningPolicyRevisionId: 'planning-policy-1',
      planningPolicyDigest: sha('3'),
      orchestratorAgentDefinitionId: 'orchestrator',
      orchestratorAuthorityDigest: sha('4'),
    },
    budget: { maxTasks: 1, maxTotalAttempts: 1 },
    schedulerPolicy: policy,
  }).addTask({
    key: 'build',
    title: 'Build secret release',
    role: 'executor',
    required: true,
    maxAttempts: 1,
    dependsOn: [],
    requires: {},
    scheduler: {
      sponsorLane: 'normal',
      localRank: 0,
      deadline: 1_000,
      enqueuedAt: 10,
      preemptibility: 'atomic',
    },
  }).build();
}

function withDispatch(decision: NonNullable<ReturnType<typeof decideWorkroomSchedule>>): readonly WorkroomEvent[] {
  return [...readyJournal(), event(3, 'scheduler.dispatch_requested', decision)];
}

function event(sequence: number, type: WorkroomEvent['type'], payload: Record<string, unknown>): WorkroomEvent {
  return Object.freeze({
    version: 1, eventId: `event-${sequence}`, runId: 'run-1', sequence,
    occurredAt: sequence, type, payload: Object.freeze(payload),
  });
}

function sha(value: string): string {
  return `sha256:${value.repeat(64).slice(0, 64)}`;
}
