import { describe, expect, it } from 'vitest';
import {
  WorkroomSchedulerRuntime,
  WorkroomSchedulerSupplyUnavailableError,
  WorkroomSchedulerDurablyBlockedError,
  WorkroomSchedulerAssignmentRouteUnavailableError,
  RemoteWorkroomSchedulerDispatchSupply,
} from '../../src/plugin-runtime/workroom-scheduler-runtime.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';

describe('WorkroomSchedulerRuntime', () => {
  it('pins acceptance and issues a remote Assignment from exact Catalog role/endpoint supply', async () => {
    const decision = (await import('../../src/workroom/workroom-scheduler.js'))
      .decideWorkroomSchedule(readyJournal())!;
    let pinned = false;
    const issued: unknown[] = [];
    const supply = new RemoteWorkroomSchedulerDispatchSupply({
      catalog: {
        read: async () => ({
          definitions: {
            'project-1': { enabled: true, members: [{ role: 'executor', agent: 'developer' }] },
          },
        }) as never,
      },
      runState: {
        read: async () => ({
          tasks: { build: { revision: 1, status: 'ready' } },
        }) as never,
        pinTaskAcceptance: async () => {
          pinned = true;
          return ({
            tasks: { build: { revision: 1, status: 'ready', acceptanceContract: { id: 'contract' } } },
          }) as never;
        },
      },
      dispatch: { issue: async request => { issued.push(request); return {} as never; } },
      route: {
        resolve: async () => ({
          kind: 'remote' as const,
          agentDefinitionId: 'developer', endpointId: 'endpoint-1', authorityRef: 'route://1',
        }),
      },
    });

    await supply.deliver(decision);

    expect(pinned).toBe(true);
    expect(issued).toEqual([{
      operationId: decision.decisionId,
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      agentDefinitionId: 'developer', endpointId: 'endpoint-1',
    }]);
  });

  it('fails closed without generation-owned Assignment supply and writes nothing', async () => {
    const events = readyJournal();
    let commits = 0;
    const runtime = new WorkroomSchedulerRuntime({
      journal: { listRunIds: async () => ['run-1'], read: async () => events },
      commands: { commit: async decision => {
        commits += 1;
        return { status: 'committed', decisionId: decision.decisionId, sequence: decision.expectedSequence + 1 };
      } },
      resolveSupply: () => undefined,
    });

    await expect(runtime.drain()).rejects.toBeInstanceOf(WorkroomSchedulerSupplyUnavailableError);
    expect(commits).toBe(0);
  });

  it('redelivers a durable pending dispatch after restart before selecting more work', async () => {
    const base = readyJournal();
    const decision = (await import('../../src/workroom/workroom-scheduler.js'))
      .decideWorkroomSchedule(base)!;
    const events = [...base, event(3, 'scheduler.dispatch_requested', decision as unknown as Record<string, unknown>)];
    const delivered: string[] = [];
    let commits = 0;
    const runtime = new WorkroomSchedulerRuntime({
      journal: { listRunIds: async () => ['run-1'], read: async () => events },
      commands: { commit: async candidate => {
        commits += 1;
        return { status: 'committed', decisionId: candidate.decisionId, sequence: candidate.expectedSequence + 1 };
      } },
      resolveSupply: () => ({
        deliver: async candidate => { delivered.push(candidate.decisionId); },
      }),
    });

    await expect(runtime.drain()).resolves.toMatchObject({ delivered: 1 });
    expect(delivered).toEqual([decision.decisionId]);
    expect(commits).toBe(0);
  });

  it('turns an ambiguous Assignment route into the typed durable blocker seam', async () => {
    const base = readyJournal();
    const decision = (await import('../../src/workroom/workroom-scheduler.js'))
      .decideWorkroomSchedule(base)!;
    const events = [...base, event(3, 'scheduler.dispatch_requested', decision as unknown as Record<string, unknown>)];
    const blocked: string[] = [];
    const supply = new RemoteWorkroomSchedulerDispatchSupply({
      catalog: { read: async () => ({ definitions: { 'project-1': { enabled: true, members: [] } } }) as never },
      runState: { read: async () => ({} as never), pinTaskAcceptance: async () => ({} as never) },
      dispatch: { issue: async () => ({} as never) },
      route: { resolve: async () => null },
    });
    const runtime = new WorkroomSchedulerRuntime({
      journal: { listRunIds: async () => ['run-1'], read: async () => events },
      commands: { commit: async candidate => ({
        status: 'committed', decisionId: candidate.decisionId, sequence: candidate.expectedSequence + 1,
      }) },
      resolveSupply: () => supply,
      unavailableControl: {
        block: async candidate => { blocked.push(candidate.decisionId); },
        recover: async () => undefined,
      },
    });

    await expect(runtime.drain()).resolves.toEqual({ scheduled: 0, delivered: 0 });
    expect(blocked).toEqual([decision.decisionId]);
  });

  it('keeps one external durable Grant blocker without resolving and reblocking the Task each tick', async () => {
    const base = readyJournal();
    const decision = (await import('../../src/workroom/workroom-scheduler.js'))
      .decideWorkroomSchedule(base)!;
    const events = [...base, event(3, 'scheduler.dispatch_requested', decision as unknown as Record<string, unknown>)];
    let deliveries = 0;
    let blocks = 0;
    let recovers = 0;
    const runtime = new WorkroomSchedulerRuntime({
      journal: { listRunIds: async () => ['run-1'], read: async () => events },
      commands: { commit: async candidate => ({
        status: 'committed', decisionId: candidate.decisionId, sequence: candidate.expectedSequence + 1,
      }) },
      resolveSupply: () => ({
        deliver: async candidate => {
          deliveries += 1;
          throw new WorkroomSchedulerDurablyBlockedError(candidate, 'assignment-grant:key:digest');
        },
      }),
      unavailableControl: {
        block: async () => { blocks += 1; },
        recover: async () => { recovers += 1; },
      },
    });

    await runtime.drain();
    await runtime.drain();
    expect(deliveries).toBe(2);
    expect(blocks).toBe(0);
    expect(recovers).toBe(0);
  });

  it('recovers only the probed dispatch blocker after its generation supply becomes ready', async () => {
    const base = readyJournal();
    const decision = (await import('../../src/workroom/workroom-scheduler.js'))
      .decideWorkroomSchedule(base)!;
    const events = [...base, event(3, 'scheduler.dispatch_requested', decision as unknown as Record<string, unknown>)];
    let ready = false;
    const blocked: string[] = [];
    const recovered: string[] = [];
    const delivered: string[] = [];
    const runtime = new WorkroomSchedulerRuntime({
      journal: { listRunIds: async () => ['run-1'], read: async () => events },
      commands: { commit: async candidate => ({
        status: 'committed', decisionId: candidate.decisionId, sequence: candidate.expectedSequence + 1,
      }) },
      resolveSupply: () => ({
        probe: async () => ready,
        deliver: async candidate => { delivered.push(candidate.decisionId); },
      }),
      unavailableControl: {
        block: async candidate => { blocked.push(candidate.decisionId); },
        recover: async candidate => { recovered.push(candidate.decisionId); },
      },
    });

    await runtime.drain();
    expect(blocked).toEqual([decision.decisionId]);
    expect(recovered).toEqual([]);
    expect(delivered).toEqual([]);

    ready = true;
    await runtime.drain();
    expect(blocked).toEqual([decision.decisionId]);
    expect(recovered).toEqual([decision.decisionId]);
    expect(delivered).toEqual([decision.decisionId]);
  });

  it('does not recover a blocker when readiness probed true but delivery still fails closed', async () => {
    const base = readyJournal();
    const decision = (await import('../../src/workroom/workroom-scheduler.js'))
      .decideWorkroomSchedule(base)!;
    const events = [...base, event(3, 'scheduler.dispatch_requested', decision as unknown as Record<string, unknown>)];
    const blocked: string[] = [];
    const recovered: string[] = [];
    const runtime = new WorkroomSchedulerRuntime({
      journal: { listRunIds: async () => ['run-1'], read: async () => events },
      commands: { commit: async candidate => ({
        status: 'committed', decisionId: candidate.decisionId, sequence: candidate.expectedSequence + 1,
      }) },
      resolveSupply: () => ({
        probe: async () => true,
        deliver: async candidate => {
          throw new WorkroomSchedulerAssignmentRouteUnavailableError(candidate);
        },
      }),
      unavailableControl: {
        block: async candidate => { blocked.push(candidate.decisionId); },
        recover: async candidate => { recovered.push(candidate.decisionId); },
      },
    });

    await expect(runtime.drain()).resolves.toEqual({ scheduled: 0, delivered: 0 });
    expect(blocked).toEqual([decision.decisionId]);
    expect(recovered).toEqual([]);
  });
});

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
