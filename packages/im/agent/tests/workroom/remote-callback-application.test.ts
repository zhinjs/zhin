import {
  link as fsLink,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from '../../src/workroom/assignment-executor.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import type { WorkroomAcceptancePolicyDecisionPort } from '../../src/workroom/acceptance-policy.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  createRemoteExecutionLink,
  digestRemoteCallbackMessage,
  FileRemoteCallbackInboxRepository,
  MemoryRemoteCallbackInboxRepository,
  RemoteCallbackInbox,
  type RemoteCallbackMessage,
  type RemoteExecutionLink,
} from '../../src/workroom/remote-callback-inbox.js';
import {
  FileRemoteExecutionLinkRegistryRepository,
  MemoryRemoteExecutionLinkRegistryRepository,
  RemoteCallbackApplication,
  createRemoteExecutionLinkRecord,
  type RemoteExecutionLinkRegistryFileSystem,
  type RemoteExecutionLinkRegistryRepository,
} from '../../src/workroom/remote-callback-application.js';
import {
  digestRemoteCallbackPollSnapshot,
  type RemoteCallbackPollPort,
} from '../../src/workroom/remote-callback-reconciliation-worker.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;
const SHA_F = `sha256:${'f'.repeat(64)}`;

describe('Remote Execution Link Registry', () => {
  const contract = (
    name: string,
    create: () => Promise<Readonly<{
      repository: RemoteExecutionLinkRegistryRepository;
      restart(): RemoteExecutionLinkRegistryRepository;
      cleanup(): Promise<void>;
    }>>,
  ): void => {
    describe(name, () => {
      it('preregisters the exact immutable Assignment Envelope and survives restart', async () => {
        const fixture = await create();
        try {
          const envelope = assignmentEnvelope();
          const link = remoteLink(envelope);
          const record = createRemoteExecutionLinkRecord(link, envelope);

          await expect(fixture.repository.preregister(record, -1)).resolves.toEqual(record);
          await expect(fixture.repository.preregister(record, -1)).resolves.toEqual(record);
          await expect(fixture.restart().read(link.id)).resolves.toEqual(record);

          const { version: _version, digest: _digest, ...envelopeInput } = envelope;
          const driftedEnvelope = createAssignmentExecutionEnvelope({
            ...envelopeInput,
            principalId: 'agent:forged',
          });
          expect(() => createRemoteExecutionLinkRecord(link, driftedEnvelope))
            .toThrow('Envelope digest');
        } finally {
          await fixture.cleanup();
        }
      });

      it('uses create-only CAS and fails closed on same-identity registration drift', async () => {
        const fixture = await create();
        try {
          const envelope = assignmentEnvelope();
          const link = remoteLink(envelope);
          const first = createRemoteExecutionLinkRecord(link, envelope);
          const { version: _version, id: _id, digest: _digest, ...linkInput } = link;
          const drifted = createRemoteExecutionLinkRecord(createRemoteExecutionLink({
            ...linkInput,
            endpoint: { ...link.endpoint, id: 'a2a-drifted' },
          }), envelope);

          const results = await Promise.allSettled([
            fixture.repository.preregister(first, -1),
            fixture.repository.preregister(drifted, -1),
          ]);
          expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
          expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
          await expect(fixture.restart().read(link.id)).resolves.toEqual(
            results.find(result => result.status === 'fulfilled')!.value,
          );

          const another = assignmentEnvelope('assignment-3');
          await expect(fixture.repository.preregister(
            createRemoteExecutionLinkRecord(remoteLink(another), another),
            0,
          )).rejects.toThrow('sequence conflict');
        } finally {
          await fixture.cleanup();
        }
      });

      it('lists every registered Link in deterministic identity order for startup recovery', async () => {
        const fixture = await create();
        try {
          const secondEnvelope = assignmentEnvelope('assignment-2');
          const firstEnvelope = assignmentEnvelope();
          const second = createRemoteExecutionLinkRecord(remoteLink(secondEnvelope), secondEnvelope);
          const first = createRemoteExecutionLinkRecord(remoteLink(firstEnvelope), firstEnvelope);
          await fixture.repository.preregister(second, -1);
          await fixture.repository.preregister(first, -1);

          await expect(fixture.restart().listRegistered()).resolves.toEqual([first, second]);
        } finally {
          await fixture.cleanup();
        }
      });
    });
  };

  contract('Memory adapter', async () => {
    const repository = new MemoryRemoteExecutionLinkRegistryRepository();
    return { repository, restart: () => repository, cleanup: async () => {} };
  });

  contract('File adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'remote-link-registry-'));
    return {
      repository: new FileRemoteExecutionLinkRegistryRepository(directory),
      restart: () => new FileRemoteExecutionLinkRegistryRepository(directory),
      cleanup: async () => { await rm(directory, { recursive: true, force: true }); },
    };
  });

  it('fails closed when a durable File record is corrupt after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'remote-link-registry-corrupt-'));
    try {
      const envelope = assignmentEnvelope();
      const link = remoteLink(envelope);
      const repository = new FileRemoteExecutionLinkRegistryRepository(directory);
      await repository.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
      const [name] = await readdir(directory);
      await writeFile(join(directory, name!), '{"truncated":', 'utf8');

      await expect(new FileRemoteExecutionLinkRegistryRepository(directory).read(link.id))
        .rejects.toThrow('durable record is corrupt');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails before publication when the new leaf parent fsync fails, then retries durably', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'remote-link-registry-parent-'));
    const directory = join(parent, 'registry');
    const envelope = assignmentEnvelope();
    const link = remoteLink(envelope);
    const record = createRemoteExecutionLinkRecord(link, envelope);
    const trace: string[] = [];
    const real = tracingFileSystem(trace);
    const failing: RemoteExecutionLinkRegistryFileSystem = {
      ...real,
      async open(path, flags) {
        const handle = await real.open(path, flags);
        if (path !== parent || flags !== 'r') return handle;
        return {
          ...handle,
          async sync() {
            trace.push('injected-parent-sync-failure');
            throw new Error('injected parent sync failure');
          },
        };
      },
    };
    try {
      await expect(new FileRemoteExecutionLinkRegistryRepository(directory, failing)
        .preregister(record, -1)).rejects.toThrow('parent sync failure');
      expect(trace).not.toContain('open:wx');
      await expect(readdir(directory)).resolves.toEqual([]);

      const retried = new FileRemoteExecutionLinkRegistryRepository(directory);
      await expect(retried.preregister(record, -1)).resolves.toEqual(record);
      await expect(new FileRemoteExecutionLinkRegistryRepository(directory).read(link.id))
        .resolves.toEqual(record);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('does not recursively create an unverified durable parent chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remote-link-registry-missing-parent-'));
    const directory = join(root, 'missing', 'registry');
    const envelope = assignmentEnvelope();
    try {
      await expect(new FileRemoteExecutionLinkRegistryRepository(directory).preregister(
        createRemoteExecutionLinkRecord(remoteLink(envelope), envelope),
        -1,
      )).rejects.toThrow('pre-existing durable parent');
      await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists only Links whose durable Inbox requires reconciliation', async () => {
    const registry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    const firstEnvelope = assignmentEnvelope();
    const firstLink = remoteLink(firstEnvelope);
    const secondEnvelope = assignmentEnvelope('assignment-2');
    const secondLink = remoteLink(secondEnvelope);
    await registry.preregister(createRemoteExecutionLinkRecord(firstLink, firstEnvelope), -1);
    await registry.preregister(createRemoteExecutionLinkRecord(secondLink, secondEnvelope), -1);
    await new RemoteCallbackInbox(inboxRepository, firstLink, { maxSequenceGap: 4 })
      .receive(callbackGap(firstLink), -1);

    await expect(registry.listReconcileRequired(inboxRepository)).resolves.toEqual([
      createRemoteExecutionLinkRecord(firstLink, firstEnvelope),
    ]);
  });
});

describe('RemoteCallbackApplication', () => {
  it('reconciles accepted observations through the registered Envelope and replays terminal restart safely', async () => {
    const { kernel, envelope } = await runningAssignment();
    const link = remoteLink(envelope);
    const registry = new MemoryRemoteExecutionLinkRegistryRepository();
    const inboxRepository = new MemoryRemoteCallbackInboxRepository();
    await registry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
    const inbox = new RemoteCallbackInbox(inboxRepository, link, { maxSequenceGap: 4 });
    await inbox.receive(callback(link, 2, 'completion', 'push'), -1);
    const missing = callback(link, 1, 'progress', 'poll');
    const snapshotInput = {
      version: 1 as const,
      endpointId: link.endpoint.id,
      cardDigest: link.endpoint.cardDigest,
      authBindingId: link.endpoint.authBindingId,
      linkId: link.id,
      fromCursor: 0,
      snapshotCursor: 2,
      polledAt: 1_300,
      callbacks: [missing],
    };
    const poll = vi.fn<RemoteCallbackPollPort['poll']>(async request => {
      expect(Object.isFrozen(request)).toBe(true);
      return {
        ...snapshotInput,
        digest: digestRemoteCallbackPollSnapshot(snapshotInput),
      };
    });
    const options = {
      registry,
      inboxRepository,
      maxSequenceGap: 4,
      pollPort: { poll },
      reconciliationClock: { now: () => 1_200 },
      observationIngress: new AssignmentObservationIngress({ kernel }),
      runState: { read: kernel.read.bind(kernel) },
    };
    const application = new RemoteCallbackApplication(options);

    await expect(application.runOnce(link.id, new AbortController().signal)).resolves.toMatchObject({
      status: 'applied',
      reconciliation: { status: 'reconciled' },
      submittedObservationIds: [
        `event-progress:${link.assignmentId}`,
        `event-completion:${link.assignmentId}`,
      ],
    });
    const completed = await kernel.read(envelope.projectId, envelope.runId);
    expect(completed.assignments[envelope.assignmentId]).toMatchObject({
      status: 'execution_completed',
      reportRef: `report:${envelope.assignmentId}`,
      candidateRef: `candidate:${envelope.assignmentId}`,
    });
    expect(completed.tasks[envelope.taskKey]).toMatchObject({ status: 'awaiting_acceptance' });

    const restarted = new RemoteCallbackApplication(options);
    await expect(restarted.runOnce(link.id, new AbortController().signal)).resolves.toMatchObject({
      status: 'applied',
      reconciliation: { status: 'noop', reason: 'not_required' },
    });
    expect((await kernel.read(envelope.projectId, envelope.runId)).sequence).toBe(completed.sequence);
    expect(poll).toHaveBeenCalledOnce();
  });

  it('does not poll or apply authority for an unknown Link', async () => {
    const poll = vi.fn<RemoteCallbackPollPort['poll']>();
    const apply = vi.fn();
    const application = new RemoteCallbackApplication({
      registry: new MemoryRemoteExecutionLinkRegistryRepository(),
      inboxRepository: new MemoryRemoteCallbackInboxRepository(),
      maxSequenceGap: 4,
      pollPort: { poll },
      reconciliationClock: { now: () => 1_200 },
      observationIngress: { apply },
      runState: { read: vi.fn() },
    });

    await expect(application.runOnce('unknown-link', new AbortController().signal))
      .resolves.toEqual({ status: 'noop', reason: 'link_not_registered' });
    expect(poll).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('discovers a durable accepted callback after a crash before Kernel application', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remote-callback-application-crash-'));
    const registryDirectory = join(root, 'links');
    const inboxDirectory = join(root, 'inbox');
    try {
      const { kernel, envelope } = await runningAssignment();
      const link = remoteLink(envelope);
      const registry = new FileRemoteExecutionLinkRegistryRepository(registryDirectory);
      const inboxRepository = new FileRemoteCallbackInboxRepository(inboxDirectory);
      await registry.preregister(createRemoteExecutionLinkRecord(link, envelope), -1);
      await new RemoteCallbackInbox(inboxRepository, link, { maxSequenceGap: 4 })
        .receive(callback(link, 1, 'completion', 'push'), -1);

      const restartedRegistry = new FileRemoteExecutionLinkRegistryRepository(registryDirectory);
      const restartedInbox = new FileRemoteCallbackInboxRepository(inboxDirectory);
      const poll = vi.fn<RemoteCallbackPollPort['poll']>();
      const application = new RemoteCallbackApplication({
        registry: restartedRegistry,
        inboxRepository: restartedInbox,
        maxSequenceGap: 4,
        pollPort: { poll },
        reconciliationClock: { now: () => 1_200 },
        observationIngress: new AssignmentObservationIngress({ kernel }),
        runState: { read: kernel.read.bind(kernel) },
      });

      const registered = await restartedRegistry.listRegistered();
      expect(registered.map(record => record.id)).toEqual([link.id]);
      for (const record of registered) {
        await application.runOnce(record.id, new AbortController().signal);
      }
      await expect(kernel.read(envelope.projectId, envelope.runId)).resolves.toMatchObject({
        assignments: { [envelope.assignmentId]: { status: 'execution_completed' } },
        tasks: { [envelope.taskKey]: { status: 'awaiting_acceptance' } },
      });
      expect(poll).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function assignmentEnvelope(assignmentId = 'assignment-1'): AssignmentExecutionEnvelope {
  return createAssignmentExecutionEnvelope({
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: assignmentId === 'assignment-1' ? 'build' : 'test',
    taskRevision: 1,
    assignmentId,
    assignmentRevision: 1,
    attempt: 1,
    fence: 7,
    principalId: 'agent:remote-developer',
    role: 'executor',
    agentDefinition: { ref: 'agent:developer:1', revision: 1, digest: SHA_A },
    plan: { ref: 'plan:run-1:1', revision: 1, digest: SHA_B },
    contextPolicy: { ref: 'context-policy:1', revision: 1, digest: SHA_C },
    factAnchor: { ref: 'facts:run-1:2', sequence: 2, digest: SHA_D },
    capabilitySnapshot: { ref: `capabilities:${assignmentId}:1`, revision: 1, digest: SHA_E },
    policySnapshot: { ref: `policy:${assignmentId}:1`, revision: 1, digest: SHA_F },
    workspace: {
      leaseRef: `workspace-lease:${assignmentId}:1`,
      mountRef: `workspace-mount:${assignmentId}:1`,
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
    dispatchId: `dispatch:${envelope.assignmentId}`,
    messageId: `message:${envelope.assignmentId}`,
    dispatchEnvelopeDigest: SHA_B,
    endpoint: { id: 'a2a-primary', cardDigest: SHA_A, authBindingId: 'auth-binding-1' },
    remoteTaskId: `remote-task:${envelope.assignmentId}`,
    remoteContextId: `remote-context:${envelope.assignmentId}`,
    workspace: {
      provider: 'github_pull_request',
      repositoryId: 'github:zhinjs/zhin',
      integrationBindingId: 'github-app-1',
      baseSha: '1'.repeat(40),
      targetRef: 'refs/heads/main',
      branchRef: `refs/heads/workroom/${envelope.assignmentId}/attempt-1-fence-7`,
      pathScope: ['packages/im/agent'],
      mode: 'branch_and_pr',
      fence: envelope.fence,
    },
  });
}

function callbackGap(link: RemoteExecutionLink) {
  return callback(link, 2, 'heartbeat', 'push');
}

function callback(
  link: RemoteExecutionLink,
  callbackSequence: number,
  type: 'heartbeat' | 'progress' | 'completion',
  source: 'push' | 'poll',
) {
  const message: RemoteCallbackMessage = {
    version: 1 as const,
    callbackSequence,
    eventId: `event-${type}:${link.assignmentId}`,
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
    payload: type === 'completion'
      ? {
        type: 'execution_completed' as const,
        completion: {
          report: { ref: `report:${link.assignmentId}`, digest: SHA_D },
          candidate: { ref: `candidate:${link.assignmentId}`, hash: SHA_E },
          claims: [{ ref: `claim:${link.assignmentId}`, digest: SHA_D }],
          evidence: [{ ref: `evidence:${link.assignmentId}`, digest: SHA_E }],
          workspaceReceipt: {
            ...link.workspace,
            headSha: '2'.repeat(40),
            pullRequestRef: `github-pr:${link.assignmentId}`,
            pullRequestHash: SHA_F,
          },
        },
      }
      : type === 'progress'
        ? { type: 'progress' as const, progress: { summary: 'Remote progress' } }
        : { type: 'heartbeat' as const },
  };
  return {
    ...message,
    gatewayReceipt: {
      receiptId: `receipt-${type}:${link.assignmentId}`,
      source,
      receivedAt: 1_100 + callbackSequence,
      endpointId: link.endpoint.id,
      cardDigest: link.endpoint.cardDigest,
      authBindingId: link.endpoint.authBindingId,
      callbackDigest: digestRemoteCallbackMessage(message),
    },
  };
}

async function runningAssignment(): Promise<Readonly<{
  kernel: WorkroomKernel;
  envelope: AssignmentExecutionEnvelope;
}>> {
  let event = 0;
  const kernel = new WorkroomKernel({
    journal: new MemoryWorkroomJournal(),
    now: () => 1_000,
    createId: () => `kernel-event-${++event}`,
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
  return { kernel, envelope };
}

function acceptancePolicy(): WorkroomAcceptancePolicyDecisionPort {
  return {
    pinContract(input) {
      return {
        version: 1,
        id: `contract:${input.task.key}:${input.task.revision}`,
        revision: 1,
        digest: SHA_A,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        kind: 'task_result',
        criteria: [{ id: 'build', kind: 'deterministic', description: 'Build passes' }],
        requiredEvidence: [],
        policy: { id: 'policy-1', revision: 1, digest: SHA_B },
      };
    },
    decide() {
      throw new Error('Remote Callback Application must not accept the Task');
    },
  };
}

function tracingFileSystem(trace: string[]): RemoteExecutionLinkRegistryFileSystem {
  return {
    async mkdir(path) {
      trace.push('mkdir');
      await mkdir(path);
    },
    async readdir(path) {
      trace.push('readdir');
      return await readdir(path);
    },
    async readFile(path, encoding) {
      trace.push('readFile');
      return await readFile(path, encoding);
    },
    async open(path, flags) {
      trace.push(`open:${flags}`);
      const handle = await open(path, flags);
      return {
        async writeFile(value, encoding) {
          trace.push(`write:${flags}`);
          await handle.writeFile(value, encoding);
        },
        async sync() {
          trace.push(`sync:${flags}`);
          await handle.sync();
        },
        async close() {
          trace.push(`close:${flags}`);
          await handle.close();
        },
      };
    },
    async link(existingPath, newPath) {
      trace.push('link');
      await fsLink(existingPath, newPath);
    },
    async unlink(path) {
      trace.push('unlink');
      await unlink(path);
    },
  };
}
