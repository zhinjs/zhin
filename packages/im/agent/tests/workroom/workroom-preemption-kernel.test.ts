import { describe, expect, it } from 'vitest';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  readWorkroomPreemptionCheckpointAck,
  replayWorkroomPreemptions,
  WorkroomPreemptionCheckpointApplication,
} from '../../src/workroom/workroom-preemption.js';
import {
  createWorkroomSchedulerPolicySnapshot,
  decideWorkroomSchedule,
} from '../../src/workroom/workroom-scheduler.js';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

const SHA = (value: string) => `sha256:${value.repeat(64)}`;

describe('Workroom two-phase preemption', () => {
  it('persists prepare then checkpoint request while the old Assignment keeps ownership', async () => {
    const { journal, kernel, runId, envelope } = await fixture('checkpointable');
    const decision = decideWorkroomSchedule(await journal.read(runId));
    expect(decision).toMatchObject({
      type: 'prepare_preemption', victimTaskKey: 'background', reservedTaskKey: 'urgent',
      assignmentId: 'assignment-background', assignmentFence: 1, takeoverFence: 2,
    });

    await kernel.commitSchedulerDecision(decision!);

    const events = await journal.read(runId);
    expect(events.slice(-2).map(event => event.type))
      .toEqual(['scheduler.preemption_requested', 'assignment.checkpoint_requested']);
    expect(replayWorkroomPreemptions(events).pending).toMatchObject({
      assignmentId: envelope.assignmentId, status: 'checkpoint_requested',
    });
    expect(await kernel.read('project-1', runId)).toMatchObject({
      tasks: { background: { status: 'executing', currentAssignmentId: envelope.assignmentId } },
      assignments: { [envelope.assignmentId]: { status: 'running', owner: 'executor-1', fence: 1 } },
    });
  });

  it('accepts only the exact authenticated checkpoint and resumes with a higher fence', async () => {
    const { journal, kernel, runId, envelope } = await fixture('checkpointable');
    const decision = decideWorkroomSchedule(await journal.read(runId));
    await kernel.commitSchedulerDecision(decision!);
    const beforeAck = await journal.read(runId);
    const restarted = new WorkroomKernel({ journal, now: () => 100 });
    const checkpoint = {
      version: 1 as const, type: 'checkpoint' as const, observationId: 'checkpoint-preempt-1',
      envelopeDigest: envelope.digest,
      checkpoint: { ref: 'checkpoint://background/1', digest: SHA('c') },
    };

    const acknowledged = await restarted.applyAssignmentObservation(
      envelope, checkpoint, beforeAck.at(-1)!.sequence,
    );

    expect(acknowledged).toMatchObject({
      tasks: { background: { status: 'ready', currentAssignmentId: undefined } },
      assignments: { [envelope.assignmentId]: { status: 'cancelled', outcome: 'interrupted' } },
    });
    expect((await journal.read(runId)).slice(-3).map(event => event.type)).toEqual([
      'assignment.checkpointed',
      'scheduler.preemption_checkpoint_acknowledged',
      'assignment.preempted',
    ]);
    const acknowledgedEvents = await journal.read(runId);
    expect(() => readWorkroomPreemptionCheckpointAck(acknowledgedEvents.slice(0, -1), decision!.decisionId))
      .toThrow('no atomic takeover release');
    expect(readWorkroomPreemptionCheckpointAck(acknowledgedEvents, decision!.decisionId))
      .toMatchObject({
        assignmentId: envelope.assignmentId, assignmentAttempt: 1, assignmentFence: 1,
        takeoverFence: 2, checkpoint: checkpoint.checkpoint,
      });
    expect(decideWorkroomSchedule(await journal.read(runId))).toMatchObject({
      type: 'dispatch_task', taskKey: 'urgent', reason: 'preemption_reservation',
    });

    const replayed = await restarted.applyAssignmentObservation(
      envelope, checkpoint, beforeAck.at(-1)!.sequence,
    );
    expect(replayed.sequence).toBe(acknowledged.sequence);

    await journal.append(runId, acknowledged.sequence, [claimDraft('assignment-background-2', envelope.digest, 2, 2)]);
    expect((await kernel.read('project-1', runId)).assignments['assignment-background-2'])
      .toMatchObject({ fence: 2, attempt: 2 });
  });

  it('never prepares preemption for atomic work', async () => {
    const { journal, runId } = await fixture('atomic');
    expect(decideWorkroomSchedule(await journal.read(runId))).toBeNull();
    expect((await journal.read(runId)).some(event => event.type === 'scheduler.preemption_requested')).toBe(false);
  });

  it('times out into a typed replan/cancel blocker without releasing owner or resource', async () => {
    const { journal, kernel, runId, envelope } = await fixture('checkpointable');
    const decision = decideWorkroomSchedule(await journal.read(runId));
    await kernel.commitSchedulerDecision(decision!);
    const prepared = await journal.read(runId);

    const timedOut = await kernel.execute('project-1', runId, {
      type: 'advance_clock', now: decision!.deadline,
    });

    expect((await journal.read(runId)).slice(-3).map(event => event.type)).toEqual([
      'clock.advanced', 'scheduler.preemption_timed_out', 'task.blocked',
    ]);
    expect(timedOut).toMatchObject({
      tasks: {
        background: { status: 'executing', currentAssignmentId: envelope.assignmentId },
        urgent: { status: 'blocked' },
      },
      assignments: { [envelope.assignmentId]: { status: 'running', owner: 'executor-1' } },
    });
    expect(replayWorkroomPreemptions(await journal.read(runId)).pending).toBeUndefined();
    expect((await journal.read(runId)).length).toBe(prepared.length + 3);
  });

  it('redelivers the same durable checkpoint request after a lost response without acknowledging it', async () => {
    const { journal, kernel, runId, envelope } = await fixture('checkpointable');
    const decision = decideWorkroomSchedule(await journal.read(runId));
    await kernel.commitSchedulerDecision(decision!);
    const seen: string[] = [];
    let loseResponse = true;
    const application = new WorkroomPreemptionCheckpointApplication({
      journal,
      delivery: {
        async request(request) {
          seen.push(request.decisionId);
          if (loseResponse) throw new Error('transport response lost');
        },
      },
    });
    const controller = new AbortController();

    await expect(application.recover(controller.signal)).rejects.toThrow('response lost');
    expect((await kernel.read('project-1', runId)).assignments[envelope.assignmentId])
      .toMatchObject({ status: 'running', owner: 'executor-1' });
    loseResponse = false;
    await expect(application.recover(controller.signal)).resolves.toBe(1);
    expect(seen).toEqual([decision!.decisionId, decision!.decisionId]);
    expect(replayWorkroomPreemptions(await journal.read(runId)).pending?.decisionId)
      .toBe(decision!.decisionId);
  });
});

async function fixture(preemptibility: 'checkpointable' | 'atomic') {
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({ journal, now: () => 100 });
  const plan = WorkflowPlanBuilder.create({
    proposalId: 'plan-1', projectId: 'project-1', parameterDigest: SHA('a'),
    strategy: { id: 'strategy:test', version: '1', digest: SHA('a') },
    authority: {
      projectRevision: 'project-1', projectDigest: SHA('a'), profileRevisionId: 'profile-1',
      profileDigest: SHA('a'), planningPolicyRevisionId: 'policy-1', planningPolicyDigest: SHA('a'),
      orchestratorAgentDefinitionId: 'orchestrator-1', orchestratorAuthorityDigest: SHA('a'),
    },
    budget: { maxTasks: 4, maxTotalAttempts: 8 },
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler-policy:1', revision: 1, pinnedAtSequence: 1, capacity: 1,
      agingStepMs: 1_000, starvationBoundMs: { urgent: 10_000, high: 20_000, normal: 30_000, low: 40_000 },
      preemptionDeadlineMs: 50,
    }),
  }).addTask(task('background', 'low', preemptibility)).addTask(task('urgent', 'urgent', 'atomic')).build();
  const admitted = await kernel.admitWorkflowPlan({
    operationId: 'operation-preemption', projectId: 'project-1', title: 'Preemption',
    sourceEventRef: 'conversation://1', sourceEventDigest: SHA('a'),
    orchestratorAgentDefinitionId: 'orchestrator-1', plan,
  });
  const envelope = executionEnvelope(admitted.runId);
  await journal.append(admitted.runId, admitted.state.sequence, [
    claimDraft(envelope.assignmentId, envelope.digest, 1, 1),
    { eventId: 'assignment-started-1', occurredAt: 100, type: 'assignment.started',
      payload: { assignmentId: envelope.assignmentId } },
  ]);
  return { journal, kernel, runId: admitted.runId, envelope };
}

function task(key: string, sponsorLane: 'urgent' | 'low', preemptibility: 'checkpointable' | 'atomic') {
  return {
    key, title: key, role: 'executor', required: true, maxAttempts: 3, dependsOn: [], requires: {},
    scheduler: { sponsorLane, localRank: 10, enqueuedAt: 100, deadline: 1_000, preemptibility },
  };
}

function executionEnvelope(runId: string) {
  return createAssignmentExecutionEnvelope({
    projectId: 'project-1', runId, taskKey: 'background', taskRevision: 1,
    assignmentId: 'assignment-background', assignmentRevision: 1, attempt: 1, fence: 1,
    principalId: 'executor-1', role: 'executor',
    agentDefinition: { ref: 'agent:1', revision: 1, digest: SHA('1') },
    plan: { ref: 'plan:1', revision: 1, digest: SHA('2') },
    contextPolicy: { ref: 'context:1', revision: 1, digest: SHA('3') },
    factAnchor: { ref: 'facts:1', sequence: 3, digest: SHA('4') },
    capabilitySnapshot: { ref: 'capability:1', revision: 1, digest: SHA('5') },
    policySnapshot: { ref: 'policy:1', revision: 1, digest: SHA('6') },
    workspace: { leaseRef: 'lease:1', mountRef: '/workspace', baseRevision: 'base', fence: 1 },
  });
}

function claimDraft(assignmentId: string, envelopeDigest: string, attempt: number, fence: number) {
  return {
    eventId: `assignment-claimed-${attempt}`, occurredAt: 100, type: 'assignment.claimed' as const,
    payload: {
      taskKey: 'background', assignmentId, taskRevision: 1, attempt,
      assignmentRevision: 1, fence, envelopeDigest,
      owner: 'executor-1', role: 'executor', leaseExpiresAt: 1_000,
    },
  };
}
