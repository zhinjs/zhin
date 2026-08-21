import { describe, expect, it } from 'vitest';
import type {
  WorkroomAcceptanceDecisionInput,
  WorkroomAcceptancePolicyDecisionPort,
} from '../../src/workroom/acceptance-policy.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelopeInput,
} from '../../src/workroom/assignment-executor.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import { MemoryWorkroomJournal, WorkroomSequenceConflictError } from '../../src/workroom/journal.js';
import { replayWorkroom } from '../../src/workroom/kernel-state.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_C = `sha256:${'c'.repeat(64)}`;
const DIGEST_D = `sha256:${'d'.repeat(64)}`;
const DIGEST_E = `sha256:${'e'.repeat(64)}`;
const DIGEST_F = `sha256:${'f'.repeat(64)}`;

describe('AssignmentObservationIngress', () => {
  it('persists progress through the Workroom Kernel CAS authority', async () => {
    const fixture = await runningAssignment();
    const expectedSequence = (await fixture.kernel.read('project-1', 'run-1')).sequence;

    const state = await fixture.ingress.apply(fixture.envelope, {
      version: 1,
      type: 'progress',
      observationId: 'observation-progress-1',
      envelopeDigest: fixture.envelope.digest,
      progress: {
        summary: 'Implemented the CAS adapter',
        completedUnits: 1,
        totalUnits: 2,
      },
    }, expectedSequence);

    expect(state.assignments['assignment-1']).toMatchObject({
      latestProgress: {
        summary: 'Implemented the CAS adapter',
        completedUnits: 1,
        totalUnits: 2,
      },
      observationDigests: {
        'observation-progress-1': expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    });
    expect((await fixture.journal.read('run-1')).at(-1)).toMatchObject({
      type: 'assignment.progress',
      payload: {
        assignmentId: 'assignment-1',
        observationId: 'observation-progress-1',
        envelopeDigest: fixture.envelope.digest,
        progress: {
          summary: 'Implemented the CAS adapter',
          completedUnits: 1,
          totalUnits: 2,
        },
      },
    });
  });

  it('derives heartbeat renewal from the trusted Kernel clock and does not renew a duplicate', async () => {
    const fixture = await runningAssignment();
    fixture.setNow(175);
    const expectedSequence = (await fixture.kernel.read('project-1', 'run-1')).sequence;
    const heartbeat = {
      version: 1 as const,
      type: 'heartbeat' as const,
      observationId: 'observation-heartbeat-1',
      envelopeDigest: fixture.envelope.digest,
    };

    const renewed = await fixture.ingress.apply(fixture.envelope, heartbeat, expectedSequence);
    expect(renewed.assignments['assignment-1']?.leaseExpiresAt).toBe(225);

    fixture.setNow(900);
    const replayed = await fixture.ingress.apply(fixture.envelope, heartbeat, expectedSequence);
    expect(replayed.sequence).toBe(renewed.sequence);
    expect(replayed.assignments['assignment-1']?.leaseExpiresAt).toBe(225);
  });

  it('rejects heartbeat that would revive or shorten the current lease', async () => {
    const shortening = await runningAssignment();
    const shorteningState = await shortening.kernel.read('project-1', 'run-1');
    await expect(shortening.ingress.apply(shortening.envelope, {
      version: 1,
      type: 'heartbeat',
      observationId: 'observation-shortening-heartbeat',
      envelopeDigest: shortening.envelope.digest,
    }, shorteningState.sequence)).rejects.toThrow('must strictly extend');

    const expired = await runningAssignment();
    expired.setNow(200);
    const expiredState = await expired.kernel.read('project-1', 'run-1');
    await expect(expired.ingress.apply(expired.envelope, {
      version: 1,
      type: 'heartbeat',
      observationId: 'observation-expired-heartbeat',
      envelopeDigest: expired.envelope.digest,
    }, expiredState.sequence)).rejects.toThrow('cannot revive an expired lease');
  });

  it('persists immutable checkpoint and completion bindings without accepting the Task', async () => {
    const fixture = await runningAssignment();
    let expectedSequence = (await fixture.kernel.read('project-1', 'run-1')).sequence;
    const checkpointed = await fixture.ingress.apply(fixture.envelope, {
      version: 1,
      type: 'checkpoint',
      observationId: 'observation-checkpoint-1',
      envelopeDigest: fixture.envelope.digest,
      checkpoint: { ref: 'artifact:checkpoint-1', digest: DIGEST_C },
    }, expectedSequence);
    expect(checkpointed.assignments['assignment-1']).toMatchObject({
      status: 'running', checkpointRef: 'artifact:checkpoint-1', checkpointDigest: DIGEST_C,
    });

    expectedSequence = checkpointed.sequence;
    const completed = await fixture.ingress.apply(fixture.envelope, completion(
      fixture.envelope,
      'observation-completion-1',
    ), expectedSequence);
    expect(completed.assignments['assignment-1']).toMatchObject({
      status: 'execution_completed',
      reportRef: 'task-report:assignment-1:1',
      reportDigest: DIGEST_D,
      candidateRef: 'candidate:assignment-1:1',
      candidateHash: DIGEST_E,
    });
    expect(completed.tasks.build).toMatchObject({
      status: 'awaiting_acceptance',
      reportRef: 'task-report:assignment-1:1',
      reportDigest: DIGEST_D,
      candidateRef: 'candidate:assignment-1:1',
      candidateHash: DIGEST_E,
    });
    const replayed = await fixture.ingress.apply(
      fixture.envelope,
      completion(fixture.envelope, 'observation-completion-1'),
      expectedSequence,
    );
    expect(replayed.sequence).toBe(completed.sequence);
  });

  it('persists a trusted completion receipt digest through replay and rejects receipt drift', async () => {
    const fixture = await runningAssignment();
    const expectedSequence = (await fixture.kernel.read('project-1', 'run-1')).sequence;
    const completed = await fixture.ingress.apply(
      fixture.envelope,
      completion(
        fixture.envelope,
        'observation-completion-with-receipt',
        DIGEST_F,
      ),
      expectedSequence,
    );

    expect(completed.assignments['assignment-1']).toMatchObject({
      completionReceiptDigest: DIGEST_F,
    });
    expect(completed.tasks.build).toMatchObject({ completionReceiptDigest: DIGEST_F });
    const events = await fixture.journal.read('run-1');
    expect(events.at(-1)).toMatchObject({
      type: 'assignment.execution_completed',
      payload: { completionReceiptDigest: DIGEST_F },
    });
    expect(replayWorkroom(events).tasks.build).toMatchObject({
      completionReceiptDigest: DIGEST_F,
    });

    const completionEvent = events.at(-1)!;
    const driftedJournal = new MemoryWorkroomJournal();
    await expect(driftedJournal.append('run-drifted-receipt', -1, [{
      eventId: completionEvent.eventId,
      occurredAt: completionEvent.occurredAt,
      type: completionEvent.type,
      payload: { ...completionEvent.payload, completionReceiptDigest: DIGEST_A },
    }])).rejects.toThrow('observationDigest');
  });

  it('treats same observation id and payload as a durable no-op but rejects payload drift', async () => {
    const fixture = await runningAssignment();
    const expectedSequence = (await fixture.kernel.read('project-1', 'run-1')).sequence;
    const first = progress(fixture.envelope, 'observation-progress-retry', 'First payload');
    const committed = await fixture.ingress.apply(fixture.envelope, first, expectedSequence);

    await expect(fixture.ingress.apply(
      fixture.envelope,
      first,
      expectedSequence,
    )).resolves.toMatchObject({ sequence: committed.sequence });
    await expect(fixture.ingress.apply(
      fixture.envelope,
      progress(fixture.envelope, 'observation-progress-retry', 'Drifted payload'),
      committed.sequence,
    )).rejects.toThrow('observationId conflict');
  });

  it('rejects a new observation submitted against a stale Journal sequence', async () => {
    const fixture = await runningAssignment();
    const state = await fixture.kernel.read('project-1', 'run-1');
    await expect(fixture.ingress.apply(
      fixture.envelope,
      progress(fixture.envelope, 'observation-stale-sequence', 'Stale'),
      state.sequence - 1,
    )).rejects.toEqual(new WorkroomSequenceConflictError('run-1', state.sequence - 1, state.sequence));
  });

  it.each([
    ['task revision', { taskRevision: 2 }],
    ['assignment id', { assignmentId: 'assignment-forged' }],
    ['assignment revision', { assignmentRevision: 2 }],
    ['attempt', { attempt: 2 }],
    ['principal', { principalId: 'agent:intruder' }],
    ['role', { role: 'integration' as const }],
  ])('rejects an Envelope with stale %s authority', async (_name, patch) => {
    const fixture = await runningAssignment();
    const forged = reissueEnvelope(fixture.envelope, patch as Partial<AssignmentExecutionEnvelopeInput>);
    const state = await fixture.kernel.read('project-1', 'run-1');
    await expect(fixture.ingress.apply(
      forged,
      progress(forged, `observation-forged-${String(_name)}`, 'Forged'),
      state.sequence,
    )).rejects.toThrow('stale or targets another authority scope');
  });

  it('rejects a stale fence even when the Workspace reference is internally consistent', async () => {
    const fixture = await runningAssignment();
    const forged = reissueEnvelope(fixture.envelope, {
      fence: 8,
      workspace: { ...fixture.envelope.workspace, fence: 8 },
    });
    const state = await fixture.kernel.read('project-1', 'run-1');
    await expect(fixture.ingress.apply(
      forged,
      progress(forged, 'observation-forged-fence', 'Forged fence'),
      state.sequence,
    )).rejects.toThrow('stale or targets another authority scope');
  });

  it('fails closed when the trusted heartbeat clock is not finite', async () => {
    const fixture = await runningAssignment();
    fixture.setNow(Number.NaN);
    const state = await fixture.kernel.read('project-1', 'run-1');
    await expect(fixture.ingress.apply(fixture.envelope, {
      version: 1,
      type: 'heartbeat',
      observationId: 'observation-invalid-clock',
      envelopeDigest: fixture.envelope.digest,
    }, state.sequence)).rejects.toThrow('heartbeat clock must be finite');
  });

  it('rejects an Acceptance Candidate that drifts from the persisted completion candidate', async () => {
    const fixture = await runningAssignment(acceptancePolicyWithCandidate(DIGEST_F));
    const state = await fixture.kernel.read('project-1', 'run-1');
    await fixture.ingress.apply(
      fixture.envelope,
      completion(fixture.envelope, 'observation-completion-for-acceptance'),
      state.sequence,
    );

    await expect(fixture.kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build'))
      .rejects.toThrow('does not match the Executor completion candidate');
  });
});

async function runningAssignment(
  policy: WorkroomAcceptancePolicyDecisionPort = acceptancePolicy(),
): Promise<Readonly<{
  journal: MemoryWorkroomJournal;
  kernel: WorkroomKernel;
  ingress: AssignmentObservationIngress;
  envelope: AssignmentExecutionEnvelope;
  setNow(value: number): void;
}>> {
  let now = 100;
  let eventId = 0;
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({
    journal,
    now: () => now,
    createId: () => `event-${++eventId}`,
    acceptancePolicy: policy,
    assignmentHeartbeatLeaseMs: 50,
  });
  await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Observation ingress' });
  await kernel.execute('project-1', 'run-1', {
    type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 2,
  });
  await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
  const envelope = createAssignmentExecutionEnvelope({
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 1,
    assignmentId: 'assignment-1',
    assignmentRevision: 1,
    attempt: 1,
    fence: 7,
    principalId: 'agent:developer-1',
    role: 'executor',
    agentDefinition: { ref: 'agent-definition:developer:1', revision: 1, digest: DIGEST_A },
    plan: { ref: 'workflow-plan:run-1:1', revision: 1, digest: DIGEST_B },
    contextPolicy: { ref: 'context-policy:project-1:1', revision: 1, digest: DIGEST_C },
    factAnchor: { ref: 'workroom-facts:run-1:2', sequence: 2, digest: DIGEST_D },
    capabilitySnapshot: { ref: 'capability:assignment-1:1', revision: 1, digest: DIGEST_E },
    policySnapshot: { ref: 'policy:assignment-1:1', revision: 1, digest: DIGEST_F },
    workspace: {
      leaseRef: 'workspace-lease:assignment-1:1',
      mountRef: 'workspace-mount:assignment-1:1',
      baseRevision: 'base-sha-1',
      fence: 7,
    },
  });
  await kernel.execute('project-1', 'run-1', {
    type: 'claim_task',
    taskKey: 'build',
    assignmentId: 'assignment-1',
    assignmentRevision: 1,
    fence: 7,
    envelopeDigest: envelope.digest,
    owner: 'agent:developer-1',
    role: 'executor',
    leaseExpiresAt: 200,
  });
  await kernel.execute('project-1', 'run-1', {
    type: 'start_assignment', assignmentId: 'assignment-1',
  });
  return {
    journal,
    kernel,
    ingress: new AssignmentObservationIngress({ kernel }),
    envelope,
    setNow(value) { now = value; },
  };
}

function progress(
  envelope: AssignmentExecutionEnvelope,
  observationId: string,
  summary: string,
) {
  return {
    version: 1 as const,
    type: 'progress' as const,
    observationId,
    envelopeDigest: envelope.digest,
    progress: { summary },
  };
}

function completion(
  envelope: AssignmentExecutionEnvelope,
  observationId: string,
  completionReceiptDigest?: string,
) {
  return {
    version: 1 as const,
    type: 'execution_completed' as const,
    observationId,
    envelopeDigest: envelope.digest,
    completion: {
      report: { ref: 'task-report:assignment-1:1', digest: DIGEST_D },
      candidate: { ref: 'candidate:assignment-1:1', hash: DIGEST_E },
      ...(completionReceiptDigest === undefined ? {} : { completionReceiptDigest }),
    },
  };
}

function reissueEnvelope(
  envelope: AssignmentExecutionEnvelope,
  patch: Partial<AssignmentExecutionEnvelopeInput>,
): AssignmentExecutionEnvelope {
  const { version: _version, digest: _digest, ...input } = envelope;
  return createAssignmentExecutionEnvelope({ ...input, ...patch });
}

function acceptancePolicy(): WorkroomAcceptancePolicyDecisionPort {
  return {
    pinContract(input) {
      return {
        version: 1,
        id: `contract:${input.task.key}:${input.task.revision}`,
        revision: 1,
        digest: DIGEST_A,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        kind: 'task_result',
        criteria: [{ id: 'build', kind: 'deterministic', description: 'Build passes' }],
        requiredEvidence: [],
        policy: { id: 'policy-1', revision: 1, digest: DIGEST_B },
      };
    },
    decide() {
      throw new Error('Acceptance is not exercised by ingress tests');
    },
  };
}

function acceptancePolicyWithCandidate(candidateHash: string): WorkroomAcceptancePolicyDecisionPort {
  return {
    ...acceptancePolicy(),
    decide(input: WorkroomAcceptanceDecisionInput) {
      return {
        version: 1,
        disposition: 'accepted',
        route: 'auto_accept',
        candidate: {
          id: 'candidate:assignment-1:1',
          taskKey: input.task.key,
          taskRevision: input.task.revision,
          producerAssignmentId: input.assignment.id,
          producerPrincipalId: input.assignment.owner,
          reportRef: input.task.reportRef,
          hash: candidateHash,
          claimIds: ['claim-1'],
          evidenceRefs: [],
        },
        contract: input.contract,
        riskAssessment: {
          id: 'risk-1',
          candidateHash,
          tier: 'low',
          factsHash: DIGEST_A,
          assessor: 'kernel-risk-engine',
          sourceRefs: [],
        },
        checkResults: [{
          id: 'check-1',
          criterionId: 'build',
          status: 'passed',
          candidateHash,
          runner: 'ci',
          runnerVersion: 'ci@1',
          evidenceRefs: [],
        }],
        acceptedClaimIds: ['claim-1'],
        rejectedClaimIds: [],
        decidedBy: 'acceptance-policy:policy-1',
      };
    },
  };
}
