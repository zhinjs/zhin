import { describe, expect, it } from 'vitest';
import {
  WorkroomSchedulerApplication,
  createWorkroomSchedulerKernelCommandPort,
  type WorkroomSchedulerKernelCommandPort,
} from '../../src/workroom/workroom-scheduler-application.js';
import {
  createWorkroomSchedulerPolicySnapshot,
  type WorkroomDispatchTaskDecision,
} from '../../src/workroom/workroom-scheduler.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';
import {
  MemoryWorkroomJournal,
  WorkroomSequenceConflictError,
  type WorkroomJournal,
} from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('WorkroomSchedulerApplication', () => {
  it('schedules a real Kernel-admitted Plan from its pinned policy and Task facts', async () => {
    const journal = new MemoryWorkroomJournal();
    let id = 0;
    const kernel = new WorkroomKernel({ journal, now: () => 100, createId: () => `id-${++id}` });
    const policy = schedulerPolicy();
    const plan = WorkflowPlanBuilder.create({
      proposalId: 'proposal-real', projectId: 'project-1', parameterDigest: DIGEST,
      strategy: { id: 'strategy:test', version: '1', digest: DIGEST },
      authority: {
        projectRevision: 'catalog-1', projectDigest: DIGEST,
        profileRevisionId: 'profile-1', profileDigest: DIGEST,
        planningPolicyRevisionId: 'planning-1', planningPolicyDigest: DIGEST,
        orchestratorAgentDefinitionId: 'orchestrator', orchestratorAuthorityDigest: DIGEST,
      },
      budget: { maxTasks: 2, maxTotalAttempts: 2 },
      schedulerPolicy: policy,
    }).addTask({
      key: 'build', title: 'Build', role: 'executor', required: true, maxAttempts: 1,
      dependsOn: [], requires: {},
      scheduler: { sponsorLane: 'normal', localRank: 10, enqueuedAt: 100, deadline: 10_000, preemptibility: 'atomic' },
    }).addTask({
      key: 'review', title: 'Review', role: 'reviewer', required: true, maxAttempts: 1,
      dependsOn: ['build'], requires: {},
      scheduler: { sponsorLane: 'normal', localRank: 100, enqueuedAt: 100, deadline: 9_000, preemptibility: 'atomic' },
    }).build();
    const admitted = await kernel.admitWorkflowPlan({
      operationId: 'operation-real', projectId: 'project-1', title: 'Ship',
      sourceEventRef: 'conversation://1', sourceEventDigest: DIGEST,
      orchestratorAgentDefinitionId: 'orchestrator', plan,
    });

    const result = await new WorkroomSchedulerApplication({
      journal,
      commands: createWorkroomSchedulerKernelCommandPort(kernel),
    }).runOnce(admitted.runId);

    expect(result).toMatchObject({ status: 'committed', taskKey: 'build' });
    expect((await journal.read(admitted.runId)).at(-1)).toMatchObject({
      type: 'scheduler.dispatch_requested',
      payload: { taskKey: 'build', policy: { digest: policy.digest } },
    });
  });

  it('submits one exact-sequence Kernel command and restart observes its durable dispatch fact', async () => {
    const journal = mutableJournal(baseJournal(['build']));
    const committed: WorkroomDispatchTaskDecision[] = [];
    const commands: WorkroomSchedulerKernelCommandPort = {
      async commit(decision) {
        committed.push(decision);
        journal.events.push(schedulerDispatch(journal.events.length, decision));
        return { status: 'committed', sequence: journal.events.length - 1, decisionId: decision.decisionId };
      },
    };
    const first = new WorkroomSchedulerApplication({ journal, commands });
    await expect(first.runOnce('run-1')).resolves.toMatchObject({
      status: 'committed', taskKey: 'build', expectedSequence: 2,
    });

    const restarted = new WorkroomSchedulerApplication({ journal, commands });
    await expect(restarted.runOnce('run-1')).resolves.toEqual({ status: 'idle', runId: 'run-1' });
    expect(committed).toHaveLength(1);
  });

  it('replays after a Kernel CAS loser and selects the next deterministic Task', async () => {
    const journal = mutableJournal(baseJournal(['alpha', 'beta']));
    let attempts = 0;
    const commands: WorkroomSchedulerKernelCommandPort = {
      async commit(decision) {
        attempts += 1;
        if (attempts === 1) {
          journal.events.push(schedulerDispatch(journal.events.length, decision));
          throw new WorkroomSequenceConflictError('run-1', decision.expectedSequence, journal.events.length - 1);
        }
        journal.events.push(schedulerDispatch(journal.events.length, decision));
        return { status: 'committed', sequence: journal.events.length - 1, decisionId: decision.decisionId };
      },
    };

    await expect(new WorkroomSchedulerApplication({ journal, commands, maxCasRetries: 2 }).runOnce('run-1'))
      .resolves.toMatchObject({ status: 'committed', taskKey: 'beta', expectedSequence: 4 });
    expect(attempts).toBe(2);
  });

  it('recovers all nonterminal Runs in stable run-id order', async () => {
    const journals = new Map([
      ['run-b', retarget(baseJournal(['build']), 'run-b')],
      ['run-a', retarget(baseJournal(['test']), 'run-a')],
    ]);
    const visited: string[] = [];
    const journal: Pick<WorkroomJournal, 'listRunIds' | 'read'> = {
      listRunIds: async () => ['run-b', 'run-a'],
      read: async runId => journals.get(runId) ?? [],
    };
    const commands: WorkroomSchedulerKernelCommandPort = {
      async commit(decision) {
        visited.push(decision.runId);
        return { status: 'committed', sequence: decision.expectedSequence + 1, decisionId: decision.decisionId };
      },
    };

    const results = await new WorkroomSchedulerApplication({ journal, commands }).recover();
    expect(visited).toEqual(['run-a', 'run-b']);
    expect(results.map(result => result.runId)).toEqual(['run-a', 'run-b']);
  });
});

function mutableJournal(initial: readonly WorkroomEvent[]) {
  const events = [...initial];
  return {
    events,
    listRunIds: async () => ['run-1'],
    read: async () => Object.freeze([...events]),
  };
}

function baseJournal(taskKeys: readonly string[]): readonly WorkroomEvent[] {
  const policy = schedulerPolicy();
  return [
    event(0, 'run.created', { projectId: 'project-1', title: 'Run' }),
    event(1, 'plan.admitted', { schedulerPolicy: policy }),
    ...taskKeys.map((taskKey, index) => event(index + 2, 'task.planned', {
      taskKey, title: taskKey, required: true, maxAttempts: 1, role: 'executor',
      sponsorLane: 'normal', localRank: 0, enqueuedAt: 100, dependsOn: [],
      preemptibility: 'checkpointable',
    })),
  ];
}

function schedulerPolicy() {
  return createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler-policy://default/1', revision: 1, pinnedAtSequence: 1,
    capacity: 2, agingStepMs: 1_000,
    starvationBoundMs: { urgent: 10_000, high: 20_000, normal: 30_000, low: 40_000 },
    preemptionDeadlineMs: 5_000,
  });
}

function schedulerDispatch(sequence: number, decision: WorkroomDispatchTaskDecision): WorkroomEvent {
  return event(sequence, 'scheduler.dispatch_requested' as WorkroomEvent['type'], {
    ...decision,
  });
}

function retarget(events: readonly WorkroomEvent[], runId: string): readonly WorkroomEvent[] {
  return events.map(event => Object.freeze({ ...event, runId }));
}

function event(sequence: number, type: WorkroomEvent['type'], payload: Record<string, unknown>): WorkroomEvent {
  return Object.freeze({
    version: 1, eventId: `event-${sequence}`, runId: 'run-1', sequence,
    occurredAt: 100 + sequence, type, payload: Object.freeze(payload),
  });
}
