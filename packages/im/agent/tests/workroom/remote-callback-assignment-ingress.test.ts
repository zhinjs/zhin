import { describe, expect, it } from 'vitest';
import type { WorkroomAcceptancePolicyDecisionPort } from '../../src/workroom/acceptance-policy.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from '../../src/workroom/assignment-executor.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  MemoryRemoteCallbackInboxRepository,
  RemoteCallbackInbox,
  createRemoteExecutionLink,
  digestRemoteCallbackMessage,
  type RemoteCallbackEnvelope,
  type RemoteCallbackMessage,
  type RemoteExecutionLink,
} from '../../src/workroom/remote-callback-inbox.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_C = `sha256:${'c'.repeat(64)}`;
const DIGEST_D = `sha256:${'d'.repeat(64)}`;
const DIGEST_E = `sha256:${'e'.repeat(64)}`;
const DIGEST_F = `sha256:${'f'.repeat(64)}`;

describe('Remote Callback to Workroom Kernel integration', () => {
  it('projects a typed remote completion through the sole Kernel CAS without accepting the Task', async () => {
    const journal = new MemoryWorkroomJournal();
    let eventId = 0;
    const kernel = new WorkroomKernel({
      journal,
      now: () => 1_000,
      createId: () => `event-${++eventId}`,
      acceptancePolicy: acceptancePolicy(),
    });
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Remote execution' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build remotely', required: true, maxAttempts: 2,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    const envelope = assignmentEnvelope();
    await kernel.execute('project-1', 'run-1', {
      type: 'claim_task',
      taskKey: envelope.taskKey,
      assignmentId: envelope.assignmentId,
      assignmentRevision: envelope.assignmentRevision,
      fence: envelope.fence,
      envelopeDigest: envelope.digest,
      owner: envelope.principalId,
      role: envelope.role,
      leaseExpiresAt: 2_000,
    });
    await kernel.execute('project-1', 'run-1', {
      type: 'start_assignment', assignmentId: envelope.assignmentId,
    });

    const link = remoteLink(envelope);
    const inbox = new RemoteCallbackInbox(
      new MemoryRemoteCallbackInboxRepository(),
      link,
      { maxSequenceGap: 4 },
    );
    const received = await inbox.receive(completionCallback(link), -1);
    expect(received.observation?.type).toBe('execution_completed');
    const completionReceiptDigest = received.observation?.type === 'execution_completed'
      ? received.observation.completion.completionReceiptDigest
      : undefined;
    expect(completionReceiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const before = await kernel.read(envelope.projectId, envelope.runId);
    const state = await new AssignmentObservationIngress({ kernel }).apply(
      envelope,
      received.observation!,
      before.sequence,
    );

    expect(state.assignments[envelope.assignmentId]).toMatchObject({
      status: 'execution_completed',
      reportRef: 'report:assignment-1',
      reportDigest: DIGEST_D,
      candidateRef: 'changeset:assignment-1',
      candidateHash: DIGEST_E,
      completionReceiptDigest,
    });
    expect(state.tasks.build).toMatchObject({
      status: 'awaiting_acceptance',
      candidateHash: DIGEST_E,
      completionReceiptDigest,
    });
    expect(state.tasks.build?.status).not.toBe('accepted');
    expect((await journal.read(envelope.runId)).at(-1)?.type)
      .toBe('assignment.execution_completed');
  });
});

function assignmentEnvelope(): AssignmentExecutionEnvelope {
  return createAssignmentExecutionEnvelope({
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 1,
    assignmentId: 'assignment-1',
    assignmentRevision: 1,
    attempt: 1,
    fence: 7,
    principalId: 'agent:remote-developer',
    role: 'executor',
    agentDefinition: { ref: 'agent:developer:1', revision: 1, digest: DIGEST_A },
    plan: { ref: 'plan:run-1:1', revision: 1, digest: DIGEST_B },
    contextPolicy: { ref: 'context-policy:1', revision: 1, digest: DIGEST_C },
    factAnchor: { ref: 'facts:run-1:2', sequence: 2, digest: DIGEST_D },
    capabilitySnapshot: { ref: 'capabilities:assignment-1:1', revision: 1, digest: DIGEST_E },
    policySnapshot: { ref: 'policy:assignment-1:1', revision: 1, digest: DIGEST_F },
    workspace: {
      leaseRef: 'workspace-lease:assignment-1:1',
      mountRef: 'workspace-mount:assignment-1:1',
      baseRevision: '1'.repeat(40),
      fence: 7,
    },
  });
}

function remoteLink(envelope: AssignmentExecutionEnvelope): RemoteExecutionLink {
  return createRemoteExecutionLink({
    linkedAt: 1_000,
    reconcileDeadline: 10_000,
    projectId: envelope.projectId,
    runId: envelope.runId,
    taskKey: envelope.taskKey,
    taskRevision: envelope.taskRevision,
    assignmentId: envelope.assignmentId,
    assignmentRevision: envelope.assignmentRevision,
    attempt: envelope.attempt,
    fence: envelope.fence,
    assignmentEnvelopeDigest: envelope.digest,
    dispatchId: 'dispatch-1',
    messageId: 'message-1',
    dispatchEnvelopeDigest: DIGEST_B,
    endpoint: { id: 'a2a-primary', cardDigest: DIGEST_A, authBindingId: 'auth-binding-1' },
    remoteTaskId: 'remote-task-1',
    remoteContextId: 'remote-context-1',
    workspace: {
      provider: 'github_pull_request',
      repositoryId: 'github:zhinjs/zhin',
      integrationBindingId: 'github-app-1',
      baseSha: '1'.repeat(40),
      targetRef: 'refs/heads/main',
      branchRef: 'refs/heads/workroom/assignment-1/attempt-1-fence-7',
      pathScope: ['packages/im/agent'],
      mode: 'branch_and_pr',
      fence: envelope.fence,
    },
  });
}

function completionCallback(link: RemoteExecutionLink): RemoteCallbackEnvelope {
  const message: RemoteCallbackMessage = {
    version: 1,
    callbackSequence: 1,
    eventId: 'remote-event-completed',
    linkId: link.id,
    projectId: link.projectId,
    runId: link.runId,
    taskKey: link.taskKey,
    taskRevision: link.taskRevision,
    assignmentId: link.assignmentId,
    assignmentRevision: link.assignmentRevision,
    attempt: link.attempt,
    fence: link.fence,
    assignmentEnvelopeDigest: link.assignmentEnvelopeDigest,
    dispatchId: link.dispatchId,
    messageId: link.messageId,
    dispatchEnvelopeDigest: link.dispatchEnvelopeDigest,
    claimedEndpoint: {
      endpointId: link.endpoint.id,
      cardDigest: link.endpoint.cardDigest,
      authBindingId: link.endpoint.authBindingId,
    },
    remoteTaskId: link.remoteTaskId,
    remoteContextId: link.remoteContextId,
    payload: {
      type: 'execution_completed',
      completion: {
        report: { ref: 'report:assignment-1', digest: DIGEST_D },
        candidate: { ref: 'changeset:assignment-1', hash: DIGEST_E },
        claims: [{ ref: 'claim:build-passes', digest: DIGEST_D }],
        evidence: [{ ref: 'evidence:test-run', digest: DIGEST_E }],
        workspaceReceipt: {
          ...link.workspace,
          headSha: '2'.repeat(40),
          pullRequestRef: 'github-pr:zhinjs/zhin:101',
          pullRequestHash: DIGEST_F,
        },
      },
    },
  };
  return {
    ...message,
    gatewayReceipt: {
      receiptId: 'gateway-receipt-completed',
      source: 'push',
      receivedAt: 1_100,
      endpointId: link.endpoint.id,
      cardDigest: link.endpoint.cardDigest,
      authBindingId: link.endpoint.authBindingId,
      callbackDigest: digestRemoteCallbackMessage(message),
    },
  };
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
      throw new Error('Remote completion must not invoke Acceptance automatically');
    },
  };
}
