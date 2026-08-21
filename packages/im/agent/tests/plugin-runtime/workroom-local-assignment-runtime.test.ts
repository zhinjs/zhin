import { vi } from 'vitest';
import type { WorkroomAcceptancePolicyDecisionPort } from '../../src/workroom/acceptance-policy.js';
import { createAssignmentExecutionEnvelope, type AssignmentExecutorPort } from '../../src/workroom/assignment-executor.js';
import type { WorkroomLocalAssignmentAuthorityPort } from '../../src/workroom/local-assignment-issuance.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { WorkroomLocalAssignmentRuntime } from '../../src/plugin-runtime/workroom-local-assignment-runtime.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;

describe('Workroom Local Assignment Runtime', () => {
  it('recovers the durable local execution request and applies progress/completion only through ingress CAS', async () => {
    const { kernel } = await harness();
    const issued = await kernel.issueLocalAssignment(request());
    const executor: AssignmentExecutorPort = {
      async *execute(envelope) {
        yield {
          version: 1, type: 'progress', observationId: 'local-progress',
          envelopeDigest: envelope.digest, progress: { summary: 'implemented', completedUnits: 1, totalUnits: 1 },
        };
        yield {
          version: 1, type: 'execution_completed', observationId: 'local-complete',
          envelopeDigest: envelope.digest,
          completion: {
            report: { ref: 'workroom-report:1', digest: SHA_A },
            candidate: { ref: 'candidate:1', hash: SHA_B },
          },
        };
      },
    };
    const runtime = new WorkroomLocalAssignmentRuntime({ kernel, executor, now: () => 101 });

    await expect(runtime.drain()).resolves.toEqual({ started: 1, recovered: 0 });
    const state = await kernel.read('project-1', 'run-1');
    expect(state.assignments[issued.envelope.assignmentId]).toMatchObject({
      status: 'execution_completed',
      latestProgress: { summary: 'implemented' },
      reportRef: 'workroom-report:1',
    });
    expect(state.tasks.build?.status).toBe('awaiting_acceptance');
  });

  it('never replays a previously started local model turn and expires it as outcome_unknown', async () => {
    let now = 100;
    const { kernel } = await harness(() => now);
    const issued = await kernel.issueLocalAssignment(request());
    await kernel.execute('project-1', 'run-1', {
      type: 'start_assignment', assignmentId: issued.envelope.assignmentId,
    });
    now = 131;
    const execute = vi.fn<AssignmentExecutorPort['execute']>();
    const runtime = new WorkroomLocalAssignmentRuntime({
      kernel,
      executor: { execute },
      now: () => now,
    });

    await expect(runtime.drain()).resolves.toEqual({ started: 0, recovered: 1 });
    expect(execute).not.toHaveBeenCalled();
    expect((await kernel.read('project-1', 'run-1')).assignments[issued.envelope.assignmentId])
      .toMatchObject({ status: 'lost', outcome: 'outcome_unknown' });
  });

  it('rejects a persisted request whose Envelope no longer matches the claimed fence', async () => {
    const { kernel } = await harness();
    const issued = await kernel.issueLocalAssignment(request());
    const { version: _version, digest: _digest, ...envelopeInput } = issued.envelope;
    const forged = createAssignmentExecutionEnvelope({
      ...envelopeInput,
      assignmentId: 'local-assignment:v1:forged',
      fence: 2,
      workspace: { ...issued.envelope.workspace, fence: 2 },
    });
    const execute = vi.fn<AssignmentExecutorPort['execute']>();
    const runtime = new WorkroomLocalAssignmentRuntime({ kernel, executor: { execute } });

    await expect(runtime.execute(forged)).rejects.toThrow('stale or targets another authority scope');
    expect(execute).not.toHaveBeenCalled();
  });
});

async function harness(now: () => number = () => 100) {
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({
    journal,
    now,
    assignmentHeartbeatLeaseMs: 30,
    acceptancePolicy: acceptancePolicy(),
    localAssignmentAuthority: authority(),
  });
  await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Local build' });
  await kernel.execute('project-1', 'run-1', {
    type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 2,
  });
  await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
  return { journal, kernel };
}

function request() {
  return {
    operationId: 'scheduler-decision-1', projectId: 'project-1', runId: 'run-1',
    taskKey: 'build', agentDefinitionId: 'developer',
  };
}

function acceptancePolicy(): WorkroomAcceptancePolicyDecisionPort {
  return {
    pinContract: input => ({
      id: `contract:${input.task.key}:${input.task.revision}`, revision: 1, digest: SHA_C,
      taskKey: input.task.key, taskRevision: input.task.revision, kind: 'task_result',
      policy: { id: 'acceptance-policy', revision: 1, digest: SHA_B },
      criteria: [{ id: 'tests', kind: 'deterministic', description: 'Tests pass' }],
      requiredEvidence: [],
    }),
    decide: () => { throw new Error('not used'); },
  };
}

function authority(): WorkroomLocalAssignmentAuthorityPort {
  return {
    resolveLocal: async input => ({
      principalId: 'agent:developer', role: 'executor', agentDefinitionId: 'developer',
      agentDefinition: { ref: 'agent:developer:1', revision: 1, digest: SHA_A },
      plan: { ref: 'plan:run-1:1', revision: 1, digest: SHA_B },
      contextPolicy: { ref: 'context-policy:1', revision: 1, digest: SHA_C },
      capabilitySnapshot: { ref: 'capability:assignment:1', revision: 1, digest: SHA_D },
      policySnapshot: { ref: 'profile-policy:1', revision: 1, digest: SHA_E },
      workspace: {
        leaseRef: `lease:${input.assignment.id}`, mountRef: `sandbox:${input.assignment.id}`,
        baseRevision: 'git:base-sha', fence: input.assignment.fence,
      },
      contextView: { ref: 'context-view:1', hash: SHA_B }, capabilityGrantRef: 'grant:1',
    }),
  };
}
