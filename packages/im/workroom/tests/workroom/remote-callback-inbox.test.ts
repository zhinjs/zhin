import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileRemoteCallbackInboxRepository,
  MemoryRemoteCallbackInboxRepository,
  RemoteCallbackInbox,
  createRemoteExecutionLink,
  digestRemoteCallbackReconciliationBatch,
  digestRemoteCallbackMessage,
  type RemoteCallbackEnvelope,
  type RemoteCallbackInboxFileHandle,
  type RemoteCallbackInboxFileSystem,
  type RemoteCallbackMessage,
  type RemoteCallbackReconciliationReceipt,
  type RemoteCallbackInboxRepository,
  type RemoteExecutionLink,
} from '../../src/workroom/remote-callback-inbox.js';

const SHA = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const GIT_BASE = '1'.repeat(40);
const GIT_HEAD = '2'.repeat(40);
const COMPLETION_RECEIPT_DIGEST =
  'sha256:e4f3b6fc04f2d8950530e054a9f9eacdb4cf190a1c4e21dac9877aa4dd4bbaf4';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory =>
    await rm(directory, { recursive: true, force: true })));
});

interface RepositoryFixture {
  readonly repository: RemoteCallbackInboxRepository;
  readonly restart: () => RemoteCallbackInboxRepository;
}

const adapters: readonly Readonly<{
  name: string;
  create(): Promise<RepositoryFixture>;
}>[] = [
  {
    name: 'memory',
    create: async () => {
      const repository = new MemoryRemoteCallbackInboxRepository();
      return { repository, restart: () => repository };
    },
  },
  {
    name: 'file',
    create: async () => {
      const parent = join(tmpdir(), `remote-callback-inbox-${Date.now()}-${temporaryDirectories.length}`);
      const directory = join(parent, 'journal');
      temporaryDirectories.push(parent);
      await mkdir(parent);
      return {
        repository: new FileRemoteCallbackInboxRepository(directory),
        restart: () => new FileRemoteCallbackInboxRepository(directory),
      };
    },
  },
];

describe.each(adapters)('$name Remote Callback Inbox contract', ({ create }) => {
  it('durably authenticates and normalizes the first callback against the exact Remote Link', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });

    const received = await inbox.receive(callback(link, 1, 'event-1', {
      type: 'progress',
      progress: { summary: 'checked package boundaries', completedUnits: 1, totalUnits: 3 },
    }), -1);

    expect(received).toMatchObject({
      duplicate: false,
      observation: {
        version: 1,
        type: 'progress',
        observationId: 'event-1',
        envelopeDigest: link.assignmentEnvelopeDigest,
        progress: { summary: 'checked package boundaries', completedUnits: 1, totalUnits: 3 },
      },
      projection: {
        status: 'open',
        callbackCursor: 1,
      },
    });
    expect(received.projection).not.toHaveProperty('taskStatus');

    const restarted = new RemoteCallbackInbox(fixture.restart(), link, { maxSequenceGap: 4 });
    await expect(restarted.read()).resolves.toMatchObject({
      link,
      callbackCursor: 1,
      status: 'open',
      accepted: [{ endpointId: link.endpoint.id, eventId: 'event-1', callbackSequence: 1 }],
    });
  });

  it('deduplicates only the same endpoint event and exact callback body', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    const first = callback(link, 2, 'event-gap', { type: 'heartbeat' });

    const deferred = await inbox.receive(first, -1);
    expect(deferred).toMatchObject({
      duplicate: false,
      projection: { status: 'reconcile_required', callbackCursor: 0, sequence: 1 },
    });

    const duplicate = await inbox.receive(first, -1);
    expect(duplicate).toMatchObject({
      duplicate: true,
      projection: { sequence: 1 },
    });

    const drifted = callback(link, 3, 'event-gap', { type: 'heartbeat' });
    await expect(inbox.receive(drifted, 1)).rejects.toThrow('callback body drift');
    await expect(inbox.read()).resolves.toMatchObject({ sequence: 1, deferred: [first] });
  });

  it('buffers bounded gaps and reconciles observations only in callback sequence order', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    const second = callback(link, 2, 'event-2', {
      type: 'checkpoint',
      checkpoint: { ref: 'checkpoint:2', digest: SHA_B },
    });

    await inbox.receive(second, -1);
    const missing = callback(link, 1, 'event-1', { type: 'heartbeat' });
    const batch = [missing];
    const reconciled = await inbox.reconcile(
      batch,
      1,
      reconciliationReceipt(link, 0, 2, batch, 3_000),
    );

    expect(reconciled).toMatchObject({
      status: 'open',
      callbackCursor: 2,
      sequence: 3,
      deferred: [],
      accepted: [
        { eventId: 'event-1', callbackSequence: 1, observation: { type: 'heartbeat' } },
        { eventId: 'event-2', callbackSequence: 2, observation: { type: 'checkpoint' } },
      ],
    });
    await expect(new RemoteCallbackInbox(
      fixture.restart(),
      link,
      { maxSequenceGap: 4 },
    ).read()).resolves.toEqual(reconciled);
  });

  it('makes a committed reconciliation replay a no-op while rejecting callback body drift', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    await inbox.receive(callback(link, 2, 'event-2', { type: 'heartbeat' }), -1);
    const missing = callback(link, 1, 'event-1', { type: 'heartbeat' });
    const batch = [missing];
    const receipt = reconciliationReceipt(link, 0, 2, batch, 3_000);
    const committed = await inbox.reconcile(batch, 1, receipt);

    await expect(inbox.reconcile(batch, 1, receipt)).resolves.toEqual(committed);
    const drifted = callback(link, 3, 'event-1', { type: 'heartbeat' });
    await expect(inbox.reconcile(
      [drifted],
      1,
      reconciliationReceipt(link, 0, 3, [drifted], 3_500),
    )).rejects.toThrow('callback body drift');
    await expect(inbox.read()).resolves.toEqual(committed);
  });

  it('requires an authenticated poll receipt bound to the exact batch and durable cursor', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    await inbox.receive(callback(link, 2, 'event-2', { type: 'heartbeat' }), -1);
    const missing = callback(link, 1, 'event-1', { type: 'heartbeat' });
    const valid = reconciliationReceipt(link, 0, 2, [missing], 3_000);

    await expect(inbox.reconcile([missing], 1, {
      ...valid,
      authBindingId: 'forged-binding',
    })).rejects.toThrow('authBindingId does not match');
    const staleCursorInput = { ...valid, fromCursor: 1 };
    await expect(inbox.reconcile([missing], 1, {
      ...staleCursorInput,
      batchDigest: digestRemoteCallbackReconciliationBatch(staleCursorInput),
    })).rejects.toThrow('cursor does not match');
    await expect(inbox.reconcile([missing], 1, {
      ...valid,
      callbackDigests: [SHA],
    })).rejects.toThrow('exact callback batch');
    await expect(inbox.read()).resolves.toMatchObject({
      status: 'reconcile_required', callbackCursor: 0, sequence: 1,
    });
  });

  it('records a typed completion and immutable Git receipt without accepting a Task', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    const completion = callback(link, 1, 'event-completed', {
      type: 'execution_completed',
      completion: {
        report: { ref: 'report:assignment-1', digest: SHA },
        candidate: { ref: 'changeset:assignment-1', hash: SHA_B },
        claims: [{ ref: 'claim:build-passed', digest: SHA }],
        evidence: [{ ref: 'evidence:test-run', digest: SHA_B }],
        workspaceReceipt: {
          ...link.workspace,
          headSha: GIT_HEAD,
          pullRequestRef: 'github-pr:zhinjs/zhin:101',
          pullRequestHash: SHA,
        },
      },
    });

    const received = await inbox.receive(completion, -1);

    expect(received.observation).toEqual({
      version: 1,
      type: 'execution_completed',
      observationId: 'event-completed',
      envelopeDigest: link.assignmentEnvelopeDigest,
      completion: {
        report: { ref: 'report:assignment-1', digest: SHA },
        candidate: { ref: 'changeset:assignment-1', hash: SHA_B },
        completionReceiptDigest: COMPLETION_RECEIPT_DIGEST,
      },
    });
    expect(received.projection).toMatchObject({
      status: 'terminal_observed',
      terminalReceipt: {
        report: { ref: 'report:assignment-1', digest: SHA },
        candidate: { ref: 'changeset:assignment-1', hash: SHA_B },
        claims: [{ ref: 'claim:build-passed', digest: SHA }],
        evidence: [{ ref: 'evidence:test-run', digest: SHA_B }],
        workspaceReceipt: {
          baseSha: GIT_BASE,
          checkpointSha: '3'.repeat(40),
          headSha: GIT_HEAD,
          pathScope: ['packages/im/agent'],
          mode: 'branch_and_pr',
          fence: link.fence,
        },
      },
    });
    expect(received.projection).not.toHaveProperty('taskStatus');
    expect(received.projection).not.toHaveProperty('acceptedTask');
    await expect(inbox.receive(
      callback(link, 2, 'event-late', { type: 'heartbeat' }),
      received.projection.sequence,
    )).rejects.toThrow('after terminal observation');
  });

  it('fails closed when gateway authority or completion workspace binding drifts', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    const forgedAuthority = callback(link, 1, 'event-forged', { type: 'heartbeat' });

    await expect(inbox.receive({
      ...forgedAuthority,
      gatewayReceipt: { ...forgedAuthority.gatewayReceipt, authBindingId: 'attacker-binding' },
    }, -1)).rejects.toThrow('authenticatedAuthBindingId');

    const driftedCompletion = callback(link, 1, 'event-drifted-completion', {
      type: 'execution_completed',
      completion: {
        report: { ref: 'report:assignment-1', digest: SHA },
        candidate: { ref: 'changeset:assignment-1', hash: SHA_B },
        claims: [{ ref: 'claim:build-passed', digest: SHA }],
        evidence: [{ ref: 'evidence:test-run', digest: SHA_B }],
        workspaceReceipt: {
          ...link.workspace,
          baseSha: '3'.repeat(40),
          headSha: GIT_HEAD,
          pullRequestRef: 'github-pr:zhinjs/zhin:101',
          pullRequestHash: SHA,
        },
      },
    });
    await expect(inbox.receive(driftedCompletion, -1)).rejects.toThrow(
      'Workspace baseSha does not match the Link',
    );
    await expect(inbox.read()).resolves.toBeUndefined();
  });

  it('requires exact unique claim/evidence refs and the full leased path/mode authority', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    const duplicateClaims = callback(link, 1, 'event-duplicate-claims', {
      type: 'execution_completed',
      completion: {
        report: { ref: 'report:assignment-1', digest: SHA },
        candidate: { ref: 'changeset:assignment-1', hash: SHA_B },
        claims: [
          { ref: 'claim:build-passed', digest: SHA },
          { ref: 'claim:build-passed', digest: SHA_B },
        ],
        evidence: [],
        workspaceReceipt: {
          ...link.workspace,
          headSha: GIT_HEAD,
          pullRequestRef: 'github-pr:zhinjs/zhin:101',
          pullRequestHash: SHA,
        },
      },
    });
    await expect(inbox.receive(duplicateClaims, -1)).rejects.toThrow('refs must be unique');

    const driftedPath = callback(link, 1, 'event-drifted-path', {
      type: 'execution_completed',
      completion: {
        report: { ref: 'report:assignment-1', digest: SHA },
        candidate: { ref: 'changeset:assignment-1', hash: SHA_B },
        claims: [],
        evidence: [],
        workspaceReceipt: {
          ...link.workspace,
          pathScope: ['packages/im/core'],
          headSha: GIT_HEAD,
          pullRequestRef: 'github-pr:zhinjs/zhin:101',
          pullRequestHash: SHA,
        },
      },
    });
    await expect(inbox.receive(driftedPath, -1)).rejects.toThrow('pathScope does not match');
    await expect(inbox.read()).resolves.toBeUndefined();
  });

  it('uses expectedSequence CAS so competing first callbacks cannot both become facts', async () => {
    const fixture = await create();
    const link = remoteLink();
    const left = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });
    const right = new RemoteCallbackInbox(fixture.restart(), link, { maxSequenceGap: 4 });

    const results = await Promise.allSettled([
      left.receive(callback(link, 1, 'event-left', { type: 'heartbeat' }), -1),
      right.receive(callback(link, 1, 'event-right', { type: 'heartbeat' }), -1),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expect(left.read()).resolves.toMatchObject({
      sequence: 1,
      callbackCursor: 1,
      accepted: [{ eventId: expect.stringMatching(/^event-(?:left|right)$/u) }],
    });
  });

  it('fails closed outside the bounded sequence and reconciliation deadline', async () => {
    const fixture = await create();
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(fixture.repository, link, { maxSequenceGap: 4 });

    await expect(inbox.receive(
      callback(link, 6, 'event-too-far', { type: 'heartbeat' }),
      -1,
    )).rejects.toThrow('gap exceeds the bounded window');
    await expect(inbox.read()).resolves.toBeUndefined();

    await inbox.receive(callback(link, 2, 'event-2', { type: 'heartbeat' }), -1);
    const missing = callback(link, 1, 'event-1', { type: 'heartbeat' });
    await expect(inbox.reconcile(
      [missing],
      1,
      reconciliationReceipt(link, 0, 2, [missing], link.reconcileDeadline + 1),
    )).rejects.toThrow('deadline has expired');
    await expect(inbox.read()).resolves.toMatchObject({
      status: 'reconcile_required',
      callbackCursor: 0,
      sequence: 1,
    });
  });
});

describe('File Remote Callback Inbox corruption boundary', () => {
  it('fails closed when a durable observation is altered between restarts', async () => {
    const parent = join(tmpdir(), `remote-callback-corruption-${Date.now()}`);
    const directory = join(parent, 'journal');
    temporaryDirectories.push(parent);
    await mkdir(parent);
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new FileRemoteCallbackInboxRepository(directory),
      link,
      { maxSequenceGap: 4 },
    );
    await inbox.receive(callback(link, 1, 'event-1', { type: 'heartbeat' }), -1);
    const [segmentName] = (await readdir(directory)).filter(name => name.endsWith('.json'));
    const segmentPath = join(directory, segmentName!);
    const events = JSON.parse(await readFile(segmentPath, 'utf8')) as Array<{
      payload?: { observation?: { envelopeDigest?: string } };
    }>;
    events[1]!.payload!.observation!.envelopeDigest = SHA_B;
    await writeFile(segmentPath, JSON.stringify(events), 'utf8');

    await expect(new RemoteCallbackInbox(
      new FileRemoteCallbackInboxRepository(directory),
      link,
      { maxSequenceGap: 4 },
    ).read()).rejects.toThrow('persisted observation does not match callback payload');
  });

  it('fails closed when durable same-id data keeps its payload but drifts its full callback body', async () => {
    const parent = join(tmpdir(), `remote-callback-body-drift-${Date.now()}`);
    const directory = join(parent, 'journal');
    temporaryDirectories.push(parent);
    await mkdir(parent);
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new FileRemoteCallbackInboxRepository(directory),
      link,
      { maxSequenceGap: 4 },
    );
    await inbox.receive(callback(link, 1, 'event-body-drift', { type: 'heartbeat' }), -1);
    const [segmentName] = (await readdir(directory)).filter(name => name.endsWith('.json'));
    const segmentPath = join(directory, segmentName!);
    const events = JSON.parse(await readFile(segmentPath, 'utf8')) as Array<{
      sequence: number;
      occurredAt: number;
      payload: { envelope: RemoteCallbackEnvelope };
    }>;
    const drifted = structuredClone(events[1]!);
    drifted.sequence = 2;
    drifted.occurredAt = 2_002;
    const { gatewayReceipt: priorReceipt, ...priorMessage } = drifted.payload.envelope;
    const driftedMessage = { ...priorMessage, callbackSequence: 2 };
    drifted.payload.envelope = {
      ...driftedMessage,
      gatewayReceipt: {
        ...priorReceipt,
        receiptId: 'gateway-receipt-drifted',
        receivedAt: 2_002,
        callbackDigest: digestRemoteCallbackMessage(driftedMessage),
      },
    };
    events.push(drifted);
    await writeFile(segmentPath, JSON.stringify(events), 'utf8');

    await expect(new FileRemoteCallbackInboxRepository(directory).read(link.id))
      .rejects.toThrow('callback body drift');
  });

  it.each([
    {
      name: 'callback batch',
      mutate: (receipt: RemoteCallbackReconciliationReceipt) => ({
        ...receipt,
        callbackDigests: [SHA_B],
      }),
      error: 'exact callback batch',
    },
    {
      name: 'starting cursor',
      mutate: (receipt: RemoteCallbackReconciliationReceipt) => ({
        ...receipt,
        fromCursor: receipt.fromCursor + 1,
      }),
      error: 'cursor does not match',
    },
    {
      name: 'snapshot cursor',
      mutate: (receipt: RemoteCallbackReconciliationReceipt) => ({
        ...receipt,
        snapshotCursor: receipt.snapshotCursor + 1,
      }),
      error: 'snapshot cursor',
    },
    {
      name: 'trusted time',
      mutate: (receipt: RemoteCallbackReconciliationReceipt) => ({
        ...receipt,
        reconciledAt: remoteLink().reconcileDeadline + 1,
      }),
      error: 'deadline has expired',
    },
  ])('fails closed when a durable reconciliation $name is rewritten with a valid digest', async ({
    mutate,
    error,
  }) => {
    const parent = join(tmpdir(), `remote-callback-reconcile-corruption-${Date.now()}`);
    const directory = join(parent, 'journal');
    temporaryDirectories.push(parent);
    await mkdir(parent);
    const trustedLink = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new FileRemoteCallbackInboxRepository(directory),
      trustedLink,
      { maxSequenceGap: 4 },
    );
    await inbox.receive(callback(trustedLink, 2, 'event-2', { type: 'heartbeat' }), -1);
    const missing = callback(trustedLink, 1, 'event-1', { type: 'heartbeat' });
    await inbox.reconcile(
      [missing],
      1,
      reconciliationReceipt(trustedLink, 0, 2, [missing], 3_000),
    );
    await rewriteReconciliationReceipts(directory, mutate);

    await expect(new FileRemoteCallbackInboxRepository(directory).read(trustedLink.id))
      .rejects.toThrow(error);
  });

  it('retries directory fsync before confirming a previously linked segment', async () => {
    const parent = join(tmpdir(), `remote-callback-fsync-${Date.now()}`);
    const directory = join(parent, 'journal');
    temporaryDirectories.push(parent);
    await mkdir(parent);
    let leafSyncFailures = 2;
    const fileSystem = faultFileSystem(async (path, handle) => {
      if (path === directory && leafSyncFailures > 0) {
        leafSyncFailures -= 1;
        throw new Error('injected leaf directory fsync failure');
      }
      await handle.sync();
    });
    const link = remoteLink();
    const callbackInbox = new RemoteCallbackInbox(
      new FileRemoteCallbackInboxRepository(directory, fileSystem),
      link,
      { maxSequenceGap: 4 },
    );

    await expect(callbackInbox.receive(
      callback(link, 1, 'event-fsync', { type: 'heartbeat' }),
      -1,
    )).rejects.toThrow('injected leaf directory fsync failure');
    await expect(new FileRemoteCallbackInboxRepository(directory, fileSystem).read(link.id))
      .rejects.toThrow('injected leaf directory fsync failure');
    await expect(new FileRemoteCallbackInboxRepository(directory, fileSystem).read(link.id))
      .resolves.toMatchObject({ callbackCursor: 1, status: 'open' });
  });

  it('fails closed when a segment filename no longer binds its first event sequence', async () => {
    const parent = join(tmpdir(), `remote-callback-filename-${Date.now()}`);
    const directory = join(parent, 'journal');
    temporaryDirectories.push(parent);
    await mkdir(parent);
    const link = remoteLink();
    const inbox = new RemoteCallbackInbox(
      new FileRemoteCallbackInboxRepository(directory),
      link,
      { maxSequenceGap: 4 },
    );
    await inbox.receive(callback(link, 1, 'event-filename', { type: 'heartbeat' }), -1);
    const [segmentName] = (await readdir(directory)).filter(name => name.endsWith('.json'));
    const renamed = segmentName!.replace('.0000000000000000.json', '.0000000000000009.json');
    await rename(join(directory, segmentName!), join(directory, renamed));

    await expect(new FileRemoteCallbackInboxRepository(directory).read(link.id))
      .rejects.toThrow('filename sequence');
  });
});

function faultFileSystem(
  syncDirectory: (path: string, handle: RemoteCallbackInboxFileHandle) => Promise<void>,
): RemoteCallbackInboxFileSystem {
  return {
    mkdir: async path => { await mkdir(path); },
    readdir: async path => await readdir(path),
    readFile: async (path, encoding) => await readFile(path, encoding),
    open: async (path, flags) => {
      const handle = await open(path, flags);
      if (flags !== 'r') return handle;
      return {
        writeFile: async (value, encoding) => { await handle.writeFile(value, encoding); },
        sync: async () => { await syncDirectory(path, handle); },
        close: async () => { await handle.close(); },
      };
    },
    link: async (existingPath, newPath) => { await link(existingPath, newPath); },
    unlink: async path => { await unlink(path); },
  };
}

async function rewriteReconciliationReceipts(
  directory: string,
  mutate: (
    receipt: RemoteCallbackReconciliationReceipt,
  ) => RemoteCallbackReconciliationReceipt,
): Promise<void> {
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.json'))) {
    const path = join(directory, name);
    const events = JSON.parse(await readFile(path, 'utf8')) as Array<{
      payload?: { reconciliationReceipt?: RemoteCallbackReconciliationReceipt };
    }>;
    let changed = false;
    for (const event of events) {
      const receipt = event.payload?.reconciliationReceipt;
      if (!receipt) continue;
      const mutated = mutate(receipt);
      const { batchDigest: _batchDigest, ...input } = mutated;
      event.payload!.reconciliationReceipt = {
        ...input,
        batchDigest: digestRemoteCallbackReconciliationBatch(input),
      };
      changed = true;
    }
    if (changed) await writeFile(path, JSON.stringify(events), 'utf8');
  }
}

function remoteLink(): RemoteExecutionLink {
  return createRemoteExecutionLink({
    linkedAt: 1_000,
    reconcileDeadline: 10_000,
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'implement-callback-inbox',
    taskRevision: 2,
    assignmentId: 'assignment-1',
    assignmentRevision: 3,
    attempt: 1,
    fence: 7,
    assignmentEnvelopeDigest: SHA,
    dispatchId: 'dispatch-1',
    messageId: 'message-1',
    dispatchEnvelopeDigest: SHA_B,
    endpoint: {
      id: 'a2a-primary',
      cardDigest: SHA,
      authBindingId: 'auth-binding-1',
    },
    remoteTaskId: 'remote-task-1',
    remoteContextId: 'remote-context-1',
    workspace: {
      provider: 'github_pull_request',
      repositoryId: 'github:zhinjs/zhin',
      integrationBindingId: 'github-app-1',
      baseSha: GIT_BASE,
      checkpointSha: '3'.repeat(40),
      targetRef: 'refs/heads/main',
      branchRef: 'refs/heads/workroom/assignment-1/attempt-1-fence-7',
      pathScope: ['packages/im/agent'],
      mode: 'branch_and_pr',
      fence: 7,
    },
  });
}

function callback(
  link: RemoteExecutionLink,
  callbackSequence: number,
  eventId: string,
  payload: RemoteCallbackEnvelope['payload'],
): RemoteCallbackEnvelope {
  const message: RemoteCallbackMessage = {
    version: 1,
    callbackSequence,
    eventId,
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
    payload,
  };
  return {
    ...message,
    gatewayReceipt: {
      receiptId: `gateway-receipt-${eventId}`,
      source: 'push',
      receivedAt: 2_000 + callbackSequence,
      endpointId: link.endpoint.id,
      cardDigest: link.endpoint.cardDigest,
      authBindingId: link.endpoint.authBindingId,
      callbackDigest: digestRemoteCallbackMessage(message),
    },
  };
}

function reconciliationReceipt(
  link: RemoteExecutionLink,
  fromCursor: number,
  snapshotCursor: number,
  callbacks: readonly RemoteCallbackEnvelope[],
  reconciledAt: number,
): RemoteCallbackReconciliationReceipt {
  const input = {
    receiptId: `poll-receipt:${fromCursor}:${snapshotCursor}:${reconciledAt}`,
    source: 'poll' as const,
    reconciledAt,
    endpointId: link.endpoint.id,
    cardDigest: link.endpoint.cardDigest,
    authBindingId: link.endpoint.authBindingId,
    linkId: link.id,
    fromCursor,
    snapshotCursor,
    callbackDigests: callbacks.map(item => item.gatewayReceipt.callbackDigest),
  };
  return { ...input, batchDigest: digestRemoteCallbackReconciliationBatch(input) };
}
