import { createHash } from 'node:crypto';
import {
  readFile as nodeReadFile,
  readdir as nodeReaddir,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalWorkroomJson as stableJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionObservation,
} from './assignment-executor.js';
import {
  createRemoteExecutionLink,
  RemoteCallbackInbox,
  type RemoteCallbackInboxProjection,
  type RemoteCallbackInboxRepository,
  type RemoteExecutionLink,
  type RemoteExecutionLinkInput,
} from './remote-callback-inbox.js';
import {
  assertWorkroomRemoteDispatchRetry,
  createWorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchInput,
} from './remote-dispatch.js';
import {
  DurableFileStore,
  nodeDurableFileSystem,
  type DurableFileHandle,
  type DurableFileSystem,
} from './durable-file-store.js';

export interface RemoteExecutionLinkPreregistration {
  readonly version: 1;
  readonly id: string;
  readonly revision: 1;
  readonly status: 'preregistered';
  readonly linkedAt: number;
  readonly reconcileDeadline: number;
  readonly dispatchItem: WorkroomRemoteDispatchOutboxItem;
  readonly assignmentEnvelope: AssignmentExecutionEnvelope;
  readonly digest: string;
}
import {
  runRemoteCallbackReconciliationOnce,
  type RemoteCallbackPollPort,
  type RemoteCallbackReconciliationClock,
  type RemoteCallbackReconciliationWorkerOutcome,
} from './remote-callback-reconciliation-worker.js';

export interface RemoteExecutionLinkRecord {
  readonly version: 1;
  readonly id: string;
  readonly revision: 1;
  readonly link: RemoteExecutionLink;
  readonly assignmentEnvelope: AssignmentExecutionEnvelope;
  readonly digest: string;
}

export interface RemoteExecutionLinkRegistryRepository {
  preregisterPending(
    registration: RemoteExecutionLinkPreregistration,
    expectedSequence: number,
  ): Promise<RemoteExecutionLinkPreregistration>;
  readPending(linkId: string): Promise<RemoteExecutionLinkPreregistration | undefined>;
  bindTransportReceipt(
    record: RemoteExecutionLinkRecord,
    expectedRegistrationRevision: number,
  ): Promise<RemoteExecutionLinkRecord>;
  preregister(
    record: RemoteExecutionLinkRecord,
    expectedSequence: number,
  ): Promise<RemoteExecutionLinkRecord>;
  read(linkId: string): Promise<RemoteExecutionLinkRecord | undefined>;
  listRegistered(): Promise<readonly RemoteExecutionLinkRecord[]>;
  listReconcileRequired(
    inboxRepository: Pick<RemoteCallbackInboxRepository, 'read'>,
  ): Promise<readonly RemoteExecutionLinkRecord[]>;
}

export type RemoteExecutionLinkRegistryFileHandle = DurableFileHandle;

/** Injectable only at the durable filesystem boundary. */
export interface RemoteExecutionLinkRegistryFileSystem extends DurableFileSystem {
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

const nodeFileSystem: RemoteExecutionLinkRegistryFileSystem = Object.freeze({
  ...nodeDurableFileSystem,
  readdir: async (path: string): Promise<readonly string[]> => await nodeReaddir(path),
  readFile: async (path: string, encoding: 'utf8'): Promise<string> =>
    await nodeReadFile(path, encoding),
});

export class RemoteExecutionLinkRegistrySequenceConflictError extends Error {
  constructor(
    readonly linkId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(
      `Remote Execution Link Registry ${linkId} sequence conflict: expected `
      + `${expectedSequence}, actual ${actualSequence}`,
    );
    this.name = 'RemoteExecutionLinkRegistrySequenceConflictError';
  }
}

export interface RemoteCallbackApplicationObservationIngressPort {
  apply(
    envelope: AssignmentExecutionEnvelope,
    observation: AssignmentExecutionObservation,
    expectedSequence: number,
  ): Promise<Readonly<{ sequence: number }>>;
}

export interface RemoteCallbackApplicationRunStatePort {
  read(projectId: string, runId: string): Promise<Readonly<{ sequence: number }>>;
}

export interface RemoteCallbackApplicationOptions {
  readonly registry: RemoteExecutionLinkRegistryRepository;
  readonly inboxRepository: RemoteCallbackInboxRepository;
  readonly maxSequenceGap: number;
  readonly pollPort: RemoteCallbackPollPort;
  readonly reconciliationClock: RemoteCallbackReconciliationClock;
  readonly observationIngress: RemoteCallbackApplicationObservationIngressPort;
  readonly runState: RemoteCallbackApplicationRunStatePort;
}

export type RemoteCallbackApplicationOutcome =
  | Readonly<{
    status: 'noop';
    reason: 'link_not_registered' | 'inbox_not_registered';
  }>
  | Readonly<{
    status: 'applied';
    reconciliation: RemoteCallbackReconciliationWorkerOutcome;
    submittedObservationIds: readonly string[];
    projection: RemoteCallbackInboxProjection;
  }>;

/**
 * Recovery/application bridge. Transport callbacks never provide the
 * Assignment authority used here; only the preregistered Envelope does.
 */
export class RemoteCallbackApplication {
  readonly #registry: RemoteExecutionLinkRegistryRepository;
  readonly #inboxRepository: RemoteCallbackInboxRepository;
  readonly #maxSequenceGap: number;
  readonly #pollPort: RemoteCallbackPollPort;
  readonly #reconciliationClock: RemoteCallbackReconciliationClock;
  readonly #observationIngress: RemoteCallbackApplicationObservationIngressPort;
  readonly #runState: RemoteCallbackApplicationRunStatePort;

  constructor(options: RemoteCallbackApplicationOptions) {
    this.#registry = options.registry;
    this.#inboxRepository = options.inboxRepository;
    this.#maxSequenceGap = positiveInteger(options.maxSequenceGap, 'maxSequenceGap');
    this.#pollPort = options.pollPort;
    this.#reconciliationClock = options.reconciliationClock;
    this.#observationIngress = options.observationIngress;
    this.#runState = options.runState;
  }

  async runOnce(linkId: string, signal: AbortSignal): Promise<RemoteCallbackApplicationOutcome> {
    signal.throwIfAborted();
    const id = identifier(linkId, 'linkId');
    const stored = await this.#registry.read(id);
    if (!stored) return deepFreeze({ status: 'noop', reason: 'link_not_registered' });
    const record = normalizeRecord(stored);
    if (record.id !== id) {
      throw new Error('Remote Callback Application Registry returned another Link');
    }
    const inbox = new RemoteCallbackInbox(
      this.#inboxRepository,
      record.link,
      { maxSequenceGap: this.#maxSequenceGap },
    );
    const reconciliation = await runRemoteCallbackReconciliationOnce({
      inbox,
      pollPort: this.#pollPort,
      clock: this.#reconciliationClock,
      signal,
    });
    signal.throwIfAborted();
    const projection = await inbox.read();
    if (!projection) return deepFreeze({ status: 'noop', reason: 'inbox_not_registered' });
    const state = await this.#runState.read(
      record.assignmentEnvelope.projectId,
      record.assignmentEnvelope.runId,
    );
    let expectedSequence = nonNegativeInteger(state.sequence, 'Run sequence');
    const submittedObservationIds: string[] = [];
    for (const accepted of [...projection.accepted]
      .sort((left, right) => left.callbackSequence - right.callbackSequence)) {
      signal.throwIfAborted();
      const applied = await this.#observationIngress.apply(
        record.assignmentEnvelope,
        accepted.observation,
        expectedSequence,
      );
      expectedSequence = nonNegativeInteger(applied.sequence, 'applied Run sequence');
      submittedObservationIds.push(accepted.observation.observationId);
    }
    return deepFreeze({
      status: 'applied',
      reconciliation,
      submittedObservationIds,
      projection,
    });
  }
}

export function createRemoteExecutionLinkRecord(
  link: RemoteExecutionLink,
  assignmentEnvelope: AssignmentExecutionEnvelope,
): RemoteExecutionLinkRecord {
  assertCanonicalLink(link);
  const canonicalEnvelope = normalizeEnvelope(assignmentEnvelope);
  assertLinkEnvelopeBinding(link, canonicalEnvelope);
  const projection = {
    version: 1 as const,
    id: link.id,
    revision: 1 as const,
    link,
    assignmentEnvelope: canonicalEnvelope,
  };
  return deepFreeze({ ...projection, digest: digest(projection) });
}

/**
 * Persists all local Assignment/dispatch authority before transport I/O. The
 * A2A-owned task/context receipt is deliberately absent until a delivered
 * transport observation is durably bound through `bindTransportReceipt`.
 */
export function createRemoteExecutionLinkPreregistration(
  dispatchItem: WorkroomRemoteDispatchOutboxItem,
  assignmentEnvelope: AssignmentExecutionEnvelope,
  linkedAt: number,
  reconcileDeadline: number,
): RemoteExecutionLinkPreregistration {
  const item = normalizeDispatchItem(dispatchItem);
  const envelope = normalizeEnvelope(assignmentEnvelope);
  assertDispatchEnvelopeBinding(item, envelope);
  timestamp(linkedAt, 'linkedAt');
  timestamp(reconcileDeadline, 'reconcileDeadline');
  if (reconcileDeadline <= linkedAt) {
    throw new Error('Remote Execution Link preregistration deadline is invalid');
  }
  const id = remoteExecutionLinkId(envelope);
  const projection = {
    version: 1 as const,
    id,
    revision: 1 as const,
    status: 'preregistered' as const,
    linkedAt,
    reconcileDeadline,
    dispatchItem: item,
    assignmentEnvelope: envelope,
  };
  return deepFreeze({ ...projection, digest: digest(projection) });
}

export function bindRemoteExecutionLinkTransportReceipt(
  registration: RemoteExecutionLinkPreregistration,
  remoteTaskId: string,
  remoteContextId: string,
): RemoteExecutionLinkRecord {
  const pending = normalizePreregistration(registration);
  identifier(remoteTaskId, 'remoteTaskId');
  identifier(remoteContextId, 'remoteContextId');
  const item = pending.dispatchItem;
  const linkInput: RemoteExecutionLinkInput = {
    linkedAt: pending.linkedAt,
    reconcileDeadline: pending.reconcileDeadline,
    projectId: item.envelope.projectId,
    runId: item.envelope.runId,
    taskKey: item.envelope.taskKey,
    taskRevision: item.envelope.taskRevision,
    assignmentId: item.envelope.assignmentId,
    assignmentRevision: pending.assignmentEnvelope.assignmentRevision,
    attempt: item.envelope.attempt,
    fence: item.envelope.fence,
    assignmentEnvelopeDigest: pending.assignmentEnvelope.digest,
    dispatchId: item.dispatchId,
    messageId: item.messageId,
    dispatchEnvelopeDigest: item.envelopeDigest,
    endpoint: {
      id: item.envelope.endpoint.id,
      cardDigest: item.envelope.endpoint.cardDigest,
      authBindingId: item.envelope.endpoint.authBindingId,
    },
    remoteTaskId,
    remoteContextId,
    workspace: item.envelope.workspace,
  };
  const record = createRemoteExecutionLinkRecord(
    createRemoteExecutionLink(linkInput),
    pending.assignmentEnvelope,
  );
  if (record.id !== pending.id) {
    throw new Error('Remote Execution Link transport receipt changed preregistered identity');
  }
  return record;
}

export class MemoryRemoteExecutionLinkRegistryRepository
implements RemoteExecutionLinkRegistryRepository {
  readonly #records = new Map<string, RemoteExecutionLinkRecord>();
  readonly #pending = new Map<string, RemoteExecutionLinkPreregistration>();

  async preregisterPending(
    value: RemoteExecutionLinkPreregistration,
    expectedSequence: number,
  ): Promise<RemoteExecutionLinkPreregistration> {
    const registration = normalizePreregistration(value);
    const current = this.#pending.get(registration.id);
    if (current) return exactPendingReplayOrThrow(current, registration);
    if (expectedSequence !== -1) {
      throw new RemoteExecutionLinkRegistrySequenceConflictError(
        registration.id,
        expectedSequence,
        -1,
      );
    }
    this.#pending.set(registration.id, registration);
    return registration;
  }

  async readPending(linkId: string): Promise<RemoteExecutionLinkPreregistration | undefined> {
    return this.#pending.get(identifier(linkId, 'linkId'));
  }

  async bindTransportReceipt(
    value: RemoteExecutionLinkRecord,
    expectedRegistrationRevision: number,
  ): Promise<RemoteExecutionLinkRecord> {
    const record = normalizeRecord(value);
    const pending = this.#pending.get(record.id);
    assertTransportBinding(pending, record, expectedRegistrationRevision);
    return await this.preregister(record, -1);
  }

  async preregister(
    value: RemoteExecutionLinkRecord,
    expectedSequence: number,
  ): Promise<RemoteExecutionLinkRecord> {
    const record = normalizeRecord(value);
    const current = this.#records.get(record.id);
    if (current) return exactReplayOrThrow(current, record);
    if (expectedSequence !== -1) {
      throw new RemoteExecutionLinkRegistrySequenceConflictError(record.id, expectedSequence, -1);
    }
    this.#records.set(record.id, record);
    return record;
  }

  async read(linkId: string): Promise<RemoteExecutionLinkRecord | undefined> {
    return this.#records.get(identifier(linkId, 'linkId'));
  }

  async listRegistered(): Promise<readonly RemoteExecutionLinkRecord[]> {
    return Object.freeze(
      [...this.#records.values()].sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  async listReconcileRequired(
    inboxRepository: Pick<RemoteCallbackInboxRepository, 'read'>,
  ): Promise<readonly RemoteExecutionLinkRecord[]> {
    return await filterReconcileRequired(await this.listRegistered(), inboxRepository);
  }
}

/** Immutable create-only records provide restart-safe preregistration before dispatch. */
export class FileRemoteExecutionLinkRegistryRepository
implements RemoteExecutionLinkRegistryRepository {
  readonly #durable: DurableFileStore;

  constructor(
    readonly directory: string,
    readonly fileSystem: RemoteExecutionLinkRegistryFileSystem = nodeFileSystem,
  ) {
    identifier(directory, 'directory');
    this.#durable = new DurableFileStore(directory, fileSystem);
  }

  async preregisterPending(
    value: RemoteExecutionLinkPreregistration,
    expectedSequence: number,
  ): Promise<RemoteExecutionLinkPreregistration> {
    const registration = normalizePreregistration(value);
    const current = await this.readPending(registration.id);
    if (current) return exactPendingReplayOrThrow(current, registration);
    if (expectedSequence !== -1) {
      throw new RemoteExecutionLinkRegistrySequenceConflictError(
        registration.id,
        expectedSequence,
        -1,
      );
    }
    await this.#durable.ensureDurableLeaf('Remote Execution Link Registry');
    await this.#writeCreateOnly(
      this.#pendingPath(registration.id),
      registration,
      async () => {
        const winner = await this.readPending(registration.id);
        if (!winner) throw new Error('Remote Execution Link preregistration CAS winner disappeared');
        return exactPendingReplayOrThrow(winner, registration);
      },
    );
    const persisted = await this.readPending(registration.id);
    if (!persisted) throw new Error('Remote Execution Link preregistration disappeared');
    return exactPendingReplayOrThrow(persisted, registration);
  }

  async readPending(linkId: string): Promise<RemoteExecutionLinkPreregistration | undefined> {
    const id = identifier(linkId, 'linkId');
    try {
      const encoded = await this.fileSystem.readFile(this.#pendingPath(id), 'utf8');
      const registration = parsePreregistration(encoded);
      if (registration.id !== id) {
        throw new Error('Remote Execution Link preregistration filename identity drift');
      }
      return registration;
    } catch (error) {
      if (isCode(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  async bindTransportReceipt(
    value: RemoteExecutionLinkRecord,
    expectedRegistrationRevision: number,
  ): Promise<RemoteExecutionLinkRecord> {
    const record = normalizeRecord(value);
    const pending = await this.readPending(record.id);
    assertTransportBinding(pending, record, expectedRegistrationRevision);
    return await this.preregister(record, -1);
  }

  async preregister(
    value: RemoteExecutionLinkRecord,
    expectedSequence: number,
  ): Promise<RemoteExecutionLinkRecord> {
    const record = normalizeRecord(value);
    const current = await this.read(record.id);
    if (current) {
      await this.#durable.syncLeafAndParent();
      return exactReplayOrThrow(current, record);
    }
    if (expectedSequence !== -1) {
      throw new RemoteExecutionLinkRegistrySequenceConflictError(record.id, expectedSequence, -1);
    }
    await this.#durable.ensureDurableLeaf('Remote Execution Link Registry');
    const target = this.#path(record.id);
    await this.#writeCreateOnly(target, record, async () => {
      const winner = await this.read(record.id);
      if (!winner) {
        throw new Error('Remote Execution Link Registry CAS winner disappeared');
      }
      return exactReplayOrThrow(winner, record);
    });
    const persisted = await this.read(record.id);
    if (!persisted) throw new Error('Remote Execution Link Registry record disappeared');
    return exactReplayOrThrow(persisted, record);
  }

  async read(linkId: string): Promise<RemoteExecutionLinkRecord | undefined> {
    const id = identifier(linkId, 'linkId');
    try {
      const encoded = await this.fileSystem.readFile(this.#path(id), 'utf8');
      const record = parseRecord(encoded);
      if (record.id !== id) throw new Error('Remote Execution Link Registry filename identity drift');
      await this.#durable.syncLeafAndParent();
      return record;
    } catch (error) {
      if (isCode(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  async listRegistered(): Promise<readonly RemoteExecutionLinkRecord[]> {
    let names: string[];
    try {
      names = [...await this.fileSystem.readdir(this.directory)];
    } catch (error) {
      if (isCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const records: RemoteExecutionLinkRecord[] = [];
    for (const name of names.sort()) {
      if (name.endsWith('.tmp')) continue;
      if (/^[a-f0-9]{64}\.pending\.json$/u.test(name)) {
        const registration = parsePreregistration(
          await this.fileSystem.readFile(join(this.directory, name), 'utf8'),
        );
        if (name !== `${hash(registration.id)}.pending.json`) {
          throw new Error('Remote Execution Link preregistration filename digest drift');
        }
        continue;
      }
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) {
        throw new Error(`Remote Execution Link Registry contains invalid file ${name}`);
      }
      const record = parseRecord(await this.fileSystem.readFile(join(this.directory, name), 'utf8'));
      if (name !== this.#fileName(record.id)) {
        throw new Error('Remote Execution Link Registry filename digest drift');
      }
      records.push(record);
    }
    if (records.length > 0) {
      await this.#durable.syncLeafAndParent();
    }
    return Object.freeze(records.sort((left, right) => left.id.localeCompare(right.id)));
  }

  async listReconcileRequired(
    inboxRepository: Pick<RemoteCallbackInboxRepository, 'read'>,
  ): Promise<readonly RemoteExecutionLinkRecord[]> {
    return await filterReconcileRequired(await this.listRegistered(), inboxRepository);
  }

  #fileName(linkId: string): string {
    return `${hash(identifier(linkId, 'linkId'))}.json`;
  }

  #path(linkId: string): string {
    return join(this.directory, this.#fileName(linkId));
  }

  #pendingPath(linkId: string): string {
    return join(this.directory, `${hash(identifier(linkId, 'linkId'))}.pending.json`);
  }

  async #writeCreateOnly<T>(
    target: string,
    value: T,
    onConflict: () => Promise<T>,
  ): Promise<T> {
    const published = await this.#durable.publishCreateOnly({
      target,
      content: JSON.stringify(value),
      createdValue: value,
      onConflict,
    });
    await this.#durable.syncLeafAndParent();
    return published.value;
  }
}

async function filterReconcileRequired(
  records: readonly RemoteExecutionLinkRecord[],
  inboxRepository: Pick<RemoteCallbackInboxRepository, 'read'>,
): Promise<readonly RemoteExecutionLinkRecord[]> {
  const selected: RemoteExecutionLinkRecord[] = [];
  for (const record of [...records].sort((left, right) => left.id.localeCompare(right.id))) {
    const projection = await inboxRepository.read(record.id);
    if (!projection) continue;
    if (stableJson(projection.link) !== stableJson(record.link)) {
      throw new Error('Remote Execution Link Registry Inbox Link drift');
    }
    if (projection.status === 'reconcile_required') selected.push(record);
  }
  return Object.freeze(selected);
}

function normalizeRecord(value: RemoteExecutionLinkRecord): RemoteExecutionLinkRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote Execution Link Registry record must be an object');
  }
  exactKeys(value, ['version', 'id', 'revision', 'link', 'assignmentEnvelope', 'digest'], 'record');
  if (value.version !== 1 || value.revision !== 1) {
    throw new Error('Remote Execution Link Registry record version is unsupported');
  }
  requireDigest(value.digest, 'record.digest');
  const canonical = createRemoteExecutionLinkRecord(value.link, value.assignmentEnvelope);
  if (value.id !== canonical.id || value.digest !== canonical.digest
    || stableJson(value) !== stableJson(canonical)) {
    throw new Error('Remote Execution Link Registry record canonical content drift');
  }
  return canonical;
}

function parseRecord(encoded: string): RemoteExecutionLinkRecord {
  try {
    return normalizeRecord(JSON.parse(encoded) as RemoteExecutionLinkRecord);
  } catch (error) {
    throw new Error('Remote Execution Link Registry durable record is corrupt', { cause: error });
  }
}

function normalizePreregistration(
  value: RemoteExecutionLinkPreregistration,
): RemoteExecutionLinkPreregistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote Execution Link preregistration must be an object');
  }
  exactKeys(value, [
    'version', 'id', 'revision', 'status', 'linkedAt', 'reconcileDeadline',
    'dispatchItem', 'assignmentEnvelope', 'digest',
  ], 'preregistration');
  if (value.version !== 1 || value.revision !== 1 || value.status !== 'preregistered') {
    throw new Error('Remote Execution Link preregistration version is unsupported');
  }
  const canonical = createRemoteExecutionLinkPreregistration(
    value.dispatchItem,
    value.assignmentEnvelope,
    value.linkedAt,
    value.reconcileDeadline,
  );
  if (value.id !== canonical.id || value.digest !== canonical.digest
    || stableJson(value) !== stableJson(canonical)) {
    throw new Error('Remote Execution Link preregistration canonical content drift');
  }
  return canonical;
}

function parsePreregistration(encoded: string): RemoteExecutionLinkPreregistration {
  try {
    return normalizePreregistration(JSON.parse(encoded) as RemoteExecutionLinkPreregistration);
  } catch (error) {
    throw new Error('Remote Execution Link preregistration durable record is corrupt', { cause: error });
  }
}

function normalizeDispatchItem(
  value: WorkroomRemoteDispatchOutboxItem,
): WorkroomRemoteDispatchOutboxItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote Execution Link dispatch item is invalid');
  }
  const { version: _version, dispatchId: _dispatchId, messageId: _messageId, ...input } = value.envelope;
  const canonical = createWorkroomRemoteDispatchOutboxItem(input as WorkroomRemoteDispatchInput);
  assertWorkroomRemoteDispatchRetry(canonical, value);
  if (stableJson(value) !== stableJson(canonical)) {
    throw new Error('Remote Execution Link dispatch item canonical content drift');
  }
  return canonical;
}

function assertDispatchEnvelopeBinding(
  item: WorkroomRemoteDispatchOutboxItem,
  envelope: AssignmentExecutionEnvelope,
): void {
  const remote = item.envelope;
  const bindings = [
    ['projectId', remote.projectId, envelope.projectId],
    ['runId', remote.runId, envelope.runId],
    ['taskKey', remote.taskKey, envelope.taskKey],
    ['taskRevision', remote.taskRevision, envelope.taskRevision],
    ['assignmentId', remote.assignmentId, envelope.assignmentId],
    ['attempt', remote.attempt, envelope.attempt],
    ['fence', remote.fence, envelope.fence],
    ['capabilitySnapshot.ref', remote.capabilitySnapshot.ref, envelope.capabilitySnapshot.ref],
    ['capabilitySnapshot.hash', remote.capabilitySnapshot.hash, envelope.capabilitySnapshot.digest],
    ['workspace.fence', remote.workspace.fence, envelope.workspace.fence],
  ] as const;
  const drift = bindings.find(([, actual, expected]) => actual !== expected);
  if (drift) {
    throw new Error(`Remote dispatch ${drift[0]} does not match Assignment Envelope`);
  }
}

function remoteExecutionLinkId(envelope: AssignmentExecutionEnvelope): string {
  return `remote-execution-link:v1:${[
    envelope.projectId,
    envelope.runId,
    envelope.assignmentId,
    String(envelope.attempt),
    String(envelope.fence),
  ].map(encodeURIComponent).join(':')}`;
}

function assertTransportBinding(
  pending: RemoteExecutionLinkPreregistration | undefined,
  record: RemoteExecutionLinkRecord,
  expectedRegistrationRevision: number,
): void {
  if (!pending) {
    throw new Error('Remote Execution Link transport receipt has no preregistration');
  }
  if (expectedRegistrationRevision !== pending.revision) {
    throw new RemoteExecutionLinkRegistrySequenceConflictError(
      record.id,
      expectedRegistrationRevision,
      pending.revision,
    );
  }
  const rebound = bindRemoteExecutionLinkTransportReceipt(
    pending,
    record.link.remoteTaskId,
    record.link.remoteContextId,
  );
  if (stableJson(rebound) !== stableJson(record)) {
    throw new Error('Remote Execution Link transport receipt binding drift');
  }
}

function exactPendingReplayOrThrow(
  current: RemoteExecutionLinkPreregistration,
  candidate: RemoteExecutionLinkPreregistration,
): RemoteExecutionLinkPreregistration {
  if (stableJson(current) !== stableJson(candidate)) {
    throw new Error('Remote Execution Link preregistration drift');
  }
  return current;
}

function assertCanonicalLink(link: RemoteExecutionLink): void {
  if (!link || typeof link !== 'object' || Array.isArray(link)) {
    throw new Error('Remote Execution Link is invalid');
  }
  const { version, id, digest: actualDigest, ...input } = link;
  if (version !== 1) throw new Error('Remote Execution Link version is unsupported');
  const canonical = createRemoteExecutionLink(input);
  if (id !== canonical.id || actualDigest !== canonical.digest
    || stableJson(link) !== stableJson(canonical)) {
    throw new Error('Remote Execution Link canonical content drift');
  }
}

function normalizeEnvelope(value: AssignmentExecutionEnvelope): AssignmentExecutionEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Assignment Execution Envelope is invalid');
  }
  const { version, digest: actualDigest, ...input } = value;
  if (version !== 1) throw new Error('Assignment Execution Envelope version is unsupported');
  const canonical = createAssignmentExecutionEnvelope(input);
  if (actualDigest !== canonical.digest || stableJson(value) !== stableJson(canonical)) {
    throw new Error('Assignment Execution Envelope canonical content drift');
  }
  return canonical;
}

function assertLinkEnvelopeBinding(
  link: RemoteExecutionLink,
  envelope: AssignmentExecutionEnvelope,
): void {
  const bindings = [
    ['projectId', link.projectId, envelope.projectId],
    ['runId', link.runId, envelope.runId],
    ['taskKey', link.taskKey, envelope.taskKey],
    ['taskRevision', link.taskRevision, envelope.taskRevision],
    ['assignmentId', link.assignmentId, envelope.assignmentId],
    ['assignmentRevision', link.assignmentRevision, envelope.assignmentRevision],
    ['attempt', link.attempt, envelope.attempt],
    ['fence', link.fence, envelope.fence],
    ['workspace fence', link.workspace.fence, envelope.workspace.fence],
    ['Envelope digest', link.assignmentEnvelopeDigest, envelope.digest],
  ] as const;
  const drift = bindings.find(([, actual, expected]) => actual !== expected);
  if (drift) throw new Error(`Remote Execution Link ${drift[0]} does not match Assignment Envelope`);
}

function exactReplayOrThrow(
  current: RemoteExecutionLinkRecord,
  candidate: RemoteExecutionLinkRecord,
): RemoteExecutionLinkRecord {
  if (stableJson(current) !== stableJson(candidate)) {
    throw new Error('Remote Execution Link Registry preregistration drift');
  }
  return current;
}

function exactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`Remote Execution Link Registry ${label} contains unknown field ${unexpected}`);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Remote Execution Link Registry ${field} is required`);
  }
  return value;
}

function requireDigest(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Remote Execution Link Registry ${field} is invalid`);
  }
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Remote Callback Application ${field} must be a positive integer`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Remote Callback Application ${field} must be a non-negative integer`);
  }
  return Number(value);
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) {
    throw new Error(`Remote Callback Application ${field} must be a finite timestamp`);
  }
  return Number(value);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code;
}
