import { describe, expect, it, vi } from 'vitest';
import {
  PortfolioFirstWorkroomSchedulerDispatchSupply,
  WorkroomSchedulerPortfolioCapacityUnavailableError,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-supply.js';
import {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-contract.js';
import {
  WorkroomSchedulerAssignmentRouteUnavailableError,
  WorkroomSchedulerDurablyBlockedError,
} from '../../src/plugin-runtime/workroom-scheduler-runtime.js';
import { createWorkroomSchedulerPolicySnapshot, decideWorkroomSchedule } from '../../src/workroom/workroom-scheduler.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';
import type { WorkroomSchedulerCapacityRequest } from '../../src/plugin-runtime/workroom-portfolio-capacity.js';

describe('Portfolio-first Workroom Scheduler supply', () => {
  it('submits the exact content-free Capacity Request and never claims an Assignment directly', async () => {
    const selected = decision();
    const route = {
      kind: 'local' as const, agentDefinitionId: 'developer', authorityRef: 'local:7:developer',
    };
    const request = capacityRequest(selected, route);
    const capacity = { request: vi.fn(async () => null) };
    const supply = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: 7,
      catalog: { read: async () => catalog() },
      routes: { resolve: async () => route },
      requests: { resolve: async () => request },
      capacity,
      runState: readyRunState(),
    });

    await expect(supply.deliver(selected)).resolves.toBeUndefined();
    expect(capacity.request).toHaveBeenCalledExactlyOnceWith(request);
  });

  it('fails closed before Portfolio admission when the exact local/remote route is missing or ambiguous', async () => {
    const capacity = { request: vi.fn() };
    const supply = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: 7,
      catalog: { read: async () => catalog() },
      routes: { resolve: async () => null },
      requests: { resolve: vi.fn() },
      capacity,
      runState: readyRunState(),
    });

    await expect(supply.probe(decision())).resolves.toBe(false);
    await expect(supply.deliver(decision()))
      .rejects.toBeInstanceOf(WorkroomSchedulerAssignmentRouteUnavailableError);
    expect(capacity.request).not.toHaveBeenCalled();
  });

  it('rejects a trusted RequestAuthority response that is not bound to the durable Scheduler event and route', async () => {
    const selected = decision();
    const route = {
      kind: 'remote' as const, agentDefinitionId: 'developer', endpointId: 'remote-1',
      authorityRef: 'remote:7:developer:remote-1',
    };
    const exact = capacityRequest(selected, route);
    const forged = {
      ...exact,
      capacityRequest: { ...exact.capacityRequest, payloadDigest: sha('f') },
    };
    const capacity = { request: vi.fn() };
    const supply = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: 7,
      catalog: { read: async () => catalog() },
      routes: { resolve: async () => route },
      requests: { resolve: async () => forged },
      capacity,
      runState: readyRunState(),
    });

    await expect(supply.deliver(selected)).rejects.toThrow('exact Scheduler decision/route');
    expect(capacity.request).not.toHaveBeenCalled();
  });

  it('pins Acceptance before requesting capacity and rejects stale or durably unpinnable Tasks', async () => {
    const selected = decision();
    const route = {
      kind: 'local' as const, agentDefinitionId: 'developer', authorityRef: 'local:7:developer',
    };
    const request = capacityRequest(selected, route);
    const capacity = { request: vi.fn(async () => null) };
    const unpinned = { tasks: { build: { revision: 1, status: 'ready' } } } as never;
    const pinned = readyRunState();
    const pinTaskAcceptance = vi.fn(pinned.pinTaskAcceptance);
    const supply = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: 7,
      catalog: { read: async () => catalog() },
      routes: { resolve: async () => route },
      requests: { resolve: async () => request },
      capacity,
      runState: {
        read: async () => unpinned,
        pinTaskAcceptance,
      },
    });

    await expect(supply.deliver(selected)).resolves.toBeUndefined();
    expect(pinTaskAcceptance).toHaveBeenCalledWith('project-1', 'run-1', 'build');
    expect(capacity.request).toHaveBeenCalledExactlyOnceWith(request);

    const stale = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: 7,
      catalog: { read: async () => catalog() },
      routes: { resolve: async () => route },
      requests: { resolve: async () => request },
      capacity,
      runState: {
        read: async () => ({ tasks: { build: { revision: 2, status: 'ready' } } } as never),
        pinTaskAcceptance: vi.fn(),
      },
    });
    await expect(stale.deliver(selected))
      .rejects.toBeInstanceOf(WorkroomSchedulerPortfolioCapacityUnavailableError);

    const rejected = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: 7,
      catalog: { read: async () => catalog() },
      routes: { resolve: async () => route },
      requests: { resolve: async () => request },
      capacity,
      runState: {
        read: async () => unpinned,
        pinTaskAcceptance: async () => { throw new Error('policy unavailable'); },
      },
    });
    await expect(rejected.deliver(selected)).rejects.toBeInstanceOf(WorkroomSchedulerDurablyBlockedError);

    const missing = new PortfolioFirstWorkroomSchedulerDispatchSupply({
      generation: 7,
      catalog: { read: async () => catalog() },
      routes: { resolve: async () => route },
      requests: { resolve: async () => request },
      capacity,
      runState: {
        read: async () => unpinned,
        pinTaskAcceptance: async () => unpinned,
      },
    });
    await expect(missing.deliver(selected)).rejects.toBeInstanceOf(WorkroomSchedulerDurablyBlockedError);
  });
});

function capacityRequest(
  selected: ReturnType<typeof decision>,
  route: Parameters<typeof workroomSchedulerPortfolioPayloadDigest>[1],
): WorkroomSchedulerCapacityRequest {
  return {
    generation: 7,
    portfolioId: 'portfolio-main',
    tenantId: 'tenant-main',
    catalogRevision: 1,
    catalogDigest: sha('c'),
    capacityRequest: {
      requestId: workroomSchedulerPortfolioRequestId(selected, route),
      projectId: selected.projectId,
      workRef: { runId: selected.runId, profileRevisionId: 'profile-1', profileDigest: sha('a') },
      schedulerRevision: selected.policy.digest,
      schedulerSequence: selected.expectedSequence + 1,
      localOrder: selected.expectedSequence + 1,
      projectPolicyRevision: 1,
      opaqueHeadId: workroomSchedulerPortfolioOpaqueHeadId(selected),
      payloadDigest: workroomSchedulerPortfolioPayloadDigest(selected, route),
      resourceBundle: { demands: [
        { poolId: 'executor-main', capacityUnits: 1, rateUnits: 1, budgetUnits: 0 },
        { poolId: 'model-main', capacityUnits: 1, rateUnits: 1, budgetUnits: 5 },
      ] },
      preemptibility: 'atomic',
      starvationAt: 400,
    },
  };
}

function catalog() {
  return {
    revision: sha('d'),
    definitions: {
      'project-1': { enabled: true, members: [{ role: 'executor', agent: 'developer' }] },
    },
  } as never;
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

function decision() {
  return decideWorkroomSchedule(readyJournal())!;
}

function readyJournal(): readonly WorkroomEvent[] {
  const policy = createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler://1', revision: 1, pinnedAtSequence: 1, capacity: 1,
    agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
    preemptionDeadlineMs: 50,
  });
  return [
    event(0, 'run.created', { projectId: 'project-1', title: 'Run' }),
    event(1, 'plan.admitted', { schedulerPolicy: policy }),
    event(2, 'task.planned', {
      taskKey: 'build', title: 'Build', role: 'executor', required: true, maxAttempts: 1,
      sponsorLane: 'normal', localRank: 0, deadline: 1_000, enqueuedAt: 0,
      dependsOn: [], preemptibility: 'atomic',
    }),
  ];
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
