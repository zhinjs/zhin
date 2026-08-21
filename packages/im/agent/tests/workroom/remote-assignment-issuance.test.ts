import { describe, expect, it, vi } from 'vitest';
import type { WorkroomAcceptancePolicyDecisionPort } from '../../src/workroom/acceptance-policy.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  WORKROOM_A2A_EXTENSION_URI,
} from '../../src/workroom/remote-dispatch.js';
import type {
  WorkroomRemoteAssignmentAuthorityPort,
} from '../../src/workroom/remote-assignment-issuance.js';
import { RemoteAssignmentDispatchCommandService } from '../../src/workroom/remote-assignment-dispatch-command.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { remoteDisclosureFixture } from './remote-disclosure-fixture.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;
const SHA_F = `sha256:${'f'.repeat(64)}`;
const GIT_SHA = '1'.repeat(40);

describe('Kernel-owned Remote Assignment issuance', () => {
  it('atomically claims and persists the exact issued Envelope + dispatch intent', async () => {
    const journal = new MemoryWorkroomJournal();
    const resolve = vi.fn<WorkroomRemoteAssignmentAuthorityPort['resolve']>(async input => ({
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
        mountRef: `github:repo-1:refs/heads/zhin/assignment-${input.assignment.fence}`,
        baseRevision: GIT_SHA,
        fence: input.assignment.fence,
      },
      endpoint: {
        id: 'endpoint-1', owner: 'remote-owner', cardDigest: SHA_A,
        authBindingId: 'auth-1', workroomExtension: WORKROOM_A2A_EXTENSION_URI,
        idempotentDispatch: true, typedCompletionEnvelope: true,
        workspaceProviders: ['github_pull_request'],
      },
      contextView: { ref: 'context-view:1', hash: SHA_B },
      capabilityGrantRef: 'grant:1',
      disclosureManifest: remoteDisclosureFixture({
        assignmentId: input.assignment.id, endpointId: 'endpoint-1',
        principalId: 'agent:remote', sourceRef: 'context-view:1', sourceDigest: SHA_B,
      }),
      remoteWorkspace: {
        provider: 'github_pull_request', repositoryId: 'repo-1',
        integrationBindingId: 'github-1', baseSha: GIT_SHA,
        targetRef: 'refs/heads/main',
        branchRef: `refs/heads/zhin/assignment-${input.assignment.fence}`,
        pathScope: ['packages/im/agent'], mode: 'branch_and_pr',
        fence: input.assignment.fence,
      },
    }));
    const kernel = new WorkroomKernel({
      journal, now: () => 100, createId: () => 'event-id',
      acceptancePolicy: acceptancePolicy(),
      remoteAssignmentAuthority: { resolve },
    });
    await prepare(kernel);

    const issued = await kernel.issueRemoteAssignment({
      operationId: 'dispatch-operation-1', projectId: 'project-1', runId: 'run-1',
      taskKey: 'build',
      agentDefinitionId: 'developer', endpointId: 'endpoint-1',
    });

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', runId: 'run-1',
      task: expect.objectContaining({ key: 'build', revision: 1 }),
      assignment: expect.objectContaining({
        id: 'remote-assignment:v1:dispatch-operation-1', attempt: 1, fence: 1,
      }),
      factAnchor: expect.objectContaining({
        sequence: 2, digest: expect.stringMatching(/^sha256:/u),
      }),
    }));
    expect(issued.envelope).toMatchObject({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      assignmentId: 'remote-assignment:v1:dispatch-operation-1', attempt: 1, fence: 1,
      principalId: 'agent:developer', capabilitySnapshot: { digest: SHA_D },
    });
    expect(issued.dispatchItem.envelope).toMatchObject({
      assignmentId: issued.envelope.assignmentId,
      taskRevision: issued.envelope.taskRevision,
      attempt: issued.envelope.attempt,
      fence: issued.envelope.fence,
      acceptanceContract: { ref: 'contract:build:1' },
      capabilitySnapshot: { ref: 'capability:assignment:1', hash: SHA_D },
      endpoint: { id: 'endpoint-1' },
    });
    expect(await journal.read('run-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assignment.claimed', sequence: 3 }),
      expect.objectContaining({
        type: 'remote_dispatch.requested', sequence: 4,
        payload: expect.objectContaining({ operationId: 'dispatch-operation-1' }),
      }),
    ]));
    expect(issued.state.assignments[issued.envelope.assignmentId]).toMatchObject({
      envelopeDigest: issued.envelope.digest,
      status: 'leased',
    });
  });

  it('replays a lost response from the Kernel Journal without re-resolving generation authority', async () => {
    const journal = new MemoryWorkroomJournal();
    const authority = authorityPort();
    const first = new WorkroomKernel({
      journal, now: () => 100, createId: () => 'event-id',
      acceptancePolicy: acceptancePolicy(), remoteAssignmentAuthority: authority,
    });
    await prepare(first);
    const request = {
      operationId: 'dispatch-operation-1', projectId: 'project-1', runId: 'run-1',
      taskKey: 'build',
      agentDefinitionId: 'developer', endpointId: 'endpoint-1',
    };
    const original = await first.issueRemoteAssignment(request);
    const restarted = new WorkroomKernel({
      journal, now: () => 200,
      remoteAssignmentAuthority: { resolve: async () => { throw new Error('must not resolve'); } },
    });

    await expect(restarted.issueRemoteAssignment(request)).resolves.toEqual(original);
    await expect(restarted.issueRemoteAssignment({ ...request, endpointId: 'endpoint-drift' }))
      .rejects.toThrow('operation payload conflict');
    expect(await journal.read('run-1')).toHaveLength(5);
  });

  it('converges concurrent same-operation issuers through Journal CAS', async () => {
    const journal = new MemoryWorkroomJournal();
    const options = {
      journal, now: () => 100, acceptancePolicy: acceptancePolicy(),
      remoteAssignmentAuthority: authorityPort(),
    };
    const first = new WorkroomKernel({ ...options, createId: () => 'event-first' });
    const second = new WorkroomKernel({ ...options, createId: () => 'event-second' });
    await prepare(first);
    const request = {
      operationId: 'dispatch-operation-1', projectId: 'project-1', runId: 'run-1',
      taskKey: 'build', agentDefinitionId: 'developer', endpointId: 'endpoint-1',
    };

    const [left, right] = await Promise.all([
      first.issueRemoteAssignment(request),
      second.issueRemoteAssignment(request),
    ]);

    expect(right).toEqual(left);
    expect((await journal.read('run-1')).map(event => event.type)).toEqual([
      'run.created', 'task.planned', 'task.acceptance_pinned',
      'assignment.claimed', 'remote_dispatch.requested',
    ]);
  });

  it.each([
    { principalId: 'agent:forged' },
    { role: 'integration' },
  ])('rejects caller-supplied execution identity fields: $principalId$role', async forged => {
    const journal = new MemoryWorkroomJournal();
    const resolve = vi.fn(authorityPort().resolve);
    const kernel = new WorkroomKernel({
      journal, now: () => 100, createId: () => 'event-id',
      acceptancePolicy: acceptancePolicy(), remoteAssignmentAuthority: { resolve },
    });
    await prepare(kernel);

    await expect(kernel.issueRemoteAssignment({
      operationId: 'dispatch-operation-1', projectId: 'project-1', runId: 'run-1',
      taskKey: 'build', agentDefinitionId: 'developer', endpointId: 'endpoint-1',
      ...forged,
    } as unknown as Parameters<WorkroomKernel['issueRemoteAssignment']>[0]))
      .rejects.toThrow('forbidden identity');
    expect(resolve).not.toHaveBeenCalled();
    expect(await journal.read('run-1')).toHaveLength(3);
  });

  it('repairs Kernel dispatch intents into admission Outbox after process restart', async () => {
    const journal = new MemoryWorkroomJournal();
    const kernel = new WorkroomKernel({
      journal, now: () => 100, createId: () => 'event-id',
      acceptancePolicy: acceptancePolicy(), remoteAssignmentAuthority: authorityPort(),
    });
    await prepare(kernel);
    const admission = { admit: vi.fn(async (input) => ({
      linkId: `link:${input.envelope.assignmentId}`,
      item: input.dispatch,
    })) };
    const scheduler = { drain: vi.fn(async () => undefined) };
    const service = new RemoteAssignmentDispatchCommandService({ kernel, admission, scheduler });
    const request = {
      operationId: 'dispatch-operation-1', projectId: 'project-1', runId: 'run-1',
      taskKey: 'build',
      agentDefinitionId: 'developer', endpointId: 'endpoint-1',
    };

    const issued = await service.issue(request);

    expect(admission.admit).toHaveBeenCalledWith(expect.objectContaining({
      envelope: issued.envelope,
      linkedAt: 100,
      reconcileDeadline: 60_100,
      enqueuedAt: 100,
      dispatch: expect.objectContaining({
        assignmentId: issued.envelope.assignmentId,
        endpoint: expect.objectContaining({ id: 'endpoint-1' }),
      }),
    }));
    expect(scheduler.drain).toHaveBeenCalledTimes(1);

    admission.admit.mockClear();
    scheduler.drain.mockClear();
    const restarted = new RemoteAssignmentDispatchCommandService({ kernel, admission, scheduler });
    const recovery = await restarted.recover();
    expect(recovery).toEqual([{ operationId: 'dispatch-operation-1', status: 'admitted' }]);
    expect(admission.admit).toHaveBeenCalledTimes(1);
    expect(scheduler.drain).toHaveBeenCalledTimes(1);
  });
});

async function prepare(kernel: WorkroomKernel): Promise<void> {
  await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Remote build' });
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

function authorityPort(): WorkroomRemoteAssignmentAuthorityPort {
  return {
    resolve: async input => ({
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
        mountRef: `github:repo-1:refs/heads/zhin/assignment-${input.assignment.fence}`,
        baseRevision: GIT_SHA, fence: input.assignment.fence,
      },
      endpoint: {
        id: 'endpoint-1', owner: 'remote-owner', cardDigest: SHA_A,
        authBindingId: 'auth-1', workroomExtension: WORKROOM_A2A_EXTENSION_URI,
        idempotentDispatch: true, typedCompletionEnvelope: true,
        workspaceProviders: ['github_pull_request'],
      },
      contextView: { ref: 'context-view:1', hash: SHA_B },
      capabilityGrantRef: 'grant:1',
      disclosureManifest: remoteDisclosureFixture({
        assignmentId: input.assignment.id, endpointId: 'endpoint-1',
        principalId: 'agent:remote', sourceRef: 'context-view:1', sourceDigest: SHA_B,
      }),
      remoteWorkspace: {
        provider: 'github_pull_request', repositoryId: 'repo-1', integrationBindingId: 'github-1',
        baseSha: GIT_SHA, targetRef: 'refs/heads/main',
        branchRef: `refs/heads/zhin/assignment-${input.assignment.fence}`,
        pathScope: ['packages/im/agent'], mode: 'branch_and_pr', fence: input.assignment.fence,
      },
    }),
  };
}
