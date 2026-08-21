import { createHash, randomUUID } from 'node:crypto';
import {
  link as nodeLink,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  unlink as nodeUnlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
} from './remote-callback-inbox.js';
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

export interface RemoteExecutionLinkRegistryFileHandle {
  writeFile(value: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Injectable only at the durable filesystem boundary. */
export interface RemoteExecutionLinkRegistryFileSystem {
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  open(
    path: string,
    flags: 'wx' | 'r',
  ): Promise<RemoteExecutionLinkRegistryFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nodeFileSystem: RemoteExecutionLinkRegistryFileSystem = Object.freeze({
  mkdir: async (path: string): Promise<void> => { await nodeMkdir(path); },
  readdir: async (path: string): Promise<readonly string[]> => await nodeReaddir(path),
  readFile: async (path: string, encoding: 'utf8'): Promise<string> =>
    await nodeReadFile(path, encoding),
  open: async (
    path: string,
    flags: 'wx' | 'r',
  ): Promise<RemoteExecutionLinkRegistryFileHandle> => await nodeOpen(path, flags),
  link: async (existingPath: string, newPath: string): Promise<void> =>
    await nodeLink(existingPath, newPath),
  unlink: async (path: string): Promise<void> => await nodeUnlink(path),
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

export class MemoryRemoteExecutionLinkRegistryRepository
implements RemoteExecutionLinkRegistryRepository {
  readonly #records = new Map<string, RemoteExecutionLinkRecord>();

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
  constructor(
    readonly directory: string,
    readonly fileSystem: RemoteExecutionLinkRegistryFileSystem = nodeFileSystem,
  ) {
    identifier(directory, 'directory');
  }

  async preregister(
    value: RemoteExecutionLinkRecord,
    expectedSequence: number,
  ): Promise<RemoteExecutionLinkRecord> {
    const record = normalizeRecord(value);
    const current = await this.read(record.id);
    if (current) {
      await this.#syncDirectory();
      await this.#syncParentDirectory();
      return exactReplayOrThrow(current, record);
    }
    if (expectedSequence !== -1) {
      throw new RemoteExecutionLinkRegistrySequenceConflictError(record.id, expectedSequence, -1);
    }
    await this.#ensureDurableLeaf();
    const target = this.#path(record.id);
    // UUID is only an ephemeral staging name; the durable identity is Link-owned.
    const temporary = `${target}.${randomUUID()}.tmp`;
    let temporaryExists = false;
    try {
      const handle = await this.fileSystem.open(temporary, 'wx');
      temporaryExists = true;
      try {
        await handle.writeFile(JSON.stringify(record), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.fileSystem.link(temporary, target);
      await this.fileSystem.unlink(temporary);
      temporaryExists = false;
      await this.#syncDirectory();
      await this.#syncParentDirectory();
      const persisted = await this.read(record.id);
      if (!persisted) throw new Error('Remote Execution Link Registry record disappeared');
      return exactReplayOrThrow(persisted, record);
    } catch (error) {
      if (temporaryExists) {
        await this.fileSystem.unlink(temporary).catch(cleanupError => {
          if (!isCode(cleanupError, 'ENOENT')) throw cleanupError;
        });
        temporaryExists = false;
      }
      if (!isCode(error, 'EEXIST')) throw error;
      const winner = await this.read(record.id);
      if (!winner) {
        throw new Error('Remote Execution Link Registry CAS winner disappeared', { cause: error });
      }
      await this.#syncDirectory();
      return exactReplayOrThrow(winner, record);
    } finally {
      if (temporaryExists) {
        await this.fileSystem.unlink(temporary).catch(error => {
          if (!isCode(error, 'ENOENT')) throw error;
        });
      }
    }
  }

  async read(linkId: string): Promise<RemoteExecutionLinkRecord | undefined> {
    const id = identifier(linkId, 'linkId');
    try {
      const encoded = await this.fileSystem.readFile(this.#path(id), 'utf8');
      const record = parseRecord(encoded);
      if (record.id !== id) throw new Error('Remote Execution Link Registry filename identity drift');
      await this.#syncDirectory();
      await this.#syncParentDirectory();
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
      await this.#syncDirectory();
      await this.#syncParentDirectory();
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

  async #ensureDurableLeaf(): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.directory);
    } catch (error) {
      if (!isCode(error, 'EEXIST')) {
        if (isCode(error, 'ENOENT')) {
          throw new Error(
            'Remote Execution Link Registry requires a pre-existing durable parent directory: '
            + dirname(this.directory),
            { cause: error },
          );
        }
        throw error;
      }
    }
    await this.#syncParentDirectory();
  }

  async #syncDirectory(): Promise<void> {
    const handle = await this.fileSystem.open(this.directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #syncParentDirectory(): Promise<void> {
    const handle = await this.fileSystem.open(dirname(this.directory), 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
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

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code;
}
