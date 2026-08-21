import { vi } from 'vitest';
import type { WorkroomAcceptancePolicyDecisionPort } from '../../src/workroom/acceptance-policy.js';
import type { WorkroomLocalAssignmentAuthorityPort } from '../../src/workroom/local-assignment-issuance.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;

describe('Kernel-owned Local Assignment issuance', () => {
  it('atomically persists the claim and exact local Envelope and replays after restart', async () => {
    const journal = new MemoryWorkroomJournal();
    const resolve = vi.fn(authority().resolveLocal);
    const kernel = new WorkroomKernel({
      journal,
      now: () => 100,
      createId: () => 'event-id',
      acceptancePolicy: acceptancePolicy(),
      localAssignmentAuthority: { resolveLocal: resolve },
    });
    await prepare(kernel);
    const request = {
      operationId: 'scheduler-decision-1',
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      agentDefinitionId: 'developer',
    };

    const preview = await kernel.previewLocalAssignment(request);
    expect(preview).toMatchObject({
      kind: 'local', assignmentRef: 'local-assignment:v1:scheduler-decision-1',
      taskRevision: 1,
    });
    const issued = await kernel.issueLocalAssignment(request);

    expect(issued.envelope).toMatchObject({
      assignmentId: 'local-assignment:v1:scheduler-decision-1',
      principalId: 'agent:developer',
      taskKey: 'build',
      attempt: 1,
      fence: 1,
      workspace: { fence: 1 },
    });
    expect((await journal.read('run-1')).slice(-2)).toEqual([
      expect.objectContaining({ type: 'assignment.claimed' }),
      expect.objectContaining({
        type: 'local_execution.requested',
        payload: expect.objectContaining({
          operationId: request.operationId,
          envelope: issued.envelope,
        }),
      }),
    ]);
    expect(resolve).toHaveBeenCalledTimes(1);

    const restarted = new WorkroomKernel({
      journal,
      now: () => 200,
      localAssignmentAuthority: {
        resolveLocal: async () => { throw new Error('must not re-resolve'); },
      },
    });
    await expect(restarted.issueLocalAssignment(request)).resolves.toEqual(issued);
    expect(await restarted.previewLocalAssignment(request)).toMatchObject({
      assignmentRef: issued.envelope.assignmentId, taskRevision: issued.envelope.taskRevision,
    });
    expect(await restarted.findLocalAssignment(request)).toEqual(issued);
    expect(await restarted.listLocalAssignmentIssuances()).toEqual([issued]);
  });

  it('does not allow the scheduler caller to inject principal, role, workspace, or Envelope fields', async () => {
    const journal = new MemoryWorkroomJournal();
    const resolve = vi.fn(authority().resolveLocal);
    const kernel = new WorkroomKernel({
      journal,
      now: () => 100,
      acceptancePolicy: acceptancePolicy(),
      localAssignmentAuthority: { resolveLocal: resolve },
    });
    await prepare(kernel);

    await expect(kernel.issueLocalAssignment({
      operationId: 'scheduler-decision-1',
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      agentDefinitionId: 'developer',
      principalId: 'forged',
    } as unknown as Parameters<WorkroomKernel['issueLocalAssignment']>[0]))
      .rejects.toThrow('forbidden identity or authority fields');
    expect(resolve).not.toHaveBeenCalled();
  });
});

async function prepare(kernel: WorkroomKernel): Promise<void> {
  await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Local build' });
  await kernel.execute('project-1', 'run-1', {
    type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 2,
  });
  await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
}

function acceptancePolicy(): WorkroomAcceptancePolicyDecisionPort {
  return {
    pinContract: input => ({
      id: `contract:${input.task.key}:${input.task.revision}`,
      revision: 1,
      digest: SHA_C,
      taskKey: input.task.key,
      taskRevision: input.task.revision,
      kind: 'task_result',
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
      principalId: 'agent:developer',
      role: 'executor',
      agentDefinitionId: 'developer',
      agentDefinition: { ref: 'agent:developer:1', revision: 1, digest: SHA_A },
      plan: { ref: 'plan:run-1:1', revision: 1, digest: SHA_B },
      contextPolicy: { ref: 'context-policy:1', revision: 1, digest: SHA_C },
      capabilitySnapshot: { ref: 'capability:assignment:1', revision: 1, digest: SHA_D },
      policySnapshot: { ref: 'profile-policy:1', revision: 1, digest: SHA_E },
      workspace: {
        leaseRef: `workspace-lease:${input.assignment.id}:${input.assignment.fence}`,
        mountRef: `sandbox:${input.assignment.id}`,
        baseRevision: 'git:base-sha',
        fence: input.assignment.fence,
      },
      contextView: { ref: 'context-view:1', hash: SHA_B },
      capabilityGrantRef: 'grant:1',
    }),
  };
}
