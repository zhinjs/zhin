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
} from './canonical-value.js';
import {
  assertWorkroomRemoteDispatchRetry,
  createWorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchInput,
} from './remote-dispatch.js';

export type WorkroomRemoteDispatchOutboxStatus =
  | 'pending'
  | 'leased'
  | 'delivered'
  | 'reconcile_required'
  | 'retryable'
  | 'blocked';

export interface WorkroomRemoteDispatchLease {
  readonly ownerId: string;
  readonly leaseId: string;
  readonly leaseFence: number;
  readonly claimedAt: number;
  readonly expiresAt: number;
}

export interface WorkroomRemoteDispatchTransportObservation {
  readonly outcome: 'delivered' | 'outcome_unknown' | 'failed';
  readonly receiptId: string;
  readonly remoteTaskId?: string;
  readonly remoteContextId?: string;
  readonly reason?: string;
}

export interface WorkroomRemoteDispatchPersistedObservation
extends WorkroomRemoteDispatchTransportObservation {
  readonly observationId: string;
  readonly observedAt: number;
  readonly leaseId: string;
  readonly leaseFence: number;
}

export interface WorkroomRemoteDispatchOutboxProjection {
  readonly version: 1;
  readonly dispatchId: string;
  readonly sequence: number;
  readonly status: WorkroomRemoteDispatchOutboxStatus;
  readonly item: WorkroomRemoteDispatchOutboxItem;
  readonly attemptCount: number;
  readonly observations: readonly WorkroomRemoteDispatchPersistedObservation[];
  readonly lease?: WorkroomRemoteDispatchLease;
  readonly lastLeaseFence?: number;
  readonly lastRecoveryCause?: WorkroomRemoteDispatchRecoveryCause;
  readonly governanceBlock?: Readonly<{
    reason: string;
    manifestDigest: string;
    attempt: number;
    assignmentFence: number;
    blockedAt: number;
  }>;
}

interface WorkroomRemoteDispatchEnqueuedEventDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'dispatch.enqueued';
  readonly payload: Readonly<{ item: WorkroomRemoteDispatchOutboxItem }>;
}

interface WorkroomRemoteDispatchClaimedEventDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'dispatch.claimed';
  readonly payload: Readonly<{ lease: WorkroomRemoteDispatchLease }>;
}

interface WorkroomRemoteDispatchObservationEventDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'dispatch.transport_observed';
  readonly payload: Readonly<{
    leaseId: string;
    leaseFence: number;
    observationId: string;
    observation: WorkroomRemoteDispatchTransportObservation;
  }>;
}

interface WorkroomRemoteDispatchGovernanceBlockedEventDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'dispatch.governance_blocked';
  readonly payload: Readonly<{
    reason: string;
    manifestDigest: string;
    attempt: number;
    assignmentFence: number;
  }>;
}

export type WorkroomRemoteDispatchRecoveryCause =
  | 'outcome_unknown'
  | 'transport_failed'
  | 'lease_expired';

interface WorkroomRemoteDispatchRecoveredEventDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'dispatch.recovered';
  readonly payload: Readonly<{
    lease: WorkroomRemoteDispatchLease;
    cause: WorkroomRemoteDispatchRecoveryCause;
  }>;
}

export type WorkroomRemoteDispatchOutboxEventDraft =
  | WorkroomRemoteDispatchEnqueuedEventDraft
  | WorkroomRemoteDispatchClaimedEventDraft
  | WorkroomRemoteDispatchObservationEventDraft
  | WorkroomRemoteDispatchGovernanceBlockedEventDraft
  | WorkroomRemoteDispatchRecoveredEventDraft;

export type WorkroomRemoteDispatchOutboxEvent = WorkroomRemoteDispatchOutboxEventDraft & Readonly<{
  readonly version: 1;
  readonly dispatchId: string;
  readonly sequence: number;
}>;

export interface WorkroomRemoteDispatchClaimInput {
  readonly dispatchId: string;
  readonly expectedSequence: number;
  readonly now: number;
  readonly ownerId: string;
  readonly leaseId: string;
  readonly leaseFence: number;
  readonly leaseExpiresAt: number;
}

export interface WorkroomRemoteDispatchObservationInput {
  readonly dispatchId: string;
  readonly expectedSequence: number;
  readonly now: number;
  readonly leaseId: string;
  readonly leaseFence: number;
  readonly observationId: string;
  readonly observation: WorkroomRemoteDispatchTransportObservation;
}

export interface WorkroomRemoteDispatchGovernanceBlockInput {
  readonly dispatchId: string;
  readonly expectedSequence: number;
  readonly now: number;
  readonly reason: string;
  readonly manifestDigest: string;
  readonly attempt: number;
  readonly assignmentFence: number;
}

export type WorkroomRemoteDispatchRecoverInput = WorkroomRemoteDispatchClaimInput;

export interface WorkroomRemoteDispatchOutboxRepository {
  read(dispatchId: string): Promise<WorkroomRemoteDispatchOutboxProjection | undefined>;
  /** Restart-safe work discovery; excludes delivered, reconciliation and live leases. */
  listRunnable(now: number): Promise<readonly WorkroomRemoteDispatchOutboxProjection[]>;
  listGovernanceBlocked(input: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
  }>): Promise<readonly WorkroomRemoteDispatchOutboxProjection[]>;
  append(
    dispatchId: string,
    expectedSequence: number,
    drafts: readonly WorkroomRemoteDispatchOutboxEventDraft[],
  ): Promise<readonly WorkroomRemoteDispatchOutboxEvent[]>;
  enqueue(
    item: WorkroomRemoteDispatchOutboxItem,
    expectedSequence: number,
    enqueuedAt: number,
  ): Promise<WorkroomRemoteDispatchOutboxEvent>;
  claim(input: WorkroomRemoteDispatchClaimInput): Promise<WorkroomRemoteDispatchOutboxEvent>;
  recordTransportObservation(
    input: WorkroomRemoteDispatchObservationInput,
  ): Promise<WorkroomRemoteDispatchOutboxEvent>;
  recordGovernanceBlock(
    input: WorkroomRemoteDispatchGovernanceBlockInput,
  ): Promise<WorkroomRemoteDispatchOutboxEvent>;
  recover(input: WorkroomRemoteDispatchRecoverInput): Promise<WorkroomRemoteDispatchOutboxEvent>;
}

export interface WorkroomRemoteDispatchOutboxFileHandle {
  writeFile(value: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Injectable only at the filesystem boundary; production defaults to real Node fs operations. */
export interface WorkroomRemoteDispatchOutboxFileSystem {
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  open(path: string, flags: 'wx' | 'r'): Promise<WorkroomRemoteDispatchOutboxFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nodeFileSystem: WorkroomRemoteDispatchOutboxFileSystem = Object.freeze({
  mkdir: async (path: string): Promise<void> => {
    await nodeMkdir(path);
  },
  readdir: async (path: string): Promise<readonly string[]> => await nodeReaddir(path),
  readFile: async (path: string, encoding: 'utf8'): Promise<string> =>
    await nodeReadFile(path, encoding),
  open: async (
    path: string,
    flags: 'wx' | 'r',
  ): Promise<WorkroomRemoteDispatchOutboxFileHandle> => await nodeOpen(path, flags),
  link: async (existingPath: string, newPath: string): Promise<void> =>
    await nodeLink(existingPath, newPath),
  unlink: async (path: string): Promise<void> => await nodeUnlink(path),
});

export class WorkroomRemoteDispatchOutboxSequenceConflictError extends Error {
  constructor(
    readonly dispatchId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(
      `Workroom Remote Dispatch Outbox ${dispatchId} sequence conflict: `
      + `expected ${expectedSequence}, actual ${actualSequence}`,
    );
    this.name = 'WorkroomRemoteDispatchOutboxSequenceConflictError';
  }
}

export class MemoryWorkroomRemoteDispatchOutboxRepository
implements WorkroomRemoteDispatchOutboxRepository {
  readonly #events = new Map<string, readonly WorkroomRemoteDispatchOutboxEvent[]>();

  async read(dispatchId: string): Promise<WorkroomRemoteDispatchOutboxProjection | undefined> {
    return project(this.#events.get(identifier(dispatchId, 'dispatchId')) ?? []);
  }

  async listRunnable(now: number): Promise<readonly WorkroomRemoteDispatchOutboxProjection[]> {
    const trustedNow = timestamp(now, 'now');
    return Object.freeze([...this.#events.values()]
      .map(events => project(events))
      .filter((entry): entry is WorkroomRemoteDispatchOutboxProjection =>
        entry !== undefined && isRunnable(entry, trustedNow))
      .sort((left, right) => left.dispatchId.localeCompare(right.dispatchId)));
  }

  async listGovernanceBlocked(input: Readonly<{
    projectId: string; runId: string; taskKey: string; taskRevision: number;
  }>): Promise<readonly WorkroomRemoteDispatchOutboxProjection[]> {
    return Object.freeze([...this.#events.values()]
      .map(events => project(events))
      .filter((entry): entry is WorkroomRemoteDispatchOutboxProjection =>
        entry?.status === 'blocked'
        && entry.item.envelope.projectId === input.projectId
        && entry.item.envelope.runId === input.runId
        && entry.item.envelope.taskKey === input.taskKey
        && entry.item.envelope.taskRevision === input.taskRevision)
      .sort(compareBlockedDispatch));
  }

  async append(
    dispatchId: string,
    expectedSequence: number,
    drafts: readonly WorkroomRemoteDispatchOutboxEventDraft[],
  ): Promise<readonly WorkroomRemoteDispatchOutboxEvent[]> {
    const id = identifier(dispatchId, 'dispatchId');
    const current = this.#events.get(id) ?? [];
    const appended = materializeAppend(id, current, expectedSequence, drafts);
    if (appended.length > 0 && appended.some(event => event.sequence >= current.length)) {
      this.#events.set(id, Object.freeze([...current, ...appended]));
    }
    return appended;
  }

  async enqueue(
    item: WorkroomRemoteDispatchOutboxItem,
    expectedSequence: number,
    enqueuedAt: number,
  ): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return enqueue(this, item, expectedSequence, enqueuedAt);
  }

  async claim(input: WorkroomRemoteDispatchClaimInput): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return claim(this, input);
  }

  async recordTransportObservation(
    input: WorkroomRemoteDispatchObservationInput,
  ): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return recordTransportObservation(this, input);
  }

  async recordGovernanceBlock(input: WorkroomRemoteDispatchGovernanceBlockInput) {
    return recordGovernanceBlock(this, input);
  }

  async recover(input: WorkroomRemoteDispatchRecoverInput): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return recover(this, input);
  }
}

/**
 * Durable adapter. Each append is an immutable segment and the first sequence
 * path is claimed with a hard link, making expectedSequence a filesystem CAS.
 */
export class FileWorkroomRemoteDispatchOutboxRepository
implements WorkroomRemoteDispatchOutboxRepository {
  constructor(
    readonly directory: string,
    readonly fileSystem: WorkroomRemoteDispatchOutboxFileSystem = nodeFileSystem,
  ) {}

  async read(dispatchId: string): Promise<WorkroomRemoteDispatchOutboxProjection | undefined> {
    return project(await this.#readEvents(identifier(dispatchId, 'dispatchId')));
  }

  async listRunnable(now: number): Promise<readonly WorkroomRemoteDispatchOutboxProjection[]> {
    const trustedNow = timestamp(now, 'now');
    return Object.freeze((await this.#readAllProjections())
      .filter(entry => isRunnable(entry, trustedNow)));
  }

  async listGovernanceBlocked(input: Readonly<{
    projectId: string; runId: string; taskKey: string; taskRevision: number;
  }>): Promise<readonly WorkroomRemoteDispatchOutboxProjection[]> {
    const entries = await this.#readAllProjections();
    return Object.freeze(entries.filter(entry =>
      entry.status === 'blocked'
      && entry.item.envelope.projectId === input.projectId
      && entry.item.envelope.runId === input.runId
      && entry.item.envelope.taskKey === input.taskKey
      && entry.item.envelope.taskRevision === input.taskRevision)
      .sort(compareBlockedDispatch));
  }

  async #readAllProjections(): Promise<WorkroomRemoteDispatchOutboxProjection[]> {
    let names: readonly string[];
    try {
      names = (await this.fileSystem.readdir(this.directory)).filter(name => name.endsWith('.json')).sort();
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const byDispatch = new Map<string, WorkroomRemoteDispatchOutboxEvent[]>();
    for (const name of names) {
      const value = JSON.parse(await this.fileSystem.readFile(join(this.directory, name), 'utf8')) as unknown;
      if (!Array.isArray(value)) throw new Error('Remote Dispatch Outbox segment must be an event array');
      for (const event of value.map(parseEvent)) {
        if (!name.startsWith(`${digest(event.dispatchId)}.`)) {
          throw new Error('Remote Dispatch Outbox segment identity does not match its filename');
        }
        const stream = byDispatch.get(event.dispatchId) ?? [];
        stream.push(event);
        byDispatch.set(event.dispatchId, stream);
      }
    }
    return [...byDispatch.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, events]) => project(events.sort((left, right) => left.sequence - right.sequence)))
      .filter((entry): entry is WorkroomRemoteDispatchOutboxProjection => entry !== undefined);
  }

  async append(
    dispatchId: string,
    expectedSequence: number,
    drafts: readonly WorkroomRemoteDispatchOutboxEventDraft[],
  ): Promise<readonly WorkroomRemoteDispatchOutboxEvent[]> {
    const id = identifier(dispatchId, 'dispatchId');
    const current = await this.#readEvents(id);
    const appended = materializeAppend(id, current, expectedSequence, drafts);
    if (appended.length === 0 || appended.every(event => event.sequence < current.length)) {
      if (current.length > 0) await this.#syncDirectory();
      return appended;
    }
    await this.#ensureDurableOutboxDirectory();
    const segment = this.#segmentPath(id, appended[0]!.sequence);
    const temporary = `${segment}.${randomUUID()}.tmp`;
    let temporaryExists = false;
    try {
      const handle = await this.fileSystem.open(temporary, 'wx');
      temporaryExists = true;
      try {
        await handle.writeFile(JSON.stringify(appended), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.fileSystem.link(temporary, segment);
      await this.fileSystem.unlink(temporary);
      temporaryExists = false;
      await this.#syncDirectory();
    } catch (error) {
      if (temporaryExists) {
        await this.fileSystem.unlink(temporary).catch(cleanupError => {
          if (!isMissingFile(cleanupError)) throw cleanupError;
        });
        temporaryExists = false;
      }
      if (isAlreadyExists(error)) {
        const winner = await this.#readEvents(id);
        const replay = materializeAppend(id, winner, expectedSequence, drafts);
        await this.#syncDirectory();
        if (replay.length > 0 && replay.every(event => event.sequence < winner.length)) {
          return replay;
        }
        throw new WorkroomRemoteDispatchOutboxSequenceConflictError(
          id,
          expectedSequence,
          winner.at(-1)?.sequence ?? -1,
        );
      }
      throw error;
    } finally {
      if (temporaryExists) {
        await this.fileSystem.unlink(temporary).catch(error => {
          if (!isMissingFile(error)) throw error;
        });
      }
    }
    return appended;
  }

  async enqueue(
    item: WorkroomRemoteDispatchOutboxItem,
    expectedSequence: number,
    enqueuedAt: number,
  ): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return enqueue(this, item, expectedSequence, enqueuedAt);
  }

  async claim(input: WorkroomRemoteDispatchClaimInput): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return claim(this, input);
  }

  async recordTransportObservation(
    input: WorkroomRemoteDispatchObservationInput,
  ): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return recordTransportObservation(this, input);
  }

  async recordGovernanceBlock(input: WorkroomRemoteDispatchGovernanceBlockInput) {
    return recordGovernanceBlock(this, input);
  }

  async recover(input: WorkroomRemoteDispatchRecoverInput): Promise<WorkroomRemoteDispatchOutboxEvent> {
    return recover(this, input);
  }

  async #readEvents(dispatchId: string): Promise<readonly WorkroomRemoteDispatchOutboxEvent[]> {
    const prefix = `${digest(dispatchId)}.`;
    let names: string[];
    try {
      names = (await this.fileSystem.readdir(this.directory))
        .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
        .sort();
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const events = (await Promise.all(names.map(async name => {
      const value = JSON.parse(
        await this.fileSystem.readFile(join(this.directory, name), 'utf8'),
      ) as unknown;
      if (!Array.isArray(value)) throw new Error('Remote Dispatch Outbox segment must be an event array');
      return value.map(parseEvent);
    }))).flat().sort((left, right) => left.sequence - right.sequence);
    if (events.some(event => event.dispatchId !== dispatchId)) {
      throw new Error('Remote Dispatch Outbox dispatch identity collision');
    }
    assertContiguous(events);
    return Object.freeze(events);
  }

  #segmentPath(dispatchId: string, firstSequence: number): string {
    return join(
      this.directory,
      `${digest(dispatchId)}.${String(firstSequence).padStart(16, '0')}.json`,
    );
  }

  async #syncDirectory(): Promise<void> {
    await this.#syncDirectoryPath(this.directory);
  }

  async #ensureDurableOutboxDirectory(): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.directory);
    } catch (error) {
      if (!isAlreadyExists(error)) {
        if (isMissingFile(error)) {
          throw new Error(
            `Remote Dispatch Outbox requires a pre-existing durable parent directory: `
            + dirname(this.directory),
            { cause: error },
          );
        }
        throw error;
      }
    }
    // Repeating this for an already-live empty leaf is intentional: a prior
    // parent fsync may have failed, so existence alone is not durability proof.
    await this.#syncDirectoryPath(dirname(this.directory));
  }

  async #syncDirectoryPath(path: string): Promise<void> {
    const handle = await this.fileSystem.open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

async function enqueue(
  repository: WorkroomRemoteDispatchOutboxRepository,
  item: WorkroomRemoteDispatchOutboxItem,
  expectedSequence: number,
  enqueuedAt: number,
): Promise<WorkroomRemoteDispatchOutboxEvent> {
  const normalized = normalizeItem(item);
  const [event] = await repository.append(normalized.dispatchId, expectedSequence, [{
    eventId: `${normalized.dispatchId}:enqueued`,
    occurredAt: timestamp(enqueuedAt, 'enqueuedAt'),
    type: 'dispatch.enqueued',
    payload: { item: normalized },
  }]);
  return event!;
}

async function claim(
  repository: WorkroomRemoteDispatchOutboxRepository,
  input: WorkroomRemoteDispatchClaimInput,
): Promise<WorkroomRemoteDispatchOutboxEvent> {
  const dispatchId = identifier(input.dispatchId, 'dispatchId');
  const state = await repository.read(dispatchId);
  if (!state) throw new Error(`Remote Dispatch Outbox item does not exist: ${dispatchId}`);
  const replayingInitialClaim = state.status === 'leased'
    && state.attemptCount === 1
    && state.observations.length === 0
    && state.lease?.ownerId === input.ownerId
    && state.lease.leaseId === input.leaseId
    && state.lease.leaseFence === input.leaseFence
    && state.lease.claimedAt === input.now
    && state.lease.expiresAt === input.leaseExpiresAt;
  if ((state.status !== 'pending' || state.lease) && !replayingInitialClaim) {
    throw new Error('Remote Dispatch Outbox item is not available for an initial claim');
  }
  const now = timestamp(input.now, 'now');
  const lease = normalizeLease({
    ownerId: input.ownerId,
    leaseId: input.leaseId,
    leaseFence: input.leaseFence,
    claimedAt: now,
    expiresAt: input.leaseExpiresAt,
  });
  if (lease.leaseFence !== 1) {
    throw new Error('Initial Remote Dispatch Outbox leaseFence must be 1');
  }
  if (lease.expiresAt <= now) {
    throw new Error('Remote Dispatch Outbox lease must expire after now');
  }
  const [event] = await repository.append(dispatchId, input.expectedSequence, [{
    eventId: `${dispatchId}:claimed:${lease.leaseFence}:${encodeURIComponent(lease.leaseId)}`,
    occurredAt: now,
    type: 'dispatch.claimed',
    payload: { lease },
  }]);
  return event!;
}

async function recordTransportObservation(
  repository: WorkroomRemoteDispatchOutboxRepository,
  input: WorkroomRemoteDispatchObservationInput,
): Promise<WorkroomRemoteDispatchOutboxEvent> {
  const dispatchId = identifier(input.dispatchId, 'dispatchId');
  const observationId = identifier(input.observationId, 'observationId');
  const [event] = await repository.append(dispatchId, input.expectedSequence, [{
    eventId: `${dispatchId}:transport-observed:${encodeURIComponent(observationId)}`,
    occurredAt: timestamp(input.now, 'now'),
    type: 'dispatch.transport_observed',
    payload: {
      leaseId: identifier(input.leaseId, 'leaseId'),
      leaseFence: positiveSequence(input.leaseFence, 'leaseFence'),
      observationId,
      observation: normalizeTransportObservation(input.observation),
    },
  }]);
  return event!;
}

async function recordGovernanceBlock(
  repository: WorkroomRemoteDispatchOutboxRepository,
  input: WorkroomRemoteDispatchGovernanceBlockInput,
): Promise<WorkroomRemoteDispatchOutboxEvent> {
  const dispatchId = identifier(input.dispatchId, 'dispatchId');
  const reason = identifier(input.reason, 'governance reason');
  const manifestDigest = sha(input.manifestDigest, 'manifestDigest');
  const [event] = await repository.append(dispatchId, input.expectedSequence, [{
    eventId: `${dispatchId}:governance-blocked:${input.attempt}:${input.assignmentFence}`,
    occurredAt: timestamp(input.now, 'now'),
    type: 'dispatch.governance_blocked',
    payload: {
      reason,
      manifestDigest,
      attempt: positiveSequence(input.attempt, 'attempt'),
      assignmentFence: positiveSequence(input.assignmentFence, 'assignmentFence'),
    },
  }]);
  return event!;
}

async function recover(
  repository: WorkroomRemoteDispatchOutboxRepository,
  input: WorkroomRemoteDispatchRecoverInput,
): Promise<WorkroomRemoteDispatchOutboxEvent> {
  const dispatchId = identifier(input.dispatchId, 'dispatchId');
  const state = await repository.read(dispatchId);
  if (!state) throw new Error(`Remote Dispatch Outbox item does not exist: ${dispatchId}`);
  const now = timestamp(input.now, 'now');
  let cause: WorkroomRemoteDispatchRecoveryCause;
  if (state.status === 'reconcile_required') cause = 'outcome_unknown';
  else if (state.status === 'retryable') cause = 'transport_failed';
  else if (state.status === 'leased' && state.lease && now >= state.lease.expiresAt) {
    cause = 'lease_expired';
  } else if (state.status === 'leased'
    && state.lease?.leaseId === input.leaseId
    && state.lease.leaseFence === input.leaseFence
    && state.lastRecoveryCause) {
    cause = state.lastRecoveryCause;
  } else {
    throw new Error('Remote Dispatch Outbox item is not eligible for recovery');
  }
  const lease = normalizeLease({
    ownerId: input.ownerId,
    leaseId: input.leaseId,
    leaseFence: input.leaseFence,
    claimedAt: now,
    expiresAt: input.leaseExpiresAt,
  });
  if (lease.expiresAt <= now) throw new Error('Remote Dispatch Outbox lease must expire after now');
  const [event] = await repository.append(dispatchId, input.expectedSequence, [{
    eventId: `${dispatchId}:recovered:${lease.leaseFence}:${encodeURIComponent(lease.leaseId)}`,
    occurredAt: now,
    type: 'dispatch.recovered',
    payload: { lease, cause },
  }]);
  return event!;
}

function materializeAppend(
  dispatchId: string,
  current: readonly WorkroomRemoteDispatchOutboxEvent[],
  expectedSequence: number,
  drafts: readonly WorkroomRemoteDispatchOutboxEventDraft[],
): readonly WorkroomRemoteDispatchOutboxEvent[] {
  sequence(expectedSequence, 'expectedSequence');
  const normalized = deduplicateDrafts(drafts.map(normalizeDraft));
  const byEventId = new Map(current.map(event => [event.eventId, event]));
  const replayed: WorkroomRemoteDispatchOutboxEvent[] = [];
  for (const draft of normalized) {
    const existing = byEventId.get(draft.eventId);
    if (!existing) continue;
    if (stableJson({
      occurredAt: existing.occurredAt,
      type: existing.type,
      payload: existing.payload,
    }) !== stableJson({
      occurredAt: draft.occurredAt,
      type: draft.type,
      payload: draft.payload,
    })) {
      throw new Error(`Remote Dispatch Outbox eventId payload conflict: ${draft.eventId}`);
    }
    replayed.push(existing);
  }
  if (replayed.length > 0) {
    if (replayed.length !== normalized.length) {
      throw new Error('Remote Dispatch Outbox append cannot mix replayed and new events');
    }
    return Object.freeze(replayed);
  }
  const actualSequence = current.at(-1)?.sequence ?? -1;
  if (actualSequence !== expectedSequence) {
    throw new WorkroomRemoteDispatchOutboxSequenceConflictError(
      dispatchId,
      expectedSequence,
      actualSequence,
    );
  }
  const appended = Object.freeze(normalized.map((draft, index) => deepFreeze({
    ...draft,
    version: 1 as const,
    dispatchId,
    sequence: expectedSequence + index + 1,
  })));
  project(Object.freeze([...current, ...appended]));
  return appended;
}

function normalizeDraft(
  draft: WorkroomRemoteDispatchOutboxEventDraft,
): WorkroomRemoteDispatchOutboxEventDraft {
  const eventId = identifier(draft.eventId, 'eventId');
  const occurredAt = timestamp(draft.occurredAt, 'occurredAt');
  if (draft.type === 'dispatch.enqueued') {
    return deepFreeze({
      eventId,
      occurredAt,
      type: draft.type,
      payload: { item: normalizeItem(draft.payload?.item) },
    });
  }
  if (draft.type === 'dispatch.claimed') {
    return deepFreeze({
      eventId,
      occurredAt,
      type: draft.type,
      payload: { lease: normalizeLease(draft.payload?.lease) },
    });
  }
  if (draft.type === 'dispatch.transport_observed') {
    return deepFreeze({
      eventId,
      occurredAt,
      type: draft.type,
      payload: {
        leaseId: identifier(draft.payload?.leaseId, 'leaseId'),
        leaseFence: positiveSequence(draft.payload?.leaseFence, 'leaseFence'),
        observationId: identifier(draft.payload?.observationId, 'observationId'),
        observation: normalizeTransportObservation(draft.payload?.observation),
      },
    });
  }
  if (draft.type === 'dispatch.governance_blocked') {
    return deepFreeze({
      eventId,
      occurredAt,
      type: draft.type,
      payload: {
        reason: identifier(draft.payload?.reason, 'governance reason'),
        manifestDigest: sha(draft.payload?.manifestDigest, 'manifestDigest'),
        attempt: positiveSequence(draft.payload?.attempt, 'attempt'),
        assignmentFence: positiveSequence(draft.payload?.assignmentFence, 'assignmentFence'),
      },
    });
  }
  if (draft.type === 'dispatch.recovered') {
    return deepFreeze({
      eventId,
      occurredAt,
      type: draft.type,
      payload: {
        lease: normalizeLease(draft.payload?.lease),
        cause: recoveryCause(draft.payload?.cause),
      },
    });
  }
  throw new Error('Invalid Remote Dispatch Outbox event type');
}

function parseEvent(value: unknown): WorkroomRemoteDispatchOutboxEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Remote Dispatch Outbox event');
  }
  const event = value as Partial<WorkroomRemoteDispatchOutboxEvent>;
  const draft = normalizeDraft(event as WorkroomRemoteDispatchOutboxEventDraft);
  return deepFreeze({
    ...draft,
    version: event.version === 1 ? 1 : fail('Invalid Remote Dispatch Outbox event version'),
    dispatchId: identifier(event.dispatchId, 'dispatchId'),
    sequence: sequence(event.sequence, 'sequence'),
  });
}

function project(
  events: readonly WorkroomRemoteDispatchOutboxEvent[],
): WorkroomRemoteDispatchOutboxProjection | undefined {
  if (events.length === 0) return undefined;
  assertContiguous(events);
  const first = events[0]!;
  if (first.type !== 'dispatch.enqueued' || first.sequence !== 0) {
    throw new Error('Remote Dispatch Outbox must begin with dispatch.enqueued');
  }
  if (first.dispatchId !== first.payload.item.dispatchId) {
    throw new Error('Remote Dispatch Outbox item identity does not match stream identity');
  }
  assertDeterministicEventId(first);
  let status: WorkroomRemoteDispatchOutboxStatus = 'pending';
  let lease: WorkroomRemoteDispatchLease | undefined;
  let lastLeaseFence: number | undefined;
  let attemptCount = 0;
  const observations: WorkroomRemoteDispatchPersistedObservation[] = [];
  const observationIds = new Set<string>();
  let lastRecoveryCause: WorkroomRemoteDispatchRecoveryCause | undefined;
  let governanceBlock: WorkroomRemoteDispatchOutboxProjection['governanceBlock'];
  for (const event of events.slice(1)) {
    assertDeterministicEventId(event);
    if (event.type === 'dispatch.claimed') {
      if (status !== 'pending') {
        throw new Error(`Invalid Remote Dispatch Outbox transition: ${event.type}`);
      }
      if (event.payload.lease.leaseFence !== 1
        || event.payload.lease.claimedAt !== event.occurredAt) {
        throw new Error('Invalid initial Remote Dispatch Outbox lease/fence');
      }
      lease = event.payload.lease;
      lastLeaseFence = lease.leaseFence;
      status = 'leased';
      attemptCount += 1;
      continue;
    }
    if (event.type === 'dispatch.transport_observed') {
      if (status !== 'leased' || !lease
        || event.payload.leaseId !== lease.leaseId
        || event.payload.leaseFence !== lease.leaseFence) {
        throw new Error('Remote Dispatch Outbox observation does not match the active lease/fence');
      }
      if (event.occurredAt >= lease.expiresAt) {
        throw new Error('Remote Dispatch Outbox observation arrived after lease expiry');
      }
      if (observationIds.has(event.payload.observationId)) {
        throw new Error(`Remote Dispatch Outbox observationId conflict: ${event.payload.observationId}`);
      }
      observationIds.add(event.payload.observationId);
      observations.push(deepFreeze({
        observationId: event.payload.observationId,
        observedAt: event.occurredAt,
        leaseId: event.payload.leaseId,
        leaseFence: event.payload.leaseFence,
        ...event.payload.observation,
      }));
      status = event.payload.observation.outcome === 'delivered'
        ? 'delivered'
        : event.payload.observation.outcome === 'outcome_unknown'
          ? 'reconcile_required'
          : 'retryable';
      lease = undefined;
      continue;
    }
    if (event.type === 'dispatch.governance_blocked') {
      if (status !== 'pending' && status !== 'retryable') {
        throw new Error('Invalid Remote Dispatch governance block transition');
      }
      if (event.payload.attempt !== first.payload.item.envelope.attempt
        || event.payload.assignmentFence !== first.payload.item.envelope.fence
        || event.payload.manifestDigest
          !== first.payload.item.envelope.disclosureManifest.manifest.digest) {
        throw new Error('Remote Dispatch governance block escaped exact Assignment/Manifest authority');
      }
      status = 'blocked';
      governanceBlock = deepFreeze({ ...event.payload, blockedAt: event.occurredAt });
      lease = undefined;
      continue;
    }
    if (event.type === 'dispatch.recovered') {
      const expectedCause: WorkroomRemoteDispatchRecoveryCause | undefined =
        status === 'reconcile_required'
          ? 'outcome_unknown'
          : status === 'retryable'
            ? 'transport_failed'
            : status === 'leased' && lease && event.occurredAt >= lease.expiresAt
              ? 'lease_expired'
              : undefined;
      if (!expectedCause || event.payload.cause !== expectedCause) {
        throw new Error('Invalid Remote Dispatch Outbox recovery transition');
      }
      if (lastLeaseFence === undefined || event.payload.lease.leaseFence !== lastLeaseFence + 1) {
        throw new Error('Remote Dispatch Outbox recovery must increase the lease fence by one');
      }
      if (event.payload.lease.claimedAt !== event.occurredAt) {
        throw new Error('Remote Dispatch Outbox recovery lease does not match Kernel clock input');
      }
      lease = event.payload.lease;
      lastLeaseFence = lease.leaseFence;
      lastRecoveryCause = event.payload.cause;
      status = 'leased';
      attemptCount += 1;
      continue;
    }
    throw new Error(`Invalid Remote Dispatch Outbox transition: ${event.type}`);
  }
  return deepFreeze({
    version: 1,
    dispatchId: first.dispatchId,
    sequence: events.at(-1)!.sequence,
    status,
    item: first.payload.item,
    attemptCount,
    observations: Object.freeze(observations),
    ...(lease ? { lease } : {}),
    ...(lastLeaseFence === undefined ? {} : { lastLeaseFence }),
    ...(lastRecoveryCause === undefined ? {} : { lastRecoveryCause }),
    ...(governanceBlock === undefined ? {} : { governanceBlock }),
  });
}

function isRunnable(
  projection: WorkroomRemoteDispatchOutboxProjection,
  now: number,
): boolean {
  return projection.status === 'pending'
    || projection.status === 'retryable'
    || (projection.status === 'leased'
      && projection.lease !== undefined
      && now >= projection.lease.expiresAt);
}

function compareBlockedDispatch(
  left: WorkroomRemoteDispatchOutboxProjection,
  right: WorkroomRemoteDispatchOutboxProjection,
): number {
  return right.item.envelope.attempt - left.item.envelope.attempt
    || right.item.envelope.fence - left.item.envelope.fence
    || left.dispatchId.localeCompare(right.dispatchId);
}

function assertDeterministicEventId(event: WorkroomRemoteDispatchOutboxEvent): void {
  const expected = event.type === 'dispatch.enqueued'
    ? `${event.dispatchId}:enqueued`
    : event.type === 'dispatch.claimed'
      ? `${event.dispatchId}:claimed:${event.payload.lease.leaseFence}:`
        + encodeURIComponent(event.payload.lease.leaseId)
      : event.type === 'dispatch.transport_observed'
        ? `${event.dispatchId}:transport-observed:`
          + encodeURIComponent(event.payload.observationId)
        : event.type === 'dispatch.governance_blocked'
          ? `${event.dispatchId}:governance-blocked:${event.payload.attempt}:`
            + event.payload.assignmentFence
        : `${event.dispatchId}:recovered:${event.payload.lease.leaseFence}:`
          + encodeURIComponent(event.payload.lease.leaseId);
  if (event.eventId !== expected) {
    throw new Error(`Remote Dispatch Outbox event identity is not deterministic: ${event.eventId}`);
  }
}

function normalizeLease(value: unknown): WorkroomRemoteDispatchLease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Remote Dispatch Outbox lease');
  }
  const lease = value as Partial<WorkroomRemoteDispatchLease>;
  const claimedAt = timestamp(lease.claimedAt, 'lease.claimedAt');
  const expiresAt = timestamp(lease.expiresAt, 'lease.expiresAt');
  if (expiresAt <= claimedAt) throw new Error('Remote Dispatch Outbox lease expiry is invalid');
  return deepFreeze({
    ownerId: identifier(lease.ownerId, 'lease.ownerId'),
    leaseId: identifier(lease.leaseId, 'lease.leaseId'),
    leaseFence: positiveSequence(lease.leaseFence, 'lease.leaseFence'),
    claimedAt,
    expiresAt,
  });
}

function normalizeTransportObservation(value: unknown): WorkroomRemoteDispatchTransportObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Remote Dispatch Outbox transport observation');
  }
  const observation = value as Partial<WorkroomRemoteDispatchTransportObservation>;
  if (!['delivered', 'outcome_unknown', 'failed'].includes(observation.outcome ?? '')) {
    throw new Error('Invalid Remote Dispatch Outbox transport outcome');
  }
  return deepFreeze({
    outcome: observation.outcome!,
    receiptId: identifier(observation.receiptId, 'observation.receiptId'),
    ...optionalIdentifier(observation.remoteTaskId, 'observation.remoteTaskId'),
    ...optionalIdentifier(observation.remoteContextId, 'observation.remoteContextId'),
    ...optionalIdentifier(observation.reason, 'observation.reason'),
  });
}

function recoveryCause(value: unknown): WorkroomRemoteDispatchRecoveryCause {
  if (!['outcome_unknown', 'transport_failed', 'lease_expired'].includes(String(value))) {
    throw new Error('Invalid Remote Dispatch Outbox recovery cause');
  }
  return value as WorkroomRemoteDispatchRecoveryCause;
}

function optionalIdentifier(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  const key = name.slice(name.lastIndexOf('.') + 1);
  return { [key]: identifier(value, name) };
}

function normalizeItem(value: unknown): WorkroomRemoteDispatchOutboxItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Remote Dispatch Outbox item');
  }
  const item = value as WorkroomRemoteDispatchOutboxItem;
  const { version: _version, dispatchId: _dispatchId, messageId: _messageId, ...input } = item.envelope;
  const canonical = createWorkroomRemoteDispatchOutboxItem(input as WorkroomRemoteDispatchInput);
  assertWorkroomRemoteDispatchRetry(canonical, item);
  if (item.version !== 1
    || item.dispatchId !== item.envelope.dispatchId
    || item.messageId !== item.envelope.messageId) {
    throw new Error('Remote Dispatch Outbox item identity does not match its envelope');
  }
  return canonical;
}

function deduplicateDrafts(
  drafts: readonly WorkroomRemoteDispatchOutboxEventDraft[],
): readonly WorkroomRemoteDispatchOutboxEventDraft[] {
  const result: WorkroomRemoteDispatchOutboxEventDraft[] = [];
  const byId = new Map<string, WorkroomRemoteDispatchOutboxEventDraft>();
  for (const draft of drafts) {
    const existing = byId.get(draft.eventId);
    if (existing) {
      if (stableJson(existing) !== stableJson(draft)) {
        throw new Error(`Remote Dispatch Outbox eventId payload conflict: ${draft.eventId}`);
      }
      continue;
    }
    byId.set(draft.eventId, draft);
    result.push(draft);
  }
  return Object.freeze(result);
}

function assertContiguous(events: readonly WorkroomRemoteDispatchOutboxEvent[]): void {
  events.forEach((event, index) => {
    if (event.sequence !== index) throw new Error('Remote Dispatch Outbox sequence is not contiguous');
  });
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${name}`);
  return value;
}

function sha(value: unknown, name: string): string {
  const normalized = identifier(value, name);
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) throw new Error(`Invalid ${name}`);
  return normalized;
}

function timestamp(value: unknown, name: string): number {
  if (!Number.isFinite(value) || (value as number) < 0) throw new Error(`Invalid ${name}`);
  return value as number;
}

function sequence(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < -1) throw new Error(`Invalid ${name}`);
  return value as number;
}

function positiveSequence(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`Invalid ${name}`);
  return value as number;
}

function fail(message: string): never {
  throw new Error(message);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
