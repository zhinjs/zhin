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
import type { AssignmentExecutionObservation } from './assignment-executor.js';

export interface RemoteExecutionLinkInput {
  readonly linkedAt: number;
  readonly reconcileDeadline: number;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly assignmentEnvelopeDigest: string;
  readonly dispatchId: string;
  readonly messageId: string;
  readonly dispatchEnvelopeDigest: string;
  readonly endpoint: Readonly<{
    id: string;
    cardDigest: string;
    authBindingId: string;
  }>;
  readonly remoteTaskId: string;
  readonly remoteContextId: string;
  readonly workspace: Readonly<{
    provider: 'github_pull_request';
    repositoryId: string;
    integrationBindingId: string;
    baseSha: string;
    checkpointSha?: string;
    targetRef: string;
    branchRef: string;
    pathScope: readonly string[];
    mode: 'branch_only' | 'branch_and_pr';
    fence: number;
  }>;
}

export interface RemoteExecutionLink extends RemoteExecutionLinkInput {
  readonly version: 1;
  readonly id: string;
  readonly digest: string;
}

export interface RemoteProgressCallbackPayload {
  readonly type: 'progress';
  readonly progress: Readonly<{
    summary: string;
    completedUnits?: number;
    totalUnits?: number;
  }>;
}

export interface RemoteHeartbeatCallbackPayload {
  readonly type: 'heartbeat';
}

export interface RemoteCheckpointCallbackPayload {
  readonly type: 'checkpoint';
  readonly checkpoint: Readonly<{ ref: string; digest: string }>;
}

export interface RemoteGithubCompletionReceipt {
  readonly provider: 'github_pull_request';
  readonly repositoryId: string;
  readonly integrationBindingId: string;
  readonly baseSha: string;
  readonly checkpointSha?: string;
  readonly targetRef: string;
  readonly branchRef: string;
  readonly pathScope: readonly string[];
  readonly mode: 'branch_only' | 'branch_and_pr';
  readonly headSha: string;
  readonly pullRequestRef?: string;
  readonly pullRequestHash?: string;
  readonly fence: number;
}

export interface RemoteCompletionContentReference {
  readonly ref: string;
  readonly digest: string;
}

export interface RemoteCompletionReceipt {
  readonly report: Readonly<{ ref: string; digest: string }>;
  readonly candidate: Readonly<{ ref: string; hash: string }>;
  readonly claims: readonly RemoteCompletionContentReference[];
  readonly evidence: readonly RemoteCompletionContentReference[];
  readonly workspaceReceipt: RemoteGithubCompletionReceipt;
}

export interface RemoteExecutionCompletedCallbackPayload {
  readonly type: 'execution_completed';
  readonly completion: Readonly<{
    report: Readonly<{ ref: string; digest: string }>;
    candidate: Readonly<{ ref: string; hash: string }>;
    claims: readonly RemoteCompletionContentReference[];
    evidence: readonly RemoteCompletionContentReference[];
    workspaceReceipt: RemoteGithubCompletionReceipt;
  }>;
}

export type RemoteCallbackPayload =
  | RemoteProgressCallbackPayload
  | RemoteHeartbeatCallbackPayload
  | RemoteCheckpointCallbackPayload
  | RemoteExecutionCompletedCallbackPayload;

/** Remote-controlled callback body. None of these fields prove transport authority. */
export interface RemoteCallbackMessage {
  readonly version: 1;
  readonly callbackSequence: number;
  readonly eventId: string;
  readonly linkId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly assignmentEnvelopeDigest: string;
  readonly dispatchId: string;
  readonly messageId: string;
  readonly dispatchEnvelopeDigest: string;
  readonly claimedEndpoint: Readonly<{
    endpointId: string;
    cardDigest: string;
    authBindingId: string;
  }>;
  readonly remoteTaskId: string;
  readonly remoteContextId: string;
  readonly payload: RemoteCallbackPayload;
}

/**
 * Trusted gateway observation, constructed outside remote-controlled JSON
 * after endpoint authentication and bound to the exact canonical callback.
 */
export interface RemoteCallbackGatewayReceipt {
  readonly receiptId: string;
  readonly source: 'push' | 'poll';
  readonly receivedAt: number;
  readonly endpointId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly callbackDigest: string;
}

export interface RemoteCallbackEnvelope extends RemoteCallbackMessage {
  readonly gatewayReceipt: RemoteCallbackGatewayReceipt;
}

export interface RemoteCallbackReconciliationReceiptInput {
  readonly receiptId: string;
  readonly source: 'poll';
  readonly reconciledAt: number;
  readonly endpointId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly linkId: string;
  readonly fromCursor: number;
  readonly snapshotCursor: number;
  readonly callbackDigests: readonly string[];
}

export interface RemoteCallbackReconciliationReceipt
extends RemoteCallbackReconciliationReceiptInput {
  readonly batchDigest: string;
}

export type RemoteCallbackInboxStatus = 'open' | 'reconcile_required' | 'terminal_observed';

export interface RemoteCallbackAcceptedRecord {
  readonly endpointId: string;
  readonly eventId: string;
  readonly payloadHash: string;
  readonly callbackDigest: string;
  readonly callbackSequence: number;
  readonly receivedAt: number;
  readonly gatewayReceipt: RemoteCallbackGatewayReceipt;
  readonly reconciliationReceipt?: RemoteCallbackReconciliationReceipt;
  readonly observation: AssignmentExecutionObservation;
  readonly completionReceipt?: RemoteCompletionReceipt;
}

export interface RemoteCallbackInboxProjection {
  readonly version: 1;
  readonly link: RemoteExecutionLink;
  readonly sequence: number;
  readonly status: RemoteCallbackInboxStatus;
  readonly callbackCursor: number;
  readonly accepted: readonly RemoteCallbackAcceptedRecord[];
  readonly deferred: readonly RemoteCallbackEnvelope[];
  readonly terminalReceipt?: RemoteCompletionReceipt;
}

interface LinkRegisteredDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'link.registered';
  readonly payload: Readonly<{ link: RemoteExecutionLink }>;
}

interface CallbackAcceptedDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'callback.accepted';
  readonly payload: Readonly<{
    envelope: RemoteCallbackEnvelope;
    payloadHash: string;
    observation: AssignmentExecutionObservation;
    completionReceipt?: RemoteCompletionReceipt;
    reconciliationReceipt?: RemoteCallbackReconciliationReceipt;
    reconciliationBatch?: readonly RemoteCallbackEnvelope[];
  }>;
}

interface CallbackDeferredDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'callback.deferred';
  readonly payload: Readonly<{
    envelope: RemoteCallbackEnvelope;
    payloadHash: string;
  }>;
}

export type RemoteCallbackInboxEventDraft =
  | LinkRegisteredDraft
  | CallbackAcceptedDraft
  | CallbackDeferredDraft;

export type RemoteCallbackInboxEvent = RemoteCallbackInboxEventDraft & Readonly<{
  readonly version: 1;
  readonly linkId: string;
  readonly sequence: number;
}>;

export interface RemoteCallbackInboxRepository {
  read(linkId: string): Promise<RemoteCallbackInboxProjection | undefined>;
  append(
    linkId: string,
    expectedSequence: number,
    drafts: readonly RemoteCallbackInboxEventDraft[],
  ): Promise<readonly RemoteCallbackInboxEvent[]>;
}

export class RemoteCallbackInboxSequenceConflictError extends Error {
  constructor(
    readonly linkId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(
      `Remote Callback Inbox ${linkId} sequence conflict: expected ${expectedSequence}, `
      + `actual ${actualSequence}`,
    );
    this.name = 'RemoteCallbackInboxSequenceConflictError';
  }
}

export class MemoryRemoteCallbackInboxRepository implements RemoteCallbackInboxRepository {
  readonly #events = new Map<string, readonly RemoteCallbackInboxEvent[]>();

  async read(linkId: string): Promise<RemoteCallbackInboxProjection | undefined> {
    return project(this.#events.get(identifier(linkId, 'linkId')) ?? []);
  }

  async append(
    linkId: string,
    expectedSequence: number,
    drafts: readonly RemoteCallbackInboxEventDraft[],
  ): Promise<readonly RemoteCallbackInboxEvent[]> {
    const id = identifier(linkId, 'linkId');
    const current = this.#events.get(id) ?? [];
    const appended = materializeAppend(id, current, expectedSequence, drafts);
    if (appended.some(event => event.sequence >= current.length)) {
      this.#events.set(id, Object.freeze([...current, ...appended]));
    }
    return appended;
  }
}

export interface RemoteCallbackInboxFileHandle {
  writeFile(value: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface RemoteCallbackInboxFileSystem {
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  open(path: string, flags: 'wx' | 'r'): Promise<RemoteCallbackInboxFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nodeFileSystem: RemoteCallbackInboxFileSystem = Object.freeze({
  mkdir: async (path: string): Promise<void> => { await nodeMkdir(path); },
  readdir: async (path: string): Promise<readonly string[]> => await nodeReaddir(path),
  readFile: async (path: string, encoding: 'utf8'): Promise<string> =>
    await nodeReadFile(path, encoding),
  open: async (
    path: string,
    flags: 'wx' | 'r',
  ): Promise<RemoteCallbackInboxFileHandle> => await nodeOpen(path, flags),
  link: async (existingPath: string, newPath: string): Promise<void> =>
    await nodeLink(existingPath, newPath),
  unlink: async (path: string): Promise<void> => await nodeUnlink(path),
});

/** Immutable file segments plus hard-link claim provide a restart-safe filesystem CAS. */
export class FileRemoteCallbackInboxRepository implements RemoteCallbackInboxRepository {
  constructor(
    readonly directory: string,
    readonly fileSystem: RemoteCallbackInboxFileSystem = nodeFileSystem,
  ) {}

  async read(linkId: string): Promise<RemoteCallbackInboxProjection | undefined> {
    const events = await this.#readEvents(identifier(linkId, 'linkId'));
    // A prior hard-link may have succeeded while its directory fsync failed.
    // Re-observing the file is not durability proof; sync before confirming it.
    if (events.length > 0) await this.#syncDirectory();
    return project(events);
  }

  async append(
    linkId: string,
    expectedSequence: number,
    drafts: readonly RemoteCallbackInboxEventDraft[],
  ): Promise<readonly RemoteCallbackInboxEvent[]> {
    const id = identifier(linkId, 'linkId');
    const current = await this.#readEvents(id);
    const appended = materializeAppend(id, current, expectedSequence, drafts);
    if (appended.length === 0 || appended.every(event => event.sequence < current.length)) {
      if (current.length > 0) await this.#syncDirectory();
      return appended;
    }
    await this.#ensureDirectory();
    const firstSequence = appended[0]!.sequence;
    const streamDigest = hash(id);
    const segmentPath = join(
      this.directory,
      `${streamDigest}.${String(firstSequence).padStart(16, '0')}.json`,
    );
    const encoded = JSON.stringify(appended);
    // UUID is only an ephemeral filesystem staging name. All durable/domain
    // identities remain deterministic and caller supplied.
    const temporaryPath = `${segmentPath}.${randomUUID()}.tmp`;
    let temporaryExists = false;
    try {
      const handle = await this.fileSystem.open(temporaryPath, 'wx');
      temporaryExists = true;
      try {
        await handle.writeFile(encoded, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.fileSystem.link(temporaryPath, segmentPath);
      await this.fileSystem.unlink(temporaryPath);
      temporaryExists = false;
      await this.#syncDirectory();
    } catch (error) {
      if (temporaryExists) {
        await this.fileSystem.unlink(temporaryPath).catch(cleanupError => {
          if (!isMissingFile(cleanupError)) throw cleanupError;
        });
        temporaryExists = false;
      }
      if (!isAlreadyExists(error)) throw error;
      const winner = await this.#readEvents(id);
      const replay = materializeAppend(id, winner, expectedSequence, drafts);
      await this.#syncDirectory();
      if (replay.length > 0 && replay.every(event => event.sequence < winner.length)) return replay;
      throw new RemoteCallbackInboxSequenceConflictError(
        id,
        expectedSequence,
        winner.at(-1)?.sequence ?? -1,
      );
    } finally {
      if (temporaryExists) {
        await this.fileSystem.unlink(temporaryPath).catch(error => {
          if (!isMissingFile(error)) throw error;
        });
      }
    }
    return appended;
  }

  async #readEvents(linkId: string): Promise<readonly RemoteCallbackInboxEvent[]> {
    const prefix = `${hash(linkId)}.`;
    let names: readonly string[];
    try {
      names = (await this.fileSystem.readdir(this.directory))
        .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
        .sort();
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const segments = await Promise.all(names.map(async name => {
      const encodedSequence = name.slice(prefix.length, -'.json'.length);
      if (!/^\d{16}$/u.test(encodedSequence)) {
        throw new Error('Remote Callback Inbox segment filename sequence is invalid');
      }
      const firstSequence = Number(encodedSequence);
      const parsed = JSON.parse(await this.fileSystem.readFile(join(this.directory, name), 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Remote Callback Inbox segment must be an event array');
      const events = parsed.map(parseEvent);
      if (events.length === 0 || events[0]!.sequence !== firstSequence) {
        throw new Error('Remote Callback Inbox segment filename sequence does not bind its first event');
      }
      return events;
    }));
    const events = segments.flat().sort((left, right) => left.sequence - right.sequence);
    if (events.some(event => event.linkId !== linkId)) {
      throw new Error('Remote Callback Inbox link identity collision');
    }
    assertContiguous(events);
    return Object.freeze(events);
  }

  async #ensureDirectory(): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.directory);
    } catch (error) {
      if (!isAlreadyExists(error)) {
        if (isMissingFile(error)) {
          throw new Error(
            `Remote Callback Inbox requires a pre-existing durable parent directory: ${dirname(this.directory)}`,
            { cause: error },
          );
        }
        throw error;
      }
    }
    await this.#syncPath(dirname(this.directory));
  }

  async #syncDirectory(): Promise<void> {
    await this.#syncPath(this.directory);
  }

  async #syncPath(path: string): Promise<void> {
    const handle = await this.fileSystem.open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export interface RemoteCallbackInboxOptions {
  readonly maxSequenceGap: number;
}

export interface RemoteCallbackReceiveResult {
  readonly duplicate: boolean;
  readonly observation?: AssignmentExecutionObservation;
  readonly projection: RemoteCallbackInboxProjection;
}

export class RemoteCallbackInbox {
  readonly #maxSequenceGap: number;

  constructor(
    readonly repository: RemoteCallbackInboxRepository,
    readonly link: RemoteExecutionLink,
    options: RemoteCallbackInboxOptions,
  ) {
    assertRemoteExecutionLink(link);
    this.#maxSequenceGap = positiveInteger(options.maxSequenceGap, 'maxSequenceGap');
  }

  async read(): Promise<RemoteCallbackInboxProjection | undefined> {
    const projection = await this.repository.read(this.link.id);
    if (projection && stableJson(projection.link) !== stableJson(this.link)) {
      throw new Error('Remote Callback Inbox persisted Link does not match the trusted Link');
    }
    return projection;
  }

  async receive(
    envelope: RemoteCallbackEnvelope,
    expectedSequence: number,
  ): Promise<RemoteCallbackReceiveResult> {
    const normalized = normalizeEnvelope(this.link, envelope);
    const current = await this.read();
    const duplicate = findDuplicate(current, normalized);
    if (duplicate) {
      return deepFreeze({
        duplicate: true,
        ...(duplicate.observation ? { observation: duplicate.observation } : {}),
        projection: current!,
      });
    }
    const actualSequence = current?.sequence ?? -1;
    if (actualSequence !== expectedSequence) {
      throw new RemoteCallbackInboxSequenceConflictError(this.link.id, expectedSequence, actualSequence);
    }
    if (current?.status === 'terminal_observed') {
      throw new Error('Remote Callback Inbox cannot accept callbacks after terminal observation');
    }
    const cursor = current?.callbackCursor ?? 0;
    const drafts: RemoteCallbackInboxEventDraft[] = [];
    if (!current) drafts.push(registeredDraft(this.link));
    if (current?.status === 'reconcile_required' || normalized.callbackSequence > cursor + 1) {
      const gap = normalized.callbackSequence - (cursor + 1);
      if (gap > this.#maxSequenceGap) {
        throw new Error('Remote Callback Inbox callback sequence gap exceeds the bounded window');
      }
      assertAvailableSequence(current, normalized);
      drafts.push(deferredDraft(normalized));
    } else {
      if (normalized.callbackSequence !== cursor + 1) {
        throw new Error('Remote Callback Inbox callback sequence is stale or non-monotonic');
      }
      drafts.push(acceptedDraft(this.link, normalized));
    }
    await this.repository.append(this.link.id, expectedSequence, drafts);
    const projection = await this.read();
    if (!projection) throw new Error('Remote Callback Inbox projection disappeared after receive');
    const accepted = projection.accepted.find(item => item.eventId === normalized.eventId);
    return deepFreeze({
      duplicate: false,
      ...(accepted ? { observation: accepted.observation } : {}),
      projection,
    });
  }

  async reconcile(
    envelopes: readonly RemoteCallbackEnvelope[],
    expectedSequence: number,
    value: RemoteCallbackReconciliationReceipt,
  ): Promise<RemoteCallbackInboxProjection> {
    const current = await this.read();
    if (!current) {
      throw new Error('Remote Callback Inbox has no sequence gap to reconcile');
    }
    const normalizedEnvelopes = envelopes.map(value => normalizeEnvelope(this.link, value));
    const reconciliationReceipt = normalizeReconciliationReceipt(
      this.link,
      value,
      normalizedEnvelopes,
    );
    if (current.status !== 'reconcile_required') {
      const durableReplay = expectedSequence < current.sequence
        && normalizedEnvelopes.every(envelope => findDuplicate(current, envelope) !== undefined)
        && current.accepted.some(item =>
          stableJson(item.reconciliationReceipt) === stableJson(reconciliationReceipt));
      if (durableReplay) return current;
      throw new Error('Remote Callback Inbox has no sequence gap to reconcile');
    }
    if (current.sequence !== expectedSequence) {
      throw new RemoteCallbackInboxSequenceConflictError(this.link.id, expectedSequence, current.sequence);
    }
    if (reconciliationReceipt.fromCursor !== current.callbackCursor) {
      throw new Error('Remote Callback Inbox poll receipt cursor does not match the durable cursor');
    }
    const expectedSnapshotCursor = Math.max(
      current.callbackCursor,
      ...current.deferred.map(envelope => envelope.callbackSequence),
      ...normalizedEnvelopes.map(envelope => envelope.callbackSequence),
    );
    if (reconciliationReceipt.snapshotCursor !== expectedSnapshotCursor) {
      throw new Error('Remote Callback Inbox poll snapshot cursor is incomplete or drifted');
    }
    if (reconciliationReceipt.reconciledAt > this.link.reconcileDeadline) {
      throw new Error('Remote Callback Inbox reconciliation deadline has expired');
    }
    const pending = new Map(current.deferred.map(envelope => [envelope.callbackSequence, envelope]));
    const incomingByIdentity = new Map<string, RemoteCallbackEnvelope>();
    for (const normalized of normalizedEnvelopes) {
      const identity = `${normalized.gatewayReceipt.endpointId}\0${normalized.eventId}`;
      const priorIncoming = incomingByIdentity.get(identity);
      if (priorIncoming) {
        if (priorIncoming.gatewayReceipt.callbackDigest
          !== normalized.gatewayReceipt.callbackDigest) {
          throw new Error('Remote Callback Inbox reconciliation callback body drift');
        }
        continue;
      }
      incomingByIdentity.set(identity, normalized);
      const duplicate = findDuplicate(current, normalized);
      if (duplicate) continue;
      if (normalized.callbackSequence - (current.callbackCursor + 1) > this.#maxSequenceGap) {
        throw new Error('Remote Callback Inbox callback sequence gap exceeds the bounded window');
      }
      assertAvailableSequence(current, normalized, pending);
      pending.set(normalized.callbackSequence, normalized);
    }
    const ordered = [...pending.values()].sort((left, right) => left.callbackSequence - right.callbackSequence);
    const terminalIndex = ordered.findIndex(envelope =>
      envelope.payload.type === 'execution_completed');
    if (terminalIndex >= 0 && terminalIndex !== ordered.length - 1) {
      throw new Error('Remote Callback Inbox cannot reconcile callbacks after terminal observation');
    }
    const drafts: RemoteCallbackInboxEventDraft[] = [];
    let cursor = current.callbackCursor;
    for (const envelope of ordered) {
      if (envelope.callbackSequence !== cursor + 1) break;
      drafts.push(acceptedDraft(
        this.link,
        envelope,
        reconciliationReceipt,
        normalizedEnvelopes,
      ));
      cursor += 1;
      if (envelope.payload.type === 'execution_completed') break;
    }
    for (const envelope of incomingByIdentity.values()) {
      if (current.deferred.some(item => item.eventId === envelope.eventId)
        || drafts.some(draft => draft.type === 'callback.accepted'
          && draft.payload.envelope.eventId === envelope.eventId)) continue;
      drafts.push(deferredDraft(envelope));
    }
    if (drafts.length === 0) return current;
    await this.repository.append(this.link.id, expectedSequence, drafts);
    const projection = await this.read();
    if (!projection) throw new Error('Remote Callback Inbox projection disappeared after reconcile');
    return projection;
  }
}

export function createRemoteExecutionLink(input: RemoteExecutionLinkInput): RemoteExecutionLink {
  validateLinkInput(input);
  const id = `remote-execution-link:v1:${[
    input.projectId,
    input.runId,
    input.assignmentId,
    String(input.attempt),
    String(input.fence),
  ].map(encodeURIComponent).join(':')}`;
  const projection = deepFreeze({
    version: 1 as const,
    id,
    ...input,
    endpoint: { ...input.endpoint },
    workspace: { ...input.workspace, pathScope: [...input.workspace.pathScope] },
  });
  return deepFreeze({ ...projection, digest: digest(projection) });
}

/** Canonical body digest computed before the trusted gateway receipt is attached. */
export function digestRemoteCallbackMessage(
  value: RemoteCallbackMessage | RemoteCallbackEnvelope,
): string {
  const { gatewayReceipt: _gatewayReceipt, ...message } = value as RemoteCallbackEnvelope;
  return digest(message);
}

export function digestRemoteCallbackReconciliationBatch(
  input: RemoteCallbackReconciliationReceiptInput,
): string {
  return digest({
    receiptId: input.receiptId,
    source: input.source,
    reconciledAt: input.reconciledAt,
    endpointId: input.endpointId,
    cardDigest: input.cardDigest,
    authBindingId: input.authBindingId,
    linkId: input.linkId,
    fromCursor: input.fromCursor,
    snapshotCursor: input.snapshotCursor,
    callbackDigests: input.callbackDigests,
  });
}

function assertRemoteExecutionLink(value: RemoteExecutionLink): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid Remote Execution Link');
  const { version, id, digest: actualDigest, ...input } = value;
  if (version !== 1) throw new Error('Remote Execution Link version is unsupported');
  const canonical = createRemoteExecutionLink(input);
  if (id !== canonical.id || actualDigest !== canonical.digest || stableJson(value) !== stableJson(canonical)) {
    throw new Error('Remote Execution Link identity or digest is invalid');
  }
  if (!Object.isFrozen(value) || !Object.isFrozen(value.endpoint) || !Object.isFrozen(value.workspace)) {
    throw new Error('Remote Execution Link must be deeply immutable');
  }
}

function validateLinkInput(input: RemoteExecutionLinkInput): void {
  assertExactKeys(input, [
    'linkedAt', 'reconcileDeadline', 'projectId', 'runId', 'taskKey',
    'taskRevision', 'assignmentId', 'assignmentRevision', 'attempt', 'fence',
    'assignmentEnvelopeDigest', 'dispatchId', 'messageId',
    'dispatchEnvelopeDigest', 'endpoint', 'remoteTaskId', 'remoteContextId',
    'workspace',
  ], 'Remote Execution Link input');
  assertExactKeys(input.endpoint, ['id', 'cardDigest', 'authBindingId'], 'Link endpoint');
  assertExactKeys(input.workspace, [
    'provider', 'repositoryId', 'integrationBindingId', 'baseSha', 'checkpointSha',
    'targetRef', 'branchRef', 'pathScope', 'mode', 'fence',
  ], 'Link workspace');
  timestamp(input.linkedAt, 'linkedAt');
  timestamp(input.reconcileDeadline, 'reconcileDeadline');
  if (input.reconcileDeadline <= input.linkedAt) throw new Error('Remote Execution Link deadline is invalid');
  for (const [name, value] of Object.entries({
    projectId: input.projectId,
    runId: input.runId,
    taskKey: input.taskKey,
    assignmentId: input.assignmentId,
    dispatchId: input.dispatchId,
    messageId: input.messageId,
    endpointId: input.endpoint.id,
    authBindingId: input.endpoint.authBindingId,
    remoteTaskId: input.remoteTaskId,
    remoteContextId: input.remoteContextId,
    repositoryId: input.workspace.repositoryId,
    integrationBindingId: input.workspace.integrationBindingId,
    targetRef: input.workspace.targetRef,
    branchRef: input.workspace.branchRef,
  })) identifier(value, name);
  for (const [name, value] of Object.entries({
    taskRevision: input.taskRevision,
    assignmentRevision: input.assignmentRevision,
    attempt: input.attempt,
    fence: input.fence,
  })) positiveInteger(value, name);
  requireDigest(input.assignmentEnvelopeDigest, 'assignmentEnvelopeDigest');
  requireDigest(input.dispatchEnvelopeDigest, 'dispatchEnvelopeDigest');
  requireDigest(input.endpoint.cardDigest, 'endpoint.cardDigest');
  if (input.workspace.provider !== 'github_pull_request') throw new Error('Remote Execution Link workspace provider is unsupported');
  requireGitSha(input.workspace.baseSha, 'workspace.baseSha');
  if (input.workspace.checkpointSha !== undefined) {
    requireGitSha(input.workspace.checkpointSha, 'workspace.checkpointSha');
  }
  if (input.workspace.fence !== input.fence) throw new Error('Remote Execution Link workspace fence mismatch');
  requireGitRef(input.workspace.targetRef, 'workspace.targetRef');
  requireGitRef(input.workspace.branchRef, 'workspace.branchRef');
  if (!Array.isArray(input.workspace.pathScope) || input.workspace.pathScope.length === 0
    || input.workspace.pathScope.some(path => !isCanonicalRelativePath(path))) {
    throw new Error('Remote Execution Link workspace pathScope must contain canonical relative paths');
  }
  if (new Set(input.workspace.pathScope).size !== input.workspace.pathScope.length) {
    throw new Error('Remote Execution Link workspace pathScope must be unique');
  }
  if (input.workspace.mode !== 'branch_only' && input.workspace.mode !== 'branch_and_pr') {
    throw new Error('Remote Execution Link workspace mode is unsupported');
  }
  if (input.workspace.targetRef === input.workspace.branchRef) throw new Error('Remote Execution Link requires an attempt branch distinct from target');
}

function registeredDraft(link: RemoteExecutionLink): LinkRegisteredDraft {
  return deepFreeze({
    eventId: `${link.id}:registered`,
    occurredAt: link.linkedAt,
    type: 'link.registered',
    payload: { link },
  });
}

function acceptedDraft(
  link: RemoteExecutionLink,
  envelope: RemoteCallbackEnvelope,
  reconciliationReceipt?: RemoteCallbackReconciliationReceipt,
  reconciliationBatch?: readonly RemoteCallbackEnvelope[],
): CallbackAcceptedDraft {
  const normalized = normalizeCallback(link, envelope);
  return deepFreeze({
    eventId: callbackEventId(link.id, 'accepted', envelope),
    occurredAt: reconciliationReceipt?.reconciledAt ?? envelope.gatewayReceipt.receivedAt,
    type: 'callback.accepted',
    payload: {
      envelope,
      payloadHash: digest(envelope.payload),
      observation: normalized.observation,
      ...(normalized.completionReceipt
        ? { completionReceipt: normalized.completionReceipt }
        : {}),
      ...(reconciliationReceipt ? { reconciliationReceipt } : {}),
      ...(reconciliationBatch
        ? { reconciliationBatch: deepFreeze(structuredClone(reconciliationBatch)) }
        : {}),
    },
  });
}

function deferredDraft(envelope: RemoteCallbackEnvelope): CallbackDeferredDraft {
  return deepFreeze({
    eventId: callbackEventId(envelope.linkId, 'deferred', envelope),
    occurredAt: envelope.gatewayReceipt.receivedAt,
    type: 'callback.deferred',
    payload: { envelope, payloadHash: digest(envelope.payload) },
  });
}

function callbackEventId(
  linkId: string,
  disposition: 'accepted' | 'deferred',
  envelope: RemoteCallbackEnvelope,
): string {
  return `${linkId}:${disposition}:${encodeURIComponent(envelope.gatewayReceipt.endpointId)}:`
    + encodeURIComponent(envelope.eventId);
}

function normalizeEnvelope(
  link: RemoteExecutionLink,
  value: RemoteCallbackEnvelope,
): RemoteCallbackEnvelope {
  const envelope = deepFreeze(structuredClone(value));
  assertExactKeys(envelope, [
    'version', 'callbackSequence', 'eventId', 'linkId', 'projectId', 'runId',
    'taskKey', 'taskRevision', 'assignmentId', 'assignmentRevision', 'attempt',
    'fence', 'assignmentEnvelopeDigest', 'dispatchId', 'messageId',
    'dispatchEnvelopeDigest', 'claimedEndpoint', 'remoteTaskId',
    'remoteContextId', 'payload', 'gatewayReceipt',
  ], 'Envelope');
  assertExactKeys(envelope.claimedEndpoint, [
    'endpointId', 'cardDigest', 'authBindingId',
  ], 'claimed endpoint');
  assertExactKeys(envelope.gatewayReceipt, [
    'receiptId', 'source', 'receivedAt', 'endpointId', 'cardDigest', 'authBindingId',
    'callbackDigest',
  ], 'trusted Gateway receipt');
  const exactBindings = [
    ['version', envelope.version, 1],
    ['linkId', envelope.linkId, link.id],
    ['projectId', envelope.projectId, link.projectId],
    ['runId', envelope.runId, link.runId],
    ['taskKey', envelope.taskKey, link.taskKey],
    ['taskRevision', envelope.taskRevision, link.taskRevision],
    ['assignmentId', envelope.assignmentId, link.assignmentId],
    ['assignmentRevision', envelope.assignmentRevision, link.assignmentRevision],
    ['attempt', envelope.attempt, link.attempt],
    ['fence', envelope.fence, link.fence],
    ['assignmentEnvelopeDigest', envelope.assignmentEnvelopeDigest, link.assignmentEnvelopeDigest],
    ['dispatchId', envelope.dispatchId, link.dispatchId],
    ['messageId', envelope.messageId, link.messageId],
    ['dispatchEnvelopeDigest', envelope.dispatchEnvelopeDigest, link.dispatchEnvelopeDigest],
    ['claimedEndpointId', envelope.claimedEndpoint?.endpointId, link.endpoint.id],
    ['claimedCardDigest', envelope.claimedEndpoint?.cardDigest, link.endpoint.cardDigest],
    ['claimedAuthBindingId', envelope.claimedEndpoint?.authBindingId, link.endpoint.authBindingId],
    ['authenticatedEndpointId', envelope.gatewayReceipt?.endpointId, link.endpoint.id],
    ['authenticatedCardDigest', envelope.gatewayReceipt?.cardDigest, link.endpoint.cardDigest],
    ['authenticatedAuthBindingId', envelope.gatewayReceipt?.authBindingId, link.endpoint.authBindingId],
    ['remoteTaskId', envelope.remoteTaskId, link.remoteTaskId],
    ['remoteContextId', envelope.remoteContextId, link.remoteContextId],
  ] as const;
  const drift = exactBindings.find(([, actual, expected]) => actual !== expected);
  if (drift) throw new Error(`Remote Callback Inbox ${drift[0]} does not match the trusted Link`);
  identifier(envelope.gatewayReceipt.receiptId, 'gatewayReceipt.receiptId');
  if (envelope.gatewayReceipt.source !== 'push' && envelope.gatewayReceipt.source !== 'poll') {
    throw new Error('Remote Callback Inbox Gateway receipt source is invalid');
  }
  timestamp(envelope.gatewayReceipt.receivedAt, 'gatewayReceipt.receivedAt');
  requireDigest(envelope.gatewayReceipt.callbackDigest, 'gatewayReceipt.callbackDigest');
  if (envelope.gatewayReceipt.callbackDigest !== digestRemoteCallbackMessage(envelope)) {
    throw new Error('Remote Callback Inbox Gateway receipt does not bind the exact callback body');
  }
  positiveInteger(envelope.callbackSequence, 'callbackSequence');
  identifier(envelope.eventId, 'eventId');
  normalizeCallback(link, envelope);
  return envelope;
}

function normalizeReconciliationReceipt(
  link: RemoteExecutionLink,
  value: RemoteCallbackReconciliationReceipt,
  envelopes?: readonly RemoteCallbackEnvelope[],
): RemoteCallbackReconciliationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote Callback Inbox poll reconciliation receipt must be an object');
  }
  assertExactKeys(value, [
    'receiptId', 'source', 'reconciledAt', 'endpointId', 'cardDigest',
    'authBindingId', 'linkId', 'fromCursor', 'snapshotCursor',
    'callbackDigests', 'batchDigest',
  ], 'poll reconciliation receipt');
  identifier(value.receiptId, 'reconciliationReceipt.receiptId');
  if (value.source !== 'poll') {
    throw new Error('Remote Callback Inbox reconciliation requires a trusted poll receipt');
  }
  timestamp(value.reconciledAt, 'reconciliationReceipt.reconciledAt');
  nonNegativeInteger(value.fromCursor, 'reconciliationReceipt.fromCursor');
  nonNegativeInteger(value.snapshotCursor, 'reconciliationReceipt.snapshotCursor');
  const exactBindings = [
    ['endpointId', value.endpointId, link.endpoint.id],
    ['cardDigest', value.cardDigest, link.endpoint.cardDigest],
    ['authBindingId', value.authBindingId, link.endpoint.authBindingId],
    ['linkId', value.linkId, link.id],
  ] as const;
  const drift = exactBindings.find(([, actual, expected]) => actual !== expected);
  if (drift) {
    throw new Error(`Remote Callback Inbox poll receipt ${drift[0]} does not match the Link`);
  }
  if (!Array.isArray(value.callbackDigests)) {
    throw new Error('Remote Callback Inbox poll receipt callbackDigests must be an array');
  }
  const callbackDigests = value.callbackDigests.map((item, index) => {
    requireDigest(item, `reconciliationReceipt.callbackDigests[${index}]`);
    return item;
  });
  if (new Set(callbackDigests).size !== callbackDigests.length) {
    throw new Error('Remote Callback Inbox poll receipt callbackDigests must be unique');
  }
  const expectedDigests = envelopes?.map(envelope => envelope.gatewayReceipt.callbackDigest);
  if (expectedDigests && stableJson(callbackDigests) !== stableJson(expectedDigests)) {
    throw new Error('Remote Callback Inbox poll receipt does not bind the exact callback batch');
  }
  const input = deepFreeze({
    receiptId: value.receiptId,
    source: 'poll' as const,
    reconciledAt: value.reconciledAt,
    endpointId: value.endpointId,
    cardDigest: value.cardDigest,
    authBindingId: value.authBindingId,
    linkId: value.linkId,
    fromCursor: value.fromCursor,
    snapshotCursor: value.snapshotCursor,
    callbackDigests,
  });
  requireDigest(value.batchDigest, 'reconciliationReceipt.batchDigest');
  if (value.batchDigest !== digestRemoteCallbackReconciliationBatch(input)) {
    throw new Error('Remote Callback Inbox poll receipt batch digest is invalid');
  }
  return deepFreeze({ ...input, batchDigest: value.batchDigest });
}

function normalizeCallback(
  link: RemoteExecutionLink,
  envelope: RemoteCallbackEnvelope,
): Readonly<{
  observation: AssignmentExecutionObservation;
  completionReceipt?: RemoteCompletionReceipt;
}> {
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') throw new Error('Remote Callback Inbox payload is invalid');
  let candidate: AssignmentExecutionObservation;
  let completionReceipt: RemoteCompletionReceipt | undefined;
  if (payload.type === 'heartbeat') {
    assertExactKeys(payload, ['type'], 'heartbeat payload');
    candidate = { version: 1, type: 'heartbeat', observationId: envelope.eventId, envelopeDigest: link.assignmentEnvelopeDigest };
  } else if (payload.type === 'progress') {
    assertExactKeys(payload, ['type', 'progress'], 'progress payload');
    if (!payload.progress || typeof payload.progress !== 'object') {
      throw new Error('Remote Callback Inbox progress must be an object');
    }
    assertExactKeys(payload.progress, [
      'summary', 'completedUnits', 'totalUnits',
    ], 'progress');
    identifier(payload.progress.summary, 'progress.summary');
    const completedUnits = optionalNonNegativeInteger(
      payload.progress.completedUnits,
      'progress.completedUnits',
    );
    const totalUnits = optionalPositiveInteger(payload.progress.totalUnits, 'progress.totalUnits');
    if (completedUnits !== undefined && totalUnits !== undefined && completedUnits > totalUnits) {
      throw new Error('Remote Callback Inbox progress completedUnits exceeds totalUnits');
    }
    candidate = {
      version: 1,
      type: 'progress',
      observationId: envelope.eventId,
      envelopeDigest: link.assignmentEnvelopeDigest,
      progress: {
        summary: payload.progress.summary,
        ...(completedUnits === undefined ? {} : { completedUnits }),
        ...(totalUnits === undefined ? {} : { totalUnits }),
      },
    };
  } else if (payload.type === 'checkpoint') {
    assertExactKeys(payload, ['type', 'checkpoint'], 'checkpoint payload');
    if (!payload.checkpoint || typeof payload.checkpoint !== 'object') {
      throw new Error('Remote Callback Inbox checkpoint must be an object');
    }
    assertExactKeys(payload.checkpoint, ['ref', 'digest'], 'checkpoint');
    identifier(payload.checkpoint.ref, 'checkpoint.ref');
    requireDigest(payload.checkpoint.digest, 'checkpoint.digest');
    candidate = {
      version: 1,
      type: 'checkpoint',
      observationId: envelope.eventId,
      envelopeDigest: link.assignmentEnvelopeDigest,
      checkpoint: payload.checkpoint,
    };
  } else if (payload.type === 'execution_completed') {
    assertExactKeys(payload, ['type', 'completion'], 'execution_completed payload');
    const completion = payload.completion;
    if (!completion || typeof completion !== 'object') {
      throw new Error('Remote Callback Inbox completion must be an object');
    }
    assertExactKeys(completion, [
      'report', 'candidate', 'claims', 'evidence', 'workspaceReceipt',
    ], 'completion');
    if (!completion.report || typeof completion.report !== 'object'
      || !completion.candidate || typeof completion.candidate !== 'object') {
      throw new Error('Remote Callback Inbox completion references are invalid');
    }
    assertExactKeys(completion.report, ['ref', 'digest'], 'completion report');
    assertExactKeys(completion.candidate, ['ref', 'hash'], 'completion candidate');
    identifier(completion.report.ref, 'completion.report.ref');
    requireDigest(completion.report.digest, 'completion.report.digest');
    identifier(completion.candidate.ref, 'completion.candidate.ref');
    requireDigest(completion.candidate.hash, 'completion.candidate.hash');
    const claims = normalizeContentReferences(completion.claims, 'completion.claims');
    const evidence = normalizeContentReferences(completion.evidence, 'completion.evidence');
    const workspaceReceipt = normalizeWorkspaceReceipt(link, completion.workspaceReceipt);
    completionReceipt = deepFreeze({
      report: { ref: completion.report.ref, digest: completion.report.digest },
      candidate: { ref: completion.candidate.ref, hash: completion.candidate.hash },
      claims,
      evidence,
      workspaceReceipt,
    });
    candidate = {
      version: 1,
      type: 'execution_completed',
      observationId: envelope.eventId,
      envelopeDigest: link.assignmentEnvelopeDigest,
      completion: {
        report: completion.report,
        candidate: completion.candidate,
        completionReceiptDigest: digest(completionReceipt),
      },
    };
  } else {
    throw new Error('Remote Callback Inbox callback type is unsupported');
  }
  return deepFreeze({
    observation: deepFreeze(candidate),
    ...(completionReceipt ? { completionReceipt } : {}),
  });
}

function normalizeContentReferences(
  value: readonly RemoteCompletionContentReference[],
  label: string,
): readonly RemoteCompletionContentReference[] {
  if (!Array.isArray(value)) throw new Error(`Remote Callback Inbox ${label} must be an array`);
  const refs = new Set<string>();
  return deepFreeze(value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Remote Callback Inbox ${label}[${index}] must be an object`);
    }
    assertExactKeys(item, ['ref', 'digest'], `${label}[${index}]`);
    const ref = identifier(item.ref, `${label}[${index}].ref`);
    requireDigest(item.digest, `${label}[${index}].digest`);
    if (refs.has(ref)) throw new Error(`Remote Callback Inbox ${label} refs must be unique`);
    refs.add(ref);
    return { ref, digest: item.digest };
  }));
}

function normalizeWorkspaceReceipt(
  link: RemoteExecutionLink,
  value: RemoteGithubCompletionReceipt,
): RemoteGithubCompletionReceipt {
  if (!value || typeof value !== 'object') throw new Error('Remote completion Workspace receipt is invalid');
  assertExactKeys(value, [
    'provider', 'repositoryId', 'integrationBindingId', 'baseSha', 'checkpointSha',
    'targetRef', 'branchRef', 'pathScope', 'mode', 'headSha', 'pullRequestRef',
    'pullRequestHash', 'fence',
  ], 'Workspace receipt');
  for (const [name, actual, expected] of [
    ['provider', value.provider, link.workspace.provider],
    ['repositoryId', value.repositoryId, link.workspace.repositoryId],
    ['integrationBindingId', value.integrationBindingId, link.workspace.integrationBindingId],
    ['baseSha', value.baseSha, link.workspace.baseSha],
    ['checkpointSha', value.checkpointSha, link.workspace.checkpointSha],
    ['targetRef', value.targetRef, link.workspace.targetRef],
    ['branchRef', value.branchRef, link.workspace.branchRef],
    ['mode', value.mode, link.workspace.mode],
    ['fence', value.fence, link.workspace.fence],
  ] as const) {
    if (actual !== expected) throw new Error(`Remote completion Workspace ${name} does not match the Link`);
  }
  if (stableJson(value.pathScope) !== stableJson(link.workspace.pathScope)) {
    throw new Error('Remote completion Workspace pathScope does not match the Link');
  }
  requireGitSha(value.headSha, 'workspaceReceipt.headSha');
  if (value.mode === 'branch_and_pr') {
    identifier(value.pullRequestRef, 'workspaceReceipt.pullRequestRef');
    requireDigest(value.pullRequestHash, 'workspaceReceipt.pullRequestHash');
  } else if (value.pullRequestRef !== undefined || value.pullRequestHash !== undefined) {
    throw new Error('Remote completion branch_only Workspace cannot contain a PR receipt');
  }
  return deepFreeze({ ...value, pathScope: [...value.pathScope] });
}

function materializeAppend(
  linkId: string,
  current: readonly RemoteCallbackInboxEvent[],
  expectedSequence: number,
  drafts: readonly RemoteCallbackInboxEventDraft[],
): readonly RemoteCallbackInboxEvent[] {
  sequence(expectedSequence, 'expectedSequence');
  const normalized = drafts.map(normalizeDraft);
  const existingById = new Map(current.map(event => [event.eventId, event]));
  const replayed: RemoteCallbackInboxEvent[] = [];
  for (const draft of normalized) {
    const existing = existingById.get(draft.eventId);
    if (!existing) continue;
    if (stableJson({ occurredAt: existing.occurredAt, type: existing.type, payload: existing.payload })
      !== stableJson(draft)) {
      throw new Error(`Remote Callback Inbox eventId payload conflict: ${draft.eventId}`);
    }
    replayed.push(existing);
  }
  if (replayed.length > 0) {
    if (replayed.length !== normalized.length) throw new Error('Remote Callback Inbox append cannot mix replayed and new events');
    return Object.freeze(replayed);
  }
  const actual = current.at(-1)?.sequence ?? -1;
  if (actual !== expectedSequence) throw new RemoteCallbackInboxSequenceConflictError(linkId, expectedSequence, actual);
  const appended = normalized.map((draft, index) => deepFreeze({
    ...draft,
    version: 1 as const,
    linkId,
    sequence: expectedSequence + index + 1,
  }));
  project(Object.freeze([...current, ...appended]));
  return Object.freeze(appended);
}

function normalizeDraft(draft: RemoteCallbackInboxEventDraft): RemoteCallbackInboxEventDraft {
  identifier(draft.eventId, 'eventId');
  timestamp(draft.occurredAt, 'occurredAt');
  if (draft.type === 'link.registered') {
    const raw = draft.payload.link;
    if (!raw || typeof raw !== 'object') throw new Error('Invalid persisted Remote Execution Link');
    const { version, id, digest: actualDigest, ...input } = raw;
    if (version !== 1) throw new Error('Remote Execution Link version is unsupported');
    const canonical = createRemoteExecutionLink(input);
    if (id !== canonical.id || actualDigest !== canonical.digest
      || stableJson(raw) !== stableJson(canonical)) {
      throw new Error('Persisted Remote Execution Link identity or digest is invalid');
    }
    return deepFreeze({
      eventId: draft.eventId,
      occurredAt: draft.occurredAt,
      type: 'link.registered',
      payload: { link: canonical },
    });
  }
  if (draft.type === 'callback.accepted' || draft.type === 'callback.deferred') {
    identifier(draft.payload.payloadHash, 'payloadHash');
    if (draft.payload.payloadHash !== digest(draft.payload.envelope.payload)) {
      throw new Error('Remote Callback Inbox canonical payload hash is invalid');
    }
    return deepFreeze(structuredClone(draft));
  }
  throw new Error('Remote Callback Inbox event type is invalid');
}

function parseEvent(value: unknown): RemoteCallbackInboxEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Remote Callback Inbox event');
  const event = value as RemoteCallbackInboxEvent;
  const draft = normalizeDraft(event);
  if (event.version !== 1) throw new Error('Remote Callback Inbox event version is invalid');
  return deepFreeze({
    ...draft,
    version: 1,
    linkId: identifier(event.linkId, 'linkId'),
    sequence: sequence(event.sequence, 'sequence'),
  });
}

interface ReconciliationReplayGroup {
  readonly receipt: RemoteCallbackReconciliationReceipt;
  readonly batch: readonly RemoteCallbackEnvelope[];
  readonly expected: readonly RemoteCallbackEnvelope[];
  offset: number;
}

function createReconciliationReplayGroup(
  link: RemoteExecutionLink,
  receipt: RemoteCallbackReconciliationReceipt,
  batch: readonly RemoteCallbackEnvelope[],
  cursor: number,
  deferred: ReadonlyMap<number, RemoteCallbackEnvelope>,
  accepted: readonly RemoteCallbackAcceptedRecord[],
): ReconciliationReplayGroup {
  if (receipt.fromCursor !== cursor) {
    throw new Error('Remote Callback Inbox poll receipt cursor does not match the durable cursor');
  }
  const expectedSnapshotCursor = Math.max(
    cursor,
    ...deferred.keys(),
    ...batch.map(envelope => envelope.callbackSequence),
  );
  if (receipt.snapshotCursor !== expectedSnapshotCursor) {
    throw new Error('Remote Callback Inbox poll snapshot cursor is incomplete or drifted');
  }
  if (receipt.reconciledAt > link.reconcileDeadline) {
    throw new Error('Remote Callback Inbox reconciliation deadline has expired');
  }
  const pending = new Map(deferred);
  for (const envelope of batch) {
    const priorAccepted = accepted.find(item =>
      item.endpointId === envelope.gatewayReceipt.endpointId
      && item.eventId === envelope.eventId);
    if (priorAccepted) {
      if (priorAccepted.callbackDigest !== envelope.gatewayReceipt.callbackDigest) {
        throw new Error('Remote Callback Inbox reconciliation callback body drift');
      }
      continue;
    }
    if (envelope.callbackSequence <= cursor) {
      throw new Error('Remote Callback Inbox reconciliation batch contains a stale callback');
    }
    const occupied = pending.get(envelope.callbackSequence);
    if (occupied && stableJson(occupied) !== stableJson(envelope)) {
      throw new Error('Remote Callback Inbox reconciliation callback sequence drift');
    }
    pending.set(envelope.callbackSequence, envelope);
  }
  const ordered = [...pending.values()].sort((left, right) =>
    left.callbackSequence - right.callbackSequence);
  const terminalIndex = ordered.findIndex(envelope =>
    envelope.payload.type === 'execution_completed');
  if (terminalIndex >= 0 && terminalIndex !== ordered.length - 1) {
    throw new Error('Remote Callback Inbox cannot reconcile callbacks after terminal observation');
  }
  const expected: RemoteCallbackEnvelope[] = [];
  let expectedCursor = cursor;
  for (const envelope of ordered) {
    if (envelope.callbackSequence !== expectedCursor + 1) break;
    expected.push(envelope);
    expectedCursor += 1;
    if (envelope.payload.type === 'execution_completed') break;
  }
  if (expected.length === 0) {
    throw new Error('Remote Callback Inbox reconciliation accepted group has no proven callback');
  }
  return {
    receipt,
    batch,
    expected: deepFreeze(expected),
    offset: 0,
  };
}

function project(events: readonly RemoteCallbackInboxEvent[]): RemoteCallbackInboxProjection | undefined {
  if (events.length === 0) return undefined;
  assertContiguous(events);
  const first = events[0]!;
  if (first.type !== 'link.registered' || first.sequence !== 0 || first.linkId !== first.payload.link.id) {
    throw new Error('Remote Callback Inbox must begin with its trusted Link');
  }
  const link = first.payload.link;
  if (first.eventId !== `${link.id}:registered` || first.occurredAt !== link.linkedAt) {
    throw new Error('Remote Callback Inbox trusted Link registration fact is invalid');
  }
  const accepted: RemoteCallbackAcceptedRecord[] = [];
  const deferredBySequence = new Map<number, RemoteCallbackEnvelope>();
  const identities = new Map<string, Readonly<{ payloadHash: string; callbackDigest: string }>>();
  const gatewayReceipts = new Map<string, string>();
  const completedReconciliationReceipts = new Set<string>();
  let cursor = 0;
  let terminalReceipt: RemoteCompletionReceipt | undefined;
  let activeReconciliation: ReconciliationReplayGroup | undefined;
  for (const event of events.slice(1)) {
    if (event.linkId !== link.id) throw new Error('Remote Callback Inbox event Link identity drift');
    if (event.type === 'link.registered') throw new Error('Remote Callback Inbox Link can only be registered once');
    const envelope = normalizeEnvelope(link, event.payload.envelope);
    const normalizedCallback = normalizeCallback(link, envelope);
    const expectedEventId = callbackEventId(
      link.id,
      event.type === 'callback.accepted' ? 'accepted' : 'deferred',
      envelope,
    );
    if (event.eventId !== expectedEventId) {
      throw new Error('Remote Callback Inbox persisted callback event identity is invalid');
    }
    const priorReceiptDigest = gatewayReceipts.get(envelope.gatewayReceipt.receiptId);
    if (priorReceiptDigest && priorReceiptDigest !== envelope.gatewayReceipt.callbackDigest) {
      throw new Error('Remote Callback Inbox Gateway receipt identity drift');
    }
    gatewayReceipts.set(envelope.gatewayReceipt.receiptId, envelope.gatewayReceipt.callbackDigest);
    const identity = `${envelope.gatewayReceipt.endpointId}\0${envelope.eventId}`;
    const existingIdentity = identities.get(identity);
    if (existingIdentity && (existingIdentity.payloadHash !== event.payload.payloadHash
      || existingIdentity.callbackDigest !== envelope.gatewayReceipt.callbackDigest)) {
      throw new Error('Remote Callback Inbox event identity callback body drift');
    }
    identities.set(identity, {
      payloadHash: event.payload.payloadHash,
      callbackDigest: envelope.gatewayReceipt.callbackDigest,
    });
    if (event.type === 'callback.deferred') {
      if (activeReconciliation) {
        throw new Error('Remote Callback Inbox reconciliation accepted group is incomplete');
      }
      if (event.occurredAt !== envelope.gatewayReceipt.receivedAt) {
        throw new Error('Remote Callback Inbox deferred event time is not Gateway-observed time');
      }
      if (envelope.callbackSequence <= cursor || deferredBySequence.has(envelope.callbackSequence)) {
        throw new Error('Remote Callback Inbox deferred sequence is stale or duplicated');
      }
      deferredBySequence.set(envelope.callbackSequence, envelope);
      continue;
    }
    if (stableJson(event.payload.observation) !== stableJson(normalizedCallback.observation)
      || stableJson(event.payload.completionReceipt)
        !== stableJson(normalizedCallback.completionReceipt)) {
      throw new Error('Remote Callback Inbox persisted observation does not match callback payload');
    }
    if (terminalReceipt) throw new Error('Remote Callback Inbox observation exists after terminal receipt');
    if (envelope.callbackSequence !== cursor + 1) throw new Error('Remote Callback Inbox accepted callback sequence is not contiguous');
    const deferred = deferredBySequence.get(envelope.callbackSequence);
    if (deferred && stableJson(deferred) !== stableJson(envelope)) throw new Error('Remote Callback Inbox reconciliation callback drift');
    const reconciliationReceipt = event.payload.reconciliationReceipt;
    const reconciliationBatch = event.payload.reconciliationBatch;
    let normalizedReconciliationReceipt: RemoteCallbackReconciliationReceipt | undefined;
    if (reconciliationReceipt) {
      if (!reconciliationBatch) {
        throw new Error('Remote Callback Inbox reconciliation receipt is missing its exact callback batch');
      }
      const normalizedBatch = reconciliationBatch.map(item => normalizeEnvelope(link, item));
      normalizedReconciliationReceipt = normalizeReconciliationReceipt(
        link,
        reconciliationReceipt,
        normalizedBatch,
      );
      if (!activeReconciliation) {
        if (completedReconciliationReceipts.has(normalizedReconciliationReceipt.receiptId)) {
          throw new Error('Remote Callback Inbox reconciliation receipt group is not contiguous');
        }
        activeReconciliation = createReconciliationReplayGroup(
          link,
          normalizedReconciliationReceipt,
          normalizedBatch,
          cursor,
          deferredBySequence,
          accepted,
        );
      } else if (stableJson(activeReconciliation.receipt)
        !== stableJson(normalizedReconciliationReceipt)
        || stableJson(activeReconciliation.batch) !== stableJson(normalizedBatch)) {
        throw new Error('Remote Callback Inbox reconciliation accepted group proof drift');
      }
      const expectedEnvelope = activeReconciliation.expected[activeReconciliation.offset];
      if (!expectedEnvelope || stableJson(expectedEnvelope) !== stableJson(envelope)) {
        throw new Error('Remote Callback Inbox reconciliation accepted group does not match its proof');
      }
    } else {
      if (reconciliationBatch) {
        throw new Error('Remote Callback Inbox reconciliation batch lacks its trusted receipt');
      }
      if (activeReconciliation) {
        throw new Error('Remote Callback Inbox reconciliation accepted group is incomplete');
      }
    }
    if (deferred && !reconciliationReceipt) {
      throw new Error('Remote Callback Inbox deferred callback requires a poll reconciliation receipt');
    }
    const expectedOccurredAt = normalizedReconciliationReceipt?.reconciledAt
      ?? envelope.gatewayReceipt.receivedAt;
    if (event.occurredAt !== expectedOccurredAt) {
      throw new Error('Remote Callback Inbox accepted event time is not trusted');
    }
    deferredBySequence.delete(envelope.callbackSequence);
    cursor += 1;
    accepted.push(deepFreeze({
      endpointId: envelope.gatewayReceipt.endpointId,
      eventId: envelope.eventId,
      payloadHash: event.payload.payloadHash,
      callbackDigest: envelope.gatewayReceipt.callbackDigest,
      callbackSequence: envelope.callbackSequence,
      receivedAt: envelope.gatewayReceipt.receivedAt,
      gatewayReceipt: envelope.gatewayReceipt,
      ...(normalizedReconciliationReceipt
        ? { reconciliationReceipt: normalizedReconciliationReceipt }
        : {}),
      observation: event.payload.observation,
      ...(event.payload.completionReceipt
        ? { completionReceipt: event.payload.completionReceipt }
        : {}),
    }));
    if (event.payload.observation.type === 'execution_completed') {
      if (!event.payload.completionReceipt) {
        throw new Error('Remote Callback Inbox terminal observation is missing its completion receipt');
      }
      terminalReceipt = event.payload.completionReceipt;
    }
    if (activeReconciliation) {
      activeReconciliation.offset += 1;
      if (activeReconciliation.offset === activeReconciliation.expected.length) {
        completedReconciliationReceipts.add(activeReconciliation.receipt.receiptId);
        activeReconciliation = undefined;
      }
    }
  }
  if (activeReconciliation) {
    throw new Error('Remote Callback Inbox reconciliation accepted group is incomplete');
  }
  return deepFreeze({
    version: 1,
    link,
    sequence: events.at(-1)!.sequence,
    status: terminalReceipt ? 'terminal_observed' : deferredBySequence.size > 0 ? 'reconcile_required' : 'open',
    callbackCursor: cursor,
    accepted: Object.freeze(accepted),
    deferred: Object.freeze([...deferredBySequence.values()].sort((a, b) => a.callbackSequence - b.callbackSequence)),
    ...(terminalReceipt ? { terminalReceipt } : {}),
  });
}

function findDuplicate(
  current: RemoteCallbackInboxProjection | undefined,
  envelope: RemoteCallbackEnvelope,
): Readonly<{ observation?: AssignmentExecutionObservation }> | undefined {
  if (!current) return undefined;
  const accepted = current.accepted.find(item =>
    item.endpointId === envelope.gatewayReceipt.endpointId && item.eventId === envelope.eventId);
  const deferred = current.deferred.find(item =>
    item.gatewayReceipt.endpointId === envelope.gatewayReceipt.endpointId && item.eventId === envelope.eventId);
  const existingPayloadHash = accepted?.payloadHash ?? (deferred ? digest(deferred.payload) : undefined);
  const existingCallbackDigest = accepted?.callbackDigest
    ?? deferred?.gatewayReceipt.callbackDigest;
  if (existingPayloadHash && existingPayloadHash !== digest(envelope.payload)) {
    throw new Error('Remote Callback Inbox endpoint/event identity payload drift');
  }
  if (existingCallbackDigest && existingCallbackDigest !== envelope.gatewayReceipt.callbackDigest) {
    throw new Error('Remote Callback Inbox endpoint/event identity callback body drift');
  }
  if (!accepted && !deferred) return undefined;
  return deepFreeze(accepted ? { observation: accepted.observation } : {});
}

function assertAvailableSequence(
  current: RemoteCallbackInboxProjection | undefined,
  envelope: RemoteCallbackEnvelope,
  pending = new Map(current?.deferred.map(item => [item.callbackSequence, item]) ?? []),
): void {
  if (envelope.callbackSequence <= (current?.callbackCursor ?? 0)) {
    throw new Error('Remote Callback Inbox callback sequence is stale');
  }
  const occupied = pending.get(envelope.callbackSequence);
  if (occupied && stableJson(occupied) !== stableJson(envelope)) {
    throw new Error('Remote Callback Inbox callback sequence identity drift');
  }
}

function assertContiguous(events: readonly RemoteCallbackInboxEvent[]): void {
  events.forEach((event, index) => {
    if (event.sequence !== index) throw new Error('Remote Callback Inbox durable sequence is not contiguous');
  });
}

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`Remote Callback Inbox ${label} contains forbidden field ${unexpected}`);
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid Remote Callback Inbox ${name}`);
  return value;
}

function timestamp(value: unknown, name: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) throw new Error(`Invalid Remote Callback Inbox ${name}`);
  return Number(value);
}

function sequence(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < -1) throw new Error(`Invalid Remote Callback Inbox ${name}`);
  return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`Invalid Remote Callback Inbox ${name}`);
  return Number(value);
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  return positiveInteger(value, name);
}

function optionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid Remote Callback Inbox ${name}`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
  const normalized = optionalNonNegativeInteger(value, name);
  if (normalized === undefined) throw new Error(`Invalid Remote Callback Inbox ${name}`);
  return normalized;
}

function requireDigest(value: unknown, name: string): void {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Invalid Remote Callback Inbox ${name}`);
  }
}

function requireGitSha(value: unknown, name: string): void {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    throw new Error(`Invalid Remote Callback Inbox ${name}`);
  }
}

function requireGitRef(value: unknown, name: string): void {
  if (typeof value !== 'string' || !/^refs\/heads\/[a-zA-Z0-9._/-]+$/u.test(value)
    || value.includes('..') || value.endsWith('/') || value.endsWith('.lock')) {
    throw new Error(`Invalid Remote Callback Inbox ${name}`);
  }
}

function isCanonicalRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('/')
    || value.includes('\\') || value.includes('\0')) return false;
  return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
