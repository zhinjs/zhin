import { describe, expect, it, vi } from 'vitest';
import {
  createWorkroomSchedulerPolicySnapshot,
  decideWorkroomSchedule,
  proposeWorkroomPriorityChange,
  type WorkroomSchedulerPolicySnapshot,
} from '../../src/workroom/workroom-scheduler.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;

describe('Workroom Scheduler', () => {
  it('selects the same ready Task for the same Journal sequence using the complete comparator', () => {
    const policy = schedulerPolicy();
    const events = journal(policy, [
      task('normal-old', 2, { sponsorLane: 'normal', localRank: 1, deadline: 900 }),
      task('urgent-late', 3, { sponsorLane: 'urgent', localRank: 0, deadline: 1_000 }),
      task('urgent-deadline', 4, { sponsorLane: 'urgent', localRank: 0, deadline: 800 }),
    ]);

    const first = decideWorkroomSchedule(events);
    const replay = decideWorkroomSchedule(structuredClone(events));

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      version: 1,
      expectedSequence: 4,
      type: 'dispatch_task',
      taskKey: 'urgent-deadline',
      policy: { digest: policy.digest },
    });
  });

  it('bounds starvation across Sponsor lanes without rewriting the lane', () => {
    const policy = schedulerPolicy({
      starvationBoundMs: { urgent: 1_000, high: 2_000, normal: 3_000, low: 4_000 },
    });
    const events = journal(policy, [
      task('low-starved', 2, { sponsorLane: 'low', enqueuedAt: 0 }),
      task('urgent-new', 3, { sponsorLane: 'urgent', enqueuedAt: 4_500 }),
      clock(4, 5_000),
    ]);

    expect(decideWorkroomSchedule(events)).toMatchObject({
      type: 'dispatch_task',
      taskKey: 'low-starved',
      reason: 'starvation_bound',
      sponsorLane: 'low',
    });
  });

  it('uses rank/aging and enqueue sequence when Tasks have no deadline', () => {
    const events = journal(schedulerPolicy(), [
      task('older', 2, { sponsorLane: 'normal', localRank: 1, enqueuedAt: 100 }),
      task('ranked', 3, { sponsorLane: 'normal', localRank: 20, enqueuedAt: 200 }),
    ]);
    expect(decideWorkroomSchedule(events)).toMatchObject({ taskKey: 'ranked' });
  });

  it('selects the same Unicode preemption victim under different host locales', () => {
    const events = journal(schedulerPolicy({ capacity: 2 }), [
      task('zeta', 2, { sponsorLane: 'low' }),
      task('äther', 3, { sponsorLane: 'low' }),
      task('urgent', 4, { sponsorLane: 'urgent' }),
      assignmentClaimed(5, 'zeta', 'assignment-zeta'),
      event(6, 'assignment.started', { assignmentId: 'assignment-zeta' }),
      assignmentClaimed(7, 'äther', 'assignment-unicode'),
      event(8, 'assignment.started', { assignmentId: 'assignment-unicode' }),
    ]);
    const codeUnitLocale = decideWithLocale(events, (left, right) => left < right ? -1 : left > right ? 1 : 0);
    const reverseLocale = decideWithLocale(events, (left, right) => left < right ? 1 : left > right ? -1 : 0);

    expect(codeUnitLocale).toMatchObject({ type: 'prepare_preemption', victimTaskKey: 'zeta' });
    expect(reverseLocale).toEqual(codeUnitLocale);
  });

  it('automatically advances a dependent Task only after the dependency is accepted', () => {
    const policy = schedulerPolicy();
    const pending = journal(policy, [
      task('build', 2, { sponsorLane: 'normal' }),
      task('review', 3, { sponsorLane: 'normal', dependsOn: ['build'] }),
      assignmentClaimed(4, 'build', 'assignment-build'),
      assignmentCompleted(5, 'assignment-build'),
    ]);

    expect(decideWorkroomSchedule(pending)).toBeNull();

    const accepted = [
      ...pending,
      event(6, 'task.accepted', {
        taskKey: 'build',
        reportRef: 'report://build',
        record: { marker: 'accepted by Kernel policy' },
      }),
    ];
    expect(decideWorkroomSchedule(accepted)).toMatchObject({
      type: 'dispatch_task',
      taskKey: 'review',
      expectedSequence: 6,
    });
  });

  it('fails closed for cancellation and malformed waiting ownership', () => {
    const policy = schedulerPolicy();
    const cancelling = journal(policy, [
      task('build', 2, { sponsorLane: 'normal' }),
      event(3, 'run.cancel_requested', { reason: 'Sponsor cancelled' }),
    ]);
    expect(decideWorkroomSchedule(cancelling)).toBeNull();

    const replanning = journal(policy, [
      task('build', 2, { sponsorLane: 'normal' }),
      event(3, 'run.replan_requested', {
        operationId: 'replan-1', reasonCode: 'requirements_changed', requestDigest: DIGEST_A,
      }),
    ]);
    expect(decideWorkroomSchedule(replanning)).toBeNull();

    const malformedWait = journal(policy, [
      task('build', 2, { sponsorLane: 'normal' }),
      event(3, 'task.blocked', {
        taskKey: 'build', blockerId: 'wait-1', kind: 'human_input',
        owner: '', reason: 'Need answer', deadline: 0,
      }),
    ]);
    expect(() => decideWorkroomSchedule(malformedWait))
      .toThrow('owner, deadline and allowed successors');
  });

  it('lets a trusted Sponsor interrupt across lanes but limits Orchestrator changes to a lane', () => {
    const sponsor = proposeWorkroomPriorityChange({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      expectedSequence: 10, currentLane: 'normal', requestedLane: 'urgent', localRank: 50,
      principalId: 'sponsor-1', authority: 'sponsor', authorityRef: 'auth://sponsor/1',
      deadline: 1_000,
    });
    expect(sponsor).toMatchObject({
      type: 'priority_change', requestedLane: 'urgent', authority: 'sponsor',
      owner: 'sponsor-1', allowedSuccessors: ['restore', 'rebase', 'cancel_run'],
    });

    expect(() => proposeWorkroomPriorityChange({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      expectedSequence: 10, currentLane: 'normal', requestedLane: 'high', localRank: 50,
      principalId: 'orchestrator-1', authority: 'orchestrator', authorityRef: 'auth://resource-hub/1',
      deadline: 1_000,
    })).toThrow('Orchestrator cannot move a Task across Sponsor lanes');

    expect(proposeWorkroomPriorityChange({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      expectedSequence: 10, currentLane: 'normal', requestedLane: 'normal', localRank: 51,
      principalId: 'orchestrator-1', authority: 'orchestrator', authorityRef: 'auth://resource-hub/1',
      deadline: 1_000,
    })).toMatchObject({ requestedLane: 'normal', localRank: 51, authority: 'orchestrator' });
  });
});

function decideWithLocale(
  events: readonly WorkroomEvent[],
  compare: (left: string, right: string) => number,
) {
  const localeCompare = vi.spyOn(String.prototype, 'localeCompare')
    .mockImplementation(function (this: string, right: string) {
      return compare(String(this), right);
    });
  try {
    return decideWorkroomSchedule(events);
  } finally {
    localeCompare.mockRestore();
  }
}

function schedulerPolicy(
  override: Partial<Omit<Parameters<typeof createWorkroomSchedulerPolicySnapshot>[0], 'policyRef' | 'revision' | 'pinnedAtSequence'>> = {},
): WorkroomSchedulerPolicySnapshot {
  return createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler-policy://default/1',
    revision: 1,
    pinnedAtSequence: 1,
    capacity: 1,
    agingStepMs: 1_000,
    starvationBoundMs: { urgent: 10_000, high: 20_000, normal: 30_000, low: 40_000 },
    preemptionDeadlineMs: 5_000,
    ...override,
  });
}

function journal(
  policy: WorkroomSchedulerPolicySnapshot,
  tail: readonly WorkroomEvent[],
): readonly WorkroomEvent[] {
  const plan = WorkflowPlanBuilder.create({
    proposalId: 'proposal-1', projectId: 'project-1', parameterDigest: DIGEST_A,
    strategy: { id: 'strategy:test', version: '1', digest: DIGEST_A },
    authority: {
      projectRevision: 'catalog-1', projectDigest: DIGEST_A,
      profileRevisionId: 'profile-1', profileDigest: DIGEST_A,
      planningPolicyRevisionId: 'planning-policy-1', planningPolicyDigest: DIGEST_A,
      orchestratorAgentDefinitionId: 'orchestrator', orchestratorAuthorityDigest: DIGEST_A,
    },
    budget: { maxTasks: 4, maxTotalAttempts: 4 },
    schedulerPolicy: policy,
  }).addTask({
    key: 'placeholder', title: 'Placeholder', role: 'executor', required: true,
    maxAttempts: 1, dependsOn: [], requires: {},
    scheduler: {
      sponsorLane: 'normal', localRank: 50, enqueuedAt: 100,
      deadline: 1_000, preemptibility: 'checkpointable',
    },
  }).build();
  return [
    event(0, 'run.created', { projectId: 'project-1', title: 'Run' }),
    event(1, 'plan.admitted', {
      operationId: 'operation-1', sourceEventRef: 'conversation://1', sourceEventDigest: DIGEST_A,
      orchestratorAgentDefinitionId: 'orchestrator', plan, schedulerPolicy: policy,
    }),
    ...tail,
  ];
}

function task(
  taskKey: string,
  sequence: number,
  options: Partial<{
    sponsorLane: 'urgent' | 'high' | 'normal' | 'low';
    localRank: number;
    deadline: number;
    enqueuedAt: number;
    dependsOn: readonly string[];
  }>,
): WorkroomEvent;
function task(
  taskKey: string,
  sequence: number,
  options: Partial<{
    sponsorLane: 'urgent' | 'high' | 'normal' | 'low';
    localRank: number;
    deadline: number;
    enqueuedAt: number;
    dependsOn: readonly string[];
  }> = {},
): WorkroomEvent {
  return event(sequence, 'task.planned', {
    taskKey, title: taskKey, required: true, maxAttempts: 2, role: 'executor',
    dependsOn: options.dependsOn ?? [], sponsorLane: options.sponsorLane ?? 'normal',
    localRank: options.localRank ?? 0, enqueuedAt: options.enqueuedAt ?? sequence * 100,
    ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
    preemptibility: 'checkpointable',
  });
}

function assignmentClaimed(sequence: number, taskKey: string, assignmentId: string): WorkroomEvent {
  return event(sequence, 'assignment.claimed', {
    taskKey, assignmentId, taskRevision: 1, assignmentRevision: 1, attempt: 1, fence: 1,
    envelopeDigest: DIGEST_A, owner: 'executor', role: 'executor', leaseExpiresAt: 100_000,
  });
}

function assignmentCompleted(sequence: number, assignmentId: string): WorkroomEvent {
  return event(sequence, 'assignment.execution_completed', { assignmentId });
}

function clock(sequence: number, now: number): WorkroomEvent {
  return event(sequence, 'clock.advanced', { now });
}

function event(
  sequence: number,
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
): WorkroomEvent {
  return Object.freeze({
    version: 1,
    eventId: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    occurredAt: sequence * 100,
    type,
    payload: Object.freeze(payload),
  });
}
