import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from '../../src/workroom/assignment-executor.js';
import {
  createRemoteExecutionLink,
  MemoryRemoteCallbackInboxRepository,
  type RemoteCallbackMessage,
  type RemoteExecutionLink,
} from '../../src/workroom/remote-callback-inbox.js';
import {
  createRemoteExecutionLinkRecord,
  MemoryRemoteExecutionLinkRegistryRepository,
} from '../../src/workroom/remote-callback-application.js';
import {
  WorkroomRemoteCallbackGateway,
} from '../../src/workroom/remote-callback-gateway.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;
const SHA_F = `sha256:${'f'.repeat(64)}`;

describe('WorkroomRemoteCallbackGateway', () => {
  it('authenticates the transport credential before parsing or writing callback state', async () => {
    const linkRegistry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    const read = vi.spyOn(linkRegistry, 'read');
    const append = vi.spyOn(inboxRepository, 'append');
    const runOnce = vi.fn();
    const gateway = new WorkroomRemoteCallbackGateway({
      authRegistry: {
        authenticate() {
          throw new Error('credential rejected');
        },
      },
      linkRegistry,
      inboxRepository,
      application: { runOnce },
      clock: { now: () => 1_100 },
      receiptIds: { create: () => 'gateway-receipt-1' },
      maxBodyBytes: 4_096,
      maxSequenceGap: 4,
    });

    await expect(gateway.handle({ credential: 'wrong', body: '{invalid' }, new AbortController().signal))
      .rejects.toThrow('credential rejected');
    expect(read).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('builds trusted Gateway authority and triggers application after durable Inbox receive', async () => {
    const envelope = assignmentEnvelope();
    const link = remoteLink(envelope);
    const linkRegistry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    await linkRegistry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
    const runOnce = vi.fn(async () => ({ status: 'noop' as const, reason: 'inbox_not_registered' as const }));
    const receiptCreate = vi.fn(() => 'gateway-receipt-1');
    const gateway = new WorkroomRemoteCallbackGateway({
      authRegistry: { authenticate: () => authority(link) },
      linkRegistry,
      inboxRepository,
      application: { runOnce },
      clock: { now: () => 1_100 },
      receiptIds: { create: receiptCreate },
      maxBodyBytes: 4_096,
      maxSequenceGap: 4,
    });
    const body = JSON.stringify(callbackMessage(link));

    await expect(gateway.handle({ credential: 'secret', body }, new AbortController().signal))
      .resolves.toMatchObject({ duplicate: false, application: { status: 'noop' } });
    await expect(inboxRepository.read(link.id)).resolves.toMatchObject({
      accepted: [{
        eventId: 'event-progress-1',
        gatewayReceipt: {
          receiptId: 'gateway-receipt-1',
          source: 'push',
          receivedAt: 1_100,
          endpointId: link.endpoint.id,
          cardDigest: link.endpoint.cardDigest,
          authBindingId: link.endpoint.authBindingId,
        },
      }],
    });
    expect(runOnce).toHaveBeenCalledWith(link.id, expect.any(AbortSignal));
    expect(receiptCreate).toHaveBeenCalledWith(expect.objectContaining({
      linkId: link.id,
      eventId: 'event-progress-1',
      receivedAt: 1_100,
    }));
  });

  it('rejects authenticated endpoint drift even when callback claims echo that authority', async () => {
    const envelope = assignmentEnvelope();
    const link = remoteLink(envelope);
    const linkRegistry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    await linkRegistry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
    const runOnce = vi.fn();
    const forgedClaim = callbackMessage(link);
    const body = JSON.stringify({
      ...forgedClaim,
      claimedEndpoint: {
        endpointId: 'a2a-forged',
        cardDigest: SHA_F,
        authBindingId: 'auth-binding-forged',
      },
    });
    const gateway = new WorkroomRemoteCallbackGateway({
      authRegistry: {
        authenticate: () => ({
          ...authority(link),
          endpointId: 'a2a-forged',
          cardDigest: SHA_F,
          authBindingId: 'auth-binding-forged',
        }),
      },
      linkRegistry,
      inboxRepository,
      application: { runOnce },
      clock: { now: () => 1_100 },
      receiptIds: { create: () => 'gateway-receipt-forged' },
      maxBodyBytes: 4_096,
      maxSequenceGap: 4,
    });

    await expect(gateway.handle({ credential: 'secret', body }, new AbortController().signal))
      .rejects.toThrow('authenticated endpointId does not match Link');
    await expect(inboxRepository.read(link.id)).resolves.toBeUndefined();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'oversize body',
      maxBodyBytes: 8,
      body: JSON.stringify(callbackMessage(remoteLink(assignmentEnvelope()))),
      error: 'exceeds maxBodyBytes',
    },
    {
      name: 'body-owned Gateway receipt',
      maxBodyBytes: 8_192,
      body: JSON.stringify({
        ...callbackMessage(remoteLink(assignmentEnvelope())),
        gatewayReceipt: { endpointId: 'forged' },
      }),
      error: 'forbidden field gatewayReceipt',
    },
  ])('rejects $name before writing Inbox state', async ({ maxBodyBytes, body, error }) => {
    const envelope = assignmentEnvelope();
    const link = remoteLink(envelope);
    const linkRegistry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    await linkRegistry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
    const runOnce = vi.fn();
    const gateway = new WorkroomRemoteCallbackGateway({
      authRegistry: { authenticate: () => authority(link) },
      linkRegistry,
      inboxRepository,
      application: { runOnce },
      clock: { now: () => 1_100 },
      receiptIds: { create: () => 'gateway-receipt-invalid' },
      maxBodyBytes,
      maxSequenceGap: 4,
    });

    await expect(gateway.handle({ credential: 'secret', body }, new AbortController().signal))
      .rejects.toThrow(error);
    await expect(inboxRepository.read(link.id)).resolves.toBeUndefined();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('treats exact callback retry as Inbox no-op and still retriggers idempotent application', async () => {
    const envelope = assignmentEnvelope();
    const link = remoteLink(envelope);
    const linkRegistry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    await linkRegistry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
    const runOnce = vi.fn(async () => ({ status: 'noop' as const, reason: 'inbox_not_registered' as const }));
    let receipt = 0;
    const gateway = new WorkroomRemoteCallbackGateway({
      authRegistry: { authenticate: () => authority(link) },
      linkRegistry,
      inboxRepository,
      application: { runOnce },
      clock: { now: () => 1_100 },
      receiptIds: { create: () => `gateway-receipt-${++receipt}` },
      maxBodyBytes: 4_096,
      maxSequenceGap: 4,
    });
    const request = { credential: 'secret', body: JSON.stringify(callbackMessage(link)) };

    await expect(gateway.handle(request, new AbortController().signal))
      .resolves.toMatchObject({ duplicate: false });
    await expect(gateway.handle(request, new AbortController().signal))
      .resolves.toMatchObject({ duplicate: true });
    await expect(inboxRepository.read(link.id)).resolves.toMatchObject({
      accepted: [{ eventId: 'event-progress-1' }],
    });
    expect((await inboxRepository.read(link.id))?.accepted).toHaveLength(1);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the same endpoint event identity changes callback body', async () => {
    const envelope = assignmentEnvelope();
    const link = remoteLink(envelope);
    const linkRegistry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    await linkRegistry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
    const runOnce = vi.fn(async () => ({ status: 'noop' as const, reason: 'inbox_not_registered' as const }));
    const gateway = new WorkroomRemoteCallbackGateway({
      authRegistry: { authenticate: () => authority(link) },
      linkRegistry,
      inboxRepository,
      application: { runOnce },
      clock: { now: () => 1_100 },
      receiptIds: { create: () => 'gateway-receipt-drift' },
      maxBodyBytes: 4_096,
      maxSequenceGap: 4,
    });
    const first = callbackMessage(link);
    await gateway.handle({ credential: 'secret', body: JSON.stringify(first) }, new AbortController().signal);
    const drifted = {
      ...first,
      payload: { type: 'progress', progress: { summary: 'Drifted callback body' } },
    };

    await expect(gateway.handle({
      credential: 'secret',
      body: JSON.stringify(drifted),
    }, new AbortController().signal)).rejects.toThrow('endpoint/event identity payload drift');
    expect((await inboxRepository.read(link.id))?.accepted).toHaveLength(1);
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it('retries application after a crash without duplicating the durable callback', async () => {
    const envelope = assignmentEnvelope();
    const link = remoteLink(envelope);
    const linkRegistry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    await linkRegistry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
    let crash = true;
    const runOnce = vi.fn(async () => {
      if (crash) {
        crash = false;
        throw new Error('application crashed after Inbox commit');
      }
      return { status: 'noop' as const, reason: 'inbox_not_registered' as const };
    });
    const gateway = new WorkroomRemoteCallbackGateway({
      authRegistry: { authenticate: () => authority(link) },
      linkRegistry,
      inboxRepository,
      application: { runOnce },
      clock: { now: () => 1_100 },
      receiptIds: { create: () => 'gateway-receipt-crash' },
      maxBodyBytes: 4_096,
      maxSequenceGap: 4,
    });
    const request = { credential: 'secret', body: JSON.stringify(callbackMessage(link)) };

    await expect(gateway.handle(request, new AbortController().signal))
      .rejects.toThrow('application crashed after Inbox commit');
    expect((await inboxRepository.read(link.id))?.accepted).toHaveLength(1);
    await expect(gateway.handle(request, new AbortController().signal))
      .resolves.toMatchObject({ duplicate: true });
    expect((await inboxRepository.read(link.id))?.accepted).toHaveLength(1);
    expect(runOnce).toHaveBeenCalledTimes(2);
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
    agentDefinition: { ref: 'agent:developer:1', revision: 1, digest: SHA_A },
    plan: { ref: 'plan:run-1:1', revision: 1, digest: SHA_B },
    contextPolicy: { ref: 'context-policy:1', revision: 1, digest: SHA_C },
    factAnchor: { ref: 'facts:run-1:2', sequence: 2, digest: SHA_D },
    capabilitySnapshot: { ref: 'capabilities:assignment-1:1', revision: 1, digest: SHA_E },
    policySnapshot: { ref: 'policy:assignment-1:1', revision: 1, digest: SHA_F },
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
    dispatchEnvelopeDigest: SHA_B,
    endpoint: { id: 'a2a-primary', cardDigest: SHA_A, authBindingId: 'auth-binding-1' },
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

function authority(link: RemoteExecutionLink) {
  return {
    version: 1 as const,
    endpointId: link.endpoint.id,
    tenantId: 'tenant-1',
    cardDigest: link.endpoint.cardDigest,
    authBindingId: link.endpoint.authBindingId,
    trustDomain: 'workroom.example',
    generation: 1,
    extensionDigest: SHA_C,
    credentialIdDigest: SHA_D,
  };
}

function callbackMessage(link: RemoteExecutionLink): RemoteCallbackMessage {
  return {
    version: 1,
    callbackSequence: 1,
    eventId: 'event-progress-1',
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
    payload: { type: 'progress', progress: { summary: 'Gateway accepted callback' } },
  };
}
