import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PayloadVaultObjectHandle } from './disclosure-manifest.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';

export type GovernedPayloadWriteConsumer =
  | 'authority_source'
  | 'evidence_header'
  | 'task_report_header'
  | 'journal_header';
export type GovernedPayloadWriteState =
  | 'intent'
  | 'vault_written'
  | 'authority_indexed'
  | 'published'
  | 'purge_required';

export interface GovernedPayloadWriteIntentInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly objectId: string;
  readonly payloadHash: string;
  readonly descriptorDigest: string;
  readonly sourceBindingDigest: string;
  readonly consumer: GovernedPayloadWriteConsumer;
  readonly publicationScope?: string;
}

export interface GovernedPayloadWriteSagaSnapshot extends GovernedPayloadWriteIntentInput {
  readonly version: 1;
  readonly intentId: string;
  readonly sequence: number;
  readonly state: GovernedPayloadWriteState;
  readonly handle?: PayloadVaultObjectHandle;
  readonly authorityIndexDigest?: string;
  readonly publicationDigest?: string;
  readonly purgeReason?: 'write_failed' | 'cas_lost' | 'restart_unpublished';
  readonly purge?: GovernedPayloadWritePurgeState;
  readonly digest: string;
}

export interface GovernedPayloadWritePurgeState {
  readonly generation: number;
  readonly attempt: number;
  readonly fence: number;
  readonly candidateDigest: string;
  readonly requestDigest: string;
  readonly status: 'pending' | 'outcome_unknown' | 'failed' | 'confirmed';
  readonly receipt?: GovernedPayloadWritePurgeReceipt;
}

export interface GovernedPayloadWritePurgeRequest {
  readonly version: 1;
  readonly generation: number;
  readonly intentId: string;
  readonly projectId: string;
  readonly objectId: string;
  readonly payloadHash: string;
  readonly descriptorDigest: string;
  readonly handle?: PayloadVaultObjectHandle;
  readonly reason: NonNullable<GovernedPayloadWriteSagaSnapshot['purgeReason']>;
  readonly attempt: number;
  readonly fence: number;
  readonly candidateDigest: string;
  readonly digest: string;
}

export interface GovernedPayloadWritePurgeReceipt {
  readonly version: 1;
  readonly requestDigest: string;
  readonly providerId: string;
  readonly status: 'confirmed' | 'failed' | 'outcome_unknown';
  readonly observedAt: number;
  readonly digest: string;
}

/** Root-private external deletion/crypto-erasure authority. */
export interface GovernedPayloadWritePurgePort {
  purge(
    request: GovernedPayloadWritePurgeRequest,
    signal: AbortSignal,
  ): Promise<GovernedPayloadWritePurgeReceipt>;
  reconcile(
    request: GovernedPayloadWritePurgeRequest,
    previous: GovernedPayloadWritePurgeReceipt | undefined,
    signal: AbortSignal,
  ): Promise<GovernedPayloadWritePurgeReceipt>;
}

export type GovernedPayloadPublicationVerification =
  | Readonly<{ status: 'exact'; publicationDigest: string }>
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'unknown' }>;

/** Generation-owned content-free header authority. It must never read payload bodies. */
export interface GovernedPayloadPublicationVerifierPort {
  verify(
    intent: GovernedPayloadWriteSagaSnapshot,
    signal: AbortSignal,
  ): Promise<GovernedPayloadPublicationVerification>;
}

interface GovernedPayloadWriteSagaEvent {
  readonly version: 1;
  readonly intentId: string;
  readonly sequence: number;
  readonly type: 'intent.created' | 'vault.written' | 'authority.indexed'
    | 'header.published' | 'purge.required' | 'purge.attempted' | 'purge.receipt';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly digest: string;
}

/** Immutable, content-free intent index. It never stores payload bytes or key material. */
export class FileGovernedPayloadWriteSagaRepository {
  readonly #store: DurableFileStore;
  #ready?: Promise<void>;

  constructor(directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  /** Proves the content-free journal is durably writable before payload bytes enter the Vault. */
  async assertReady(): Promise<void> {
    await this.#ensureReady();
  }

  async begin(input: GovernedPayloadWriteIntentInput): Promise<GovernedPayloadWriteSagaSnapshot> {
    const canonical = exactIntent(input);
    const intentId = createGovernedPayloadWriteIntentId(canonical);
    const current = await this.read(intentId);
    if (current) {
      if (digest(pickIntent(current)) !== digest(canonical)) {
        throw new Error('Governed Payload write intent identity conflict');
      }
      return current;
    }
    return await this.#append(intentId, -1, 'intent.created', canonical);
  }

  async recordVault(
    intentId: string,
    handle: PayloadVaultObjectHandle,
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    return await this.#transition(intentId, 'intent', 'vault.written', { handle });
  }

  async recordAuthorityIndex(
    intentId: string,
    authorityIndexDigest: string,
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    requiredDigest(authorityIndexDigest, 'authorityIndexDigest');
    return await this.#transition(intentId, 'vault_written', 'authority.indexed', {
      authorityIndexDigest,
    });
  }

  async publish(
    intentId: string,
    publicationDigest: string,
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    requiredDigest(publicationDigest, 'publicationDigest');
    return await this.#transition(intentId, 'authority_indexed', 'header.published', {
      publicationDigest,
    });
  }

  async requirePurge(
    intentId: string,
    purgeReason: GovernedPayloadWriteSagaSnapshot['purgeReason'],
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    const current = await this.#require(intentId);
    if (current.state === 'published') {
      throw new Error('Published Governed Payload write cannot enter purge-required');
    }
    if (current.state === 'purge_required') return current;
    return await this.#append(intentId, current.sequence, 'purge.required', { purgeReason });
  }

  async recordPurgeAttempt(
    intentId: string,
    request: GovernedPayloadWritePurgeRequest,
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    const current = await this.#require(intentId);
    if (current.state !== 'purge_required' || current.purge?.status === 'confirmed') {
      throw new Error('Governed Payload purge attempt is not allowed');
    }
    if (current.purge?.status === 'pending' || current.purge?.status === 'outcome_unknown') {
      if (current.purge.requestDigest !== request.digest) {
        throw new Error('Governed Payload purge attempt replay drift');
      }
      return current;
    }
    assertPurgeRequest(request, current);
    return await this.#append(intentId, current.sequence, 'purge.attempted', {
      generation: request.generation,
      attempt: request.attempt,
      fence: request.fence,
      candidateDigest: request.candidateDigest,
      requestDigest: request.digest,
    });
  }

  async recordPurgeReceipt(
    intentId: string,
    receipt: GovernedPayloadWritePurgeReceipt,
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    const current = await this.#require(intentId);
    if (current.state !== 'purge_required' || !current.purge
      || current.purge.status === 'confirmed') {
      throw new Error('Governed Payload purge receipt is not expected');
    }
    const canonical = assertPurgeReceipt(receipt, current.purge.requestDigest);
    return await this.#append(intentId, current.sequence, 'purge.receipt', { receipt: canonical });
  }

  async read(intentId: string): Promise<GovernedPayloadWriteSagaSnapshot | undefined> {
    await this.#ensureReady();
    const prefix = `${fileId(intentId)}.`;
    const names = (await readdir(this.#store.directory))
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .sort();
    if (names.length === 0) return undefined;
    const events = await Promise.all(names.map(async (name, index) => {
      const match = /^[a-f\d]{64}\.(\d{12})\.json$/u.exec(name);
      if (!match || Number(match[1]) !== index) throw new Error('Governed Payload write saga sequence drift');
      return parseEvent(JSON.parse(await readFile(join(this.#store.directory, name), 'utf8')));
    }));
    return replay(events);
  }

  async listUnpublished(
    projectId: string,
    publicationScope?: string,
  ): Promise<readonly GovernedPayloadWriteSagaSnapshot[]> {
    await this.#ensureReady();
    const names = (await readdir(this.#store.directory)).filter(name => name.endsWith('.000000000000.json'));
    const snapshots = await Promise.all(names.map(async name => {
      const first = parseEvent(JSON.parse(await readFile(join(this.#store.directory, name), 'utf8')));
      return await this.#require(first.intentId);
    }));
    return deepFreeze(snapshots.filter(snapshot => snapshot.projectId === projectId
      && snapshot.state !== 'published'
      && snapshot.state !== 'purge_required'
      && (publicationScope === undefined || snapshot.publicationScope === publicationScope)));
  }

  async listAuthorityIndexed(
    projectId: string,
  ): Promise<readonly GovernedPayloadWriteSagaSnapshot[]> {
    return deepFreeze((await this.listUnpublished(projectId))
      .filter(snapshot => snapshot.state === 'authority_indexed'));
  }

  async listPurgeRequired(projectId: string): Promise<readonly GovernedPayloadWriteSagaSnapshot[]> {
    required(projectId, 'projectId');
    await this.#ensureReady();
    const names = (await readdir(this.#store.directory)).filter(name => name.endsWith('.000000000000.json'));
    const snapshots = await Promise.all(names.map(async name => {
      const first = parseEvent(JSON.parse(await readFile(join(this.#store.directory, name), 'utf8')));
      return await this.#require(first.intentId);
    }));
    return deepFreeze(snapshots.filter(snapshot => snapshot.projectId === projectId
      && snapshot.state === 'purge_required'
      && snapshot.purge?.status !== 'confirmed'));
  }

  async #transition(
    intentId: string,
    expected: GovernedPayloadWriteState,
    type: GovernedPayloadWriteSagaEvent['type'],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    const current = await this.#require(intentId);
    if (current.state !== expected) {
      const replayed = replayTransition(current, type, payload);
      if (replayed) return current;
      throw new Error(`Governed Payload write saga transition conflict: ${current.state}`);
    }
    return await this.#append(intentId, current.sequence, type, payload);
  }

  async #append(
    intentId: string,
    expectedSequence: number,
    type: GovernedPayloadWriteSagaEvent['type'],
    payload: object,
  ): Promise<GovernedPayloadWriteSagaSnapshot> {
    await this.#ensureReady();
    const sequence = expectedSequence + 1;
    const body = deepFreeze({ version: 1 as const, intentId, sequence, type, payload: structuredClone(payload) });
    const event = deepFreeze({ ...body, digest: digest(body) });
    const target = join(this.#store.directory, `${fileId(intentId)}.${String(sequence).padStart(12, '0')}.json`);
    await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(event),
      createdValue: event,
      onConflict: async () => {
        const winner = parseEvent(JSON.parse(await readFile(target, 'utf8')));
        if (winner.digest !== event.digest) throw new Error('Governed Payload write saga CAS conflict');
        return winner;
      },
    });
    return await this.#require(intentId);
  }

  async #require(intentId: string): Promise<GovernedPayloadWriteSagaSnapshot> {
    const value = await this.read(intentId);
    if (!value) throw new Error('Governed Payload write intent is unavailable');
    return value;
  }

  async #ensureReady(): Promise<void> {
    this.#ready ??= this.#store.ensureDurableLeaf('Governed Payload write saga');
    await this.#ready;
  }
}

/** Generation-owned worker; confirmed receipts are terminal and never dispatched twice. */
export class GovernedPayloadWritePurgeConsumer {
  constructor(readonly options: Readonly<{
    generation: number;
    repository: FileGovernedPayloadWriteSagaRepository;
    provider: GovernedPayloadWritePurgePort;
  }>) {
    if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
      throw new Error('Governed Payload purge generation is invalid');
    }
  }

  async processIntent(intentId: string, signal: AbortSignal): Promise<GovernedPayloadWriteSagaSnapshot> {
    signal.throwIfAborted();
    let current = await this.options.repository.read(intentId);
    if (!current || current.state !== 'purge_required' || current.purge?.status === 'confirmed') {
      if (!current) throw new Error('Governed Payload purge intent is unavailable');
      return current;
    }
    let request: GovernedPayloadWritePurgeRequest;
    let reconcile = false;
    if (current.purge?.status === 'pending' || current.purge?.status === 'outcome_unknown') {
      request = purgeRequestFromState(current);
      reconcile = true;
    } else {
      request = createPurgeRequest(current, this.options.generation);
      current = await this.options.repository.recordPurgeAttempt(intentId, request);
    }
    try {
      const receipt = reconcile
        ? await this.options.provider.reconcile(request, current.purge?.receipt, signal)
        : await this.options.provider.purge(request, signal);
      return await this.options.repository.recordPurgeReceipt(intentId, receipt);
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      // The durable attempt remains pending. Restart must reconcile this exact
      // attempt/fence and must never issue a second destructive call blindly.
      return (await this.options.repository.read(intentId))!;
    }
  }

  async drainProject(
    projectId: string,
    signal: AbortSignal,
  ): Promise<readonly GovernedPayloadWriteSagaSnapshot[]> {
    const results: GovernedPayloadWriteSagaSnapshot[] = [];
    for (const pending of await this.options.repository.listPurgeRequired(projectId)) {
      results.push(await this.processIntent(pending.intentId, signal));
    }
    return deepFreeze(results);
  }
}

/**
 * Generation handoff worker for the lost-response window after header CAS.
 * Missing verifiers are deliberately non-destructive: the durable intent stays visible.
 */
export class GovernedPayloadPublicationReconciler {
  constructor(readonly options: Readonly<{
    repository: FileGovernedPayloadWriteSagaRepository;
    verifier?: GovernedPayloadPublicationVerifierPort;
    purge: GovernedPayloadWritePurgeConsumer;
  }>) {}

  async drainProject(
    projectId: string,
    signal: AbortSignal,
  ): Promise<readonly GovernedPayloadWriteSagaSnapshot[]> {
    const results: GovernedPayloadWriteSagaSnapshot[] = [];
    for (const pending of await this.options.repository.listAuthorityIndexed(projectId)) {
      signal.throwIfAborted();
      if (!this.options.verifier) {
        results.push(pending);
        continue;
      }
      let verification: GovernedPayloadPublicationVerification;
      try {
        verification = await this.options.verifier.verify(pending, signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        results.push(pending);
        continue;
      }
      if (verification.status === 'unknown') {
        results.push(pending);
        continue;
      }
      if (verification.status === 'exact') {
        requiredDigest(verification.publicationDigest, 'publicationDigest');
        results.push(await this.options.repository.publish(
          pending.intentId,
          verification.publicationDigest,
        ));
        continue;
      }
      await this.options.repository.requirePurge(pending.intentId, 'restart_unpublished');
      results.push(await this.options.purge.processIntent(pending.intentId, signal));
    }
    return deepFreeze(results);
  }
}

export function createGovernedPayloadWriteIntentId(input: GovernedPayloadWriteIntentInput): string {
  const canonical = exactIntent(input);
  return `governed-payload-write:${digest({
    projectId: canonical.projectId,
    objectId: canonical.objectId,
    payloadHash: canonical.payloadHash,
    descriptorDigest: canonical.descriptorDigest,
    sourceBindingDigest: canonical.sourceBindingDigest,
    consumer: canonical.consumer,
    publicationScope: canonical.publicationScope,
  }).slice('sha256:'.length)}`;
}

function replay(events: readonly GovernedPayloadWriteSagaEvent[]): GovernedPayloadWriteSagaSnapshot {
  const first = events[0];
  if (!first || first.type !== 'intent.created' || first.sequence !== 0) {
    throw new Error('Governed Payload write saga has no intent');
  }
  const intent = exactIntent(first.payload);
  if (createGovernedPayloadWriteIntentId(intent) !== first.intentId) throw new Error('Governed Payload write intent digest drift');
  let state: GovernedPayloadWriteState = 'intent';
  let extension: Pick<GovernedPayloadWriteSagaSnapshot, 'handle' | 'authorityIndexDigest'
    | 'publicationDigest' | 'purgeReason' | 'purge'> = {};
  for (const [index, event] of events.entries()) {
    if (event.intentId !== first.intentId || event.sequence !== index) throw new Error('Governed Payload write saga binding drift');
    if (index === 0) continue;
    if (event.type === 'vault.written' && state === 'intent' && isHandle(event.payload.handle)) {
      state = 'vault_written'; extension = { ...extension, handle: event.payload.handle }; continue;
    }
    if (event.type === 'authority.indexed' && state === 'vault_written' && isDigest(event.payload.authorityIndexDigest)) {
      state = 'authority_indexed'; extension = { ...extension, authorityIndexDigest: event.payload.authorityIndexDigest }; continue;
    }
    if (event.type === 'header.published' && state === 'authority_indexed' && isDigest(event.payload.publicationDigest)) {
      state = 'published'; extension = { ...extension, publicationDigest: event.payload.publicationDigest }; continue;
    }
    if (event.type === 'purge.required' && state !== 'published'
      && ['write_failed', 'cas_lost', 'restart_unpublished'].includes(String(event.payload.purgeReason))) {
      state = 'purge_required'; extension = { ...extension, purgeReason: event.payload.purgeReason as GovernedPayloadWriteSagaSnapshot['purgeReason'] }; continue;
    }
    if (event.type === 'purge.attempted' && state === 'purge_required'
      && (!extension.purge || extension.purge.status === 'failed')) {
      const candidateDigest = snapshotDigest(intent, first.intentId, index - 1, state, extension);
      extension = {
        ...extension,
        purge: parsePurgeAttempt(event.payload, candidateDigest, extension.purge),
      };
      continue;
    }
    if (event.type === 'purge.receipt' && state === 'purge_required'
      && extension.purge && extension.purge.status !== 'confirmed') {
      const receipt = assertPurgeReceipt(event.payload.receipt, extension.purge.requestDigest);
      extension = {
        ...extension,
        purge: deepFreeze({ ...extension.purge, status: receipt.status, receipt }),
      };
      continue;
    }
    throw new Error('Governed Payload write saga transition drift');
  }
  const body = deepFreeze({
    ...intent, version: 1 as const, intentId: first.intentId, sequence: events.length - 1, state, ...extension,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function createPurgeRequest(
  snapshot: GovernedPayloadWriteSagaSnapshot,
  generation: number,
): GovernedPayloadWritePurgeRequest {
  const attempt = (snapshot.purge?.attempt ?? 0) + 1;
  const body = deepFreeze({
    version: 1 as const,
    generation,
    intentId: snapshot.intentId,
    projectId: snapshot.projectId,
    objectId: snapshot.objectId,
    payloadHash: snapshot.payloadHash,
    descriptorDigest: snapshot.descriptorDigest,
    ...(snapshot.handle ? { handle: snapshot.handle } : {}),
    reason: snapshot.purgeReason!,
    attempt,
    fence: attempt,
    candidateDigest: snapshot.digest,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function purgeRequestFromState(
  snapshot: GovernedPayloadWriteSagaSnapshot,
): GovernedPayloadWritePurgeRequest {
  const purge = snapshot.purge!;
  const body = deepFreeze({
    version: 1 as const,
    generation: purge.generation,
    intentId: snapshot.intentId,
    projectId: snapshot.projectId,
    objectId: snapshot.objectId,
    payloadHash: snapshot.payloadHash,
    descriptorDigest: snapshot.descriptorDigest,
    ...(snapshot.handle ? { handle: snapshot.handle } : {}),
    reason: snapshot.purgeReason!,
    attempt: purge.attempt,
    fence: purge.fence,
    candidateDigest: purge.candidateDigest,
  });
  const request = deepFreeze({ ...body, digest: digest(body) });
  if (request.digest !== purge.requestDigest) throw new Error('Governed Payload purge request replay drift');
  return request;
}

function assertPurgeRequest(
  request: GovernedPayloadWritePurgeRequest,
  snapshot: GovernedPayloadWriteSagaSnapshot,
): void {
  const expected = createPurgeRequest(snapshot, request.generation);
  if (canonicalWorkroomJson(expected) !== canonicalWorkroomJson(request)) {
    throw new Error('Governed Payload purge request binding drift');
  }
}

function assertPurgeReceipt(
  value: unknown,
  requestDigest: string,
): GovernedPayloadWritePurgeReceipt {
  if (!value || typeof value !== 'object') throw new Error('Governed Payload purge receipt is invalid');
  const receipt = value as Partial<GovernedPayloadWritePurgeReceipt>;
  if (receipt.version !== 1 || receipt.requestDigest !== requestDigest
    || !receipt.providerId || receipt.providerId.trim() !== receipt.providerId
    || !['confirmed', 'failed', 'outcome_unknown'].includes(String(receipt.status))
    || !Number.isSafeInteger(receipt.observedAt) || Number(receipt.observedAt) < 0
    || !isDigest(receipt.digest)) {
    throw new Error('Governed Payload purge receipt is invalid');
  }
  const { digest: supplied, ...body } = receipt;
  if (supplied !== digest(body)) throw new Error('Governed Payload purge receipt digest drift');
  return deepFreeze(structuredClone(receipt)) as GovernedPayloadWritePurgeReceipt;
}

function parsePurgeAttempt(
  value: Readonly<Record<string, unknown>>,
  candidateDigest: string,
  previous: GovernedPayloadWritePurgeState | undefined,
): GovernedPayloadWritePurgeState {
  if (!Number.isSafeInteger(value.generation) || Number(value.generation) < 1
    || !Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1
    || value.fence !== value.attempt
    || value.candidateDigest !== candidateDigest
    || !isDigest(value.requestDigest)
    || Number(value.attempt) !== (previous?.attempt ?? 0) + 1) {
    throw new Error('Governed Payload purge attempt drift');
  }
  return deepFreeze({
    generation: Number(value.generation),
    attempt: Number(value.attempt),
    fence: Number(value.fence),
    candidateDigest,
    requestDigest: value.requestDigest,
    status: 'pending' as const,
  });
}

function snapshotDigest(
  intent: GovernedPayloadWriteIntentInput,
  intentId: string,
  sequence: number,
  state: GovernedPayloadWriteState,
  extension: Pick<GovernedPayloadWriteSagaSnapshot, 'handle' | 'authorityIndexDigest'
    | 'publicationDigest' | 'purgeReason' | 'purge'>,
): string {
  return digest({ ...intent, version: 1, intentId, sequence, state, ...extension });
}

function exactIntent(value: unknown): GovernedPayloadWriteIntentInput {
  if (!value || typeof value !== 'object') throw new Error('Governed Payload write intent is invalid');
  const input = value as Partial<GovernedPayloadWriteIntentInput>;
  for (const [field, candidate] of Object.entries({
    operationId: input.operationId, projectId: input.projectId, objectId: input.objectId,
  })) required(candidate, field);
  requiredDigest(input.payloadHash, 'payloadHash');
  requiredDigest(input.descriptorDigest, 'descriptorDigest');
  requiredDigest(input.sourceBindingDigest, 'sourceBindingDigest');
  if (![
    'authority_source', 'evidence_header', 'task_report_header', 'journal_header',
  ].includes(String(input.consumer))) {
    throw new Error('Governed Payload write consumer is invalid');
  }
  if (input.publicationScope !== undefined) required(input.publicationScope, 'publicationScope');
  return deepFreeze({
    operationId: input.operationId!, projectId: input.projectId!, objectId: input.objectId!,
    payloadHash: input.payloadHash!, descriptorDigest: input.descriptorDigest!,
    sourceBindingDigest: input.sourceBindingDigest!, consumer: input.consumer!,
    ...(input.publicationScope ? { publicationScope: input.publicationScope } : {}),
  });
}

function parseEvent(value: unknown): GovernedPayloadWriteSagaEvent {
  if (!value || typeof value !== 'object') throw new Error('Governed Payload write saga event is invalid');
  const event = value as Partial<GovernedPayloadWriteSagaEvent>;
  if (event.version !== 1 || !Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0
    || !event.payload || typeof event.payload !== 'object' || !isDigest(event.digest)) {
    throw new Error('Governed Payload write saga event is invalid');
  }
  const { digest: supplied, ...body } = event;
  if (supplied !== digest(body)) throw new Error('Governed Payload write saga event digest drift');
  return deepFreeze(structuredClone(event)) as GovernedPayloadWriteSagaEvent;
}

function pickIntent(value: GovernedPayloadWriteSagaSnapshot): GovernedPayloadWriteIntentInput {
  return exactIntent(value);
}

function replayTransition(
  current: GovernedPayloadWriteSagaSnapshot,
  type: GovernedPayloadWriteSagaEvent['type'],
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return (type === 'vault.written' && current.handle !== undefined && digest(current.handle) === digest(payload.handle))
    || (type === 'authority.indexed' && current.authorityIndexDigest === payload.authorityIndexDigest)
    || (type === 'header.published' && current.publicationDigest === payload.publicationDigest);
}

function fileId(intentId: string): string { return digest({ intentId }).slice('sha256:'.length); }
function required(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error(`${field} is invalid`);
}
function requiredDigest(value: unknown, field: string): asserts value is string {
  if (!isDigest(value)) throw new Error(`${field} is invalid`);
}
function isDigest(value: unknown): value is string { return typeof value === 'string' && /^sha256:[a-f\d]{64}$/u.test(value); }
function isHandle(value: unknown): value is PayloadVaultObjectHandle {
  return !!value && typeof value === 'object' && (value as Partial<PayloadVaultObjectHandle>).version === 1
    && typeof (value as Partial<PayloadVaultObjectHandle>).vaultObjectId === 'string';
}
