import { rootPluginId, Scope } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  installWorkroomSchedulerPortfolioDispatchResources,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-composition.js';
import {
  workroomSchedulerAssignmentRouteRegistryToken,
} from '../../src/plugin-runtime/workroom-scheduler-route-registry.js';
import {
  workroomSchedulerPortfolioRequestAuthorityToken,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-supply.js';
import {
  workroomSchedulerCapacityRequestToken,
} from '../../src/plugin-runtime/workroom-portfolio-capacity.js';
import {
  workroomSchedulerDispatchSupplyToken,
} from '../../src/plugin-runtime/workroom-scheduler-runtime.js';
import {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-contract.js';
import { createWorkroomSchedulerPolicySnapshot, decideWorkroomSchedule } from '../../src/workroom/workroom-scheduler.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';

describe('standard Portfolio-first Workroom Scheduler composition', () => {
  it('installs one generation route registry and keeps missing request authority durably fail closed', async () => {
    const resources = new Scope(rootPluginId());
    const controller = new AbortController();
    const catalog = catalogSnapshot();
    const installed = installWorkroomSchedulerPortfolioDispatchResources({
      generation: 7, signal: controller.signal, resources,
      catalog: { read: async () => catalog }, profiles: pinnedProfiles(), runState: readyRunState(),
    });
    expect(resources.use(workroomSchedulerAssignmentRouteRegistryToken)).toBe(installed.routes);
    expect(resources.use(workroomSchedulerDispatchSupplyToken)).toBe(installed.supply);
    expect(installWorkroomSchedulerPortfolioDispatchResources({
      generation: 7, signal: controller.signal, resources,
      catalog: { read: async () => catalog }, profiles: pinnedProfiles(), runState: readyRunState(),
    })).toEqual(installed);
    installed.routes.register({
      providerId: 'local', generation: 7,
      resolve: async () => ({
        kind: 'local', agentDefinitionId: 'developer', authorityRef: 'local:7',
      }),
    });
    await expect(installed.supply.probe(decision())).resolves.toBe(false);
  });

  it('resolves dynamically provided trusted request/capacity ports without direct Assignment issuance', async () => {
    const resources = new Scope(rootPluginId());
    const selected = decision();
    const route = { kind: 'local' as const, agentDefinitionId: 'developer', authorityRef: 'local:7' };
    const catalog = catalogSnapshot();
    const installed = installWorkroomSchedulerPortfolioDispatchResources({
      generation: 7, signal: new AbortController().signal, resources,
      catalog: { read: async () => catalog }, profiles: pinnedProfiles(), runState: readyRunState(),
    });
    installed.routes.register({ providerId: 'local', generation: 7, resolve: async () => route });
    const request = {
      generation: 7, portfolioId: 'portfolio-main', tenantId: 'tenant-main',
      catalogRevision: 1, catalogDigest: sha('c'), capacityRequest: {
        requestId: workroomSchedulerPortfolioRequestId(selected, route), projectId: selected.projectId,
        workRef: { runId: selected.runId, profileRevisionId: 'profile-1', profileDigest: sha('a') },
        schedulerRevision: selected.policy.digest, schedulerSequence: selected.expectedSequence + 1,
        localOrder: selected.expectedSequence + 1, projectPolicyRevision: 1,
        opaqueHeadId: workroomSchedulerPortfolioOpaqueHeadId(selected),
        payloadDigest: workroomSchedulerPortfolioPayloadDigest(selected, route),
        resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 1 }] },
        preemptibility: 'atomic' as const, starvationAt: 4,
      },
    };
    const requestCapacity = vi.fn(async () => null);
    resources.provide(workroomSchedulerPortfolioRequestAuthorityToken, {
      resolve: async () => request,
    });
    resources.provide(workroomSchedulerCapacityRequestToken, { request: requestCapacity });

    await expect(installed.supply.probe(selected)).resolves.toBe(true);
    await expect(installed.supply.deliver(selected)).resolves.toBeUndefined();
    expect(requestCapacity).toHaveBeenCalledExactlyOnceWith(request);
  });

  it('installs the pinned Profile Request authority when the Kernel Journal seam is present', () => {
    const resources = new Scope(rootPluginId());
    const selected = decision();
    installWorkroomSchedulerPortfolioDispatchResources({
      generation: 7,
      signal: new AbortController().signal,
      resources,
      catalog: { read: async () => catalogSnapshot() },
      profiles: pinnedProfiles(),
      runState: readyRunState(),
      journal: { read: async () => [
        ...readyJournal(),
        event(3, 'scheduler.dispatch_requested', selected),
      ] },
    });

    expect(resources.has(workroomSchedulerPortfolioRequestAuthorityToken)).toBe(true);
  });
});

function pinnedProfiles() {
  return { read: async () => ({
    projectId: 'project-1', registryRevision: 1,
    runPins: { 'run-1': { projectId: 'project-1', runId: 'run-1', profileRevisionId: 'profile-1',
      profileDigest: sha('a'), activationRegistryRevision: 1, pinnedAtRegistryRevision: 1 } },
    revisions: { 'profile-1': { id: 'profile-1', projectId: 'project-1', compiledDigest: sha('a'),
      compiledProfile: { revisionId: 'profile-1', projectId: 'project-1', digest: sha('a'), agents: [
        { id: 'developer', digest: sha('b'), role: 'executor', allowedTools: [], allowedSkills: [] },
      ] } } },
  }) as never };
}

function catalogSnapshot() {
  return { revision: sha('d'), definitions: { 'project-1': {
    enabled: true, members: [{ role: 'executor', agent: 'developer' }],
  } } } as never;
}

function readyRunState() {
  const state = { tasks: { build: {
    revision: 1, status: 'ready', acceptanceContract: { id: 'acceptance:build' },
  } } } as never;
  return {
    read: async () => state,
    pinTaskAcceptance: async () => state,
  };
}

function decision() { return decideWorkroomSchedule(readyJournal())!; }

function readyJournal(): readonly WorkroomEvent[] {
  const policy = createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler://1', revision: 1, pinnedAtSequence: 1, capacity: 1,
    agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
    preemptionDeadlineMs: 50,
  });
  return [
    event(0, 'run.created', { projectId: 'project-1', title: 'Run' }),
    event(1, 'plan.admitted', { schedulerPolicy: policy }),
    event(2, 'task.planned', { taskKey: 'build', title: 'Build', role: 'executor', required: true,
      maxAttempts: 1, sponsorLane: 'normal', localRank: 0, deadline: 1_000, enqueuedAt: 0,
      dependsOn: [], preemptibility: 'atomic' }),
  ];
}

function event(sequence: number, type: WorkroomEvent['type'], payload: Record<string, unknown>): WorkroomEvent {
  return Object.freeze({ version: 1, eventId: `event-${sequence}`, runId: 'run-1', sequence,
    occurredAt: sequence, type, payload: Object.freeze(payload) });
}

function sha(value: string): string { return `sha256:${value.repeat(64).slice(0, 64)}`; }
