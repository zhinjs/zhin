import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  WorkroomBlocker,
  WorkroomBlockerKind,
  WorkroomEvent,
  WorkroomEventDraft,
} from './kernel-contracts.js';
import { assertAcceptanceContract, assertPersistedAcceptanceRecord } from './acceptance-policy.js';
import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import { assertWorkflowPlanProposal } from './workflow-plan-builder.js';
import { assertWorkflowPlanRevisionCandidate } from './plan-revision.js';
import { parseWorkroomRemoteAssignmentIssuance } from './remote-assignment-issuance.js';
import { parseWorkroomLocalAssignmentIssuance } from './local-assignment-issuance.js';
import {
  isWorkroomRunCancelReasonCode,
  isWorkroomRunReplanReasonCode,
} from './workroom-run-control.js';
import {
  assertWorkroomSchedulerPolicySnapshot,
  parseWorkroomDispatchTaskDecision,
  parseWorkroomPreemptionPrepareDecision,
  parseWorkroomPriorityChangeProposal,
} from './workroom-scheduler.js';
import { DurableFileStore } from './durable-file-store.js';
import type { WorkroomGovernedPayloadReceipt } from './workroom-task-report-store.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../data-governance/governed-payload-write-saga.js';
import {
  FileLegacyEmbeddedPayloadReadAdapter,
  LegacyEmbeddedPayloadDetectedError,
  assertActiveStoreHasNoLegacyEmbeddedPayload,
  type LegacyEmbeddedPayloadRecord,
} from './legacy-embedded-payload-migration.js';

export interface WorkroomJournalPayloadWriteInput {
  readonly projectId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly eventType: WorkroomEvent['type'];
  readonly occurredAt: number;
  readonly fieldPath: string;
  readonly value: unknown;
  readonly contentHash: string;
  readonly source: Readonly<{
    ref: string;
    digest: string;
    bindingDigest: string;
  }>;
}

export interface WorkroomJournalPayloadReadInput {
  readonly projectId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly eventType: WorkroomEvent['type'];
  readonly fieldPath: string;
  readonly contentHash: string;
  readonly receipt: WorkroomGovernedPayloadReceipt;
  readonly purpose: 'kernel-replay';
}

/**
 * Narrow P12 boundary for governed Workroom Journal text. Implementations own
 * storage, current-policy authorization and source-lineage verification.
 */
export interface WorkroomJournalPayloadPort {
  write(input: WorkroomJournalPayloadWriteInput): Promise<WorkroomGovernedPayloadReceipt>;
  read(input: WorkroomJournalPayloadReadInput): Promise<unknown>;
  publish?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
    publicationDigest: string;
  }>): Promise<void>;
  prepare?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
  }>): Promise<void>;
  abandon?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
    reason: 'cas_lost' | 'write_failed';
  }>): Promise<void>;
  reconcile?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
    publicationDigest: string;
  }>): Promise<void>;
}

export class WorkroomJournalPayloadAuthorityUnavailableError extends Error {
  constructor() {
    super('Governed Workroom Journal payload authority is unavailable');
    this.name = 'WorkroomJournalPayloadAuthorityUnavailableError';
  }
}

interface GovernedWorkroomJournalPayloadReference {
  readonly version: 1;
  readonly kind: 'governed_workroom_journal_payload';
  readonly fieldPath: string;
  readonly contentHash: string;
  readonly receipt: WorkroomGovernedPayloadReceipt;
}

interface StoredWorkroomEvent extends Omit<WorkroomEvent, 'version' | 'payload'> {
  readonly version: 3;
  /** Content-free control projection derived before payload protection. */
  readonly control: WorkroomStoredEventControl;
  readonly payload: Readonly<Record<string, unknown>>;
}

export class WorkroomSequenceConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(`Workroom ${runId} sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`);
    this.name = 'WorkroomSequenceConflictError';
  }
}

export interface WorkroomJournal {
  listRunIds(): Promise<readonly string[]>;
  /** Content-free stored envelopes only; implementations must never materialize governed payloads. */
  scanStoredHeaders(): Promise<readonly WorkroomStoredRunHeaders[]>;
  /** Content-free stored envelopes only; implementations must never materialize governed payloads. */
  readStoredHeaders(runId: string): Promise<WorkroomStoredRunHeaders | null>;
  /** Content-free generation handoff verification; optional adapters remain fail-closed/pending. */
  verifyGovernedPayloadPublication?(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification>;
  read(runId: string): Promise<readonly WorkroomEvent[]>;
  append(
    runId: string,
    expectedSequence: number,
    events: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]>;
}

export interface WorkroomStoredEventHeader {
  readonly version: 1;
  readonly eventRef: string;
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: number;
  readonly type: WorkroomEvent['type'];
  /** Minimal opaque state-transition fields; raw identifiers and caller text are excluded. */
  readonly control: WorkroomStoredEventControl;
  readonly protectedPayloadDigest: string;
  readonly protectedReceipts: readonly WorkroomStoredProtectedReceiptHeader[];
  readonly digest: string;
}

export interface WorkroomStoredEventControl {
  readonly projectId?: string;
  readonly taskKey?: string;
  readonly assignmentId?: string;
  readonly blockerId?: string;
  readonly blockerKind?: WorkroomBlockerKind;
  readonly blockerDeadline?: number;
  readonly blockerAllowedActions?: WorkroomBlocker['allowedActions'];
  readonly waitId?: string;
  readonly waitStatus?: string;
  readonly role?: WorkroomAssignmentRoleHeader;
  readonly required?: boolean;
  readonly maxAttempts?: number;
  readonly attempt?: number;
  readonly assignmentRevision?: number;
  readonly fence?: number;
  readonly outcome?: 'interrupted' | 'committed' | 'outcome_unknown';
  readonly verdictOutcome?: 'passed' | 'rework';
  readonly decision?: 'approve' | 'reject' | 'request_changes' | 'cancel';
  readonly newTaskRevision?: number;
}

type WorkroomAssignmentRoleHeader = 'executor' | 'reviewer' | 'integration';

export interface WorkroomStoredProtectedReceiptHeader {
  readonly fieldPath: string;
  readonly contentHash: string;
  readonly descriptorDigest: string;
  readonly sourceDigest: string;
  readonly sourceBindingDigest: string;
}

export interface WorkroomStoredRunHeaders {
  readonly version: 1;
  readonly runId: string;
  readonly events: readonly WorkroomStoredEventHeader[];
  readonly digest: string;
}

interface FileWorkroomJournalSegmentPayload {
  readonly version: 3;
  readonly runId: string;
  readonly expectedSequence: number;
  readonly events: readonly StoredWorkroomEvent[];
}

interface FileWorkroomJournalSegment extends FileWorkroomJournalSegmentPayload {
  readonly payloadDigest: string;
}

export class MemoryWorkroomJournal implements WorkroomJournal {
  readonly #runs = new Map<string, readonly StoredWorkroomEvent[]>();
  readonly #payloads: WorkroomJournalPayloadPort;

  constructor(payloads: WorkroomJournalPayloadPort = new MemoryWorkroomJournalPayloadPort()) {
    this.#payloads = payloads;
  }

  async listRunIds(): Promise<readonly string[]> {
    return Object.freeze([...this.#runs.keys()].sort());
  }

  async scanStoredHeaders(): Promise<readonly WorkroomStoredRunHeaders[]> {
    return Object.freeze([...this.#runs.entries()]
      .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
      .map(([runId, events]) => storedRunHeaders(runId, events)));
  }

  async readStoredHeaders(runId: string): Promise<WorkroomStoredRunHeaders | null> {
    const events = this.#runs.get(runId) ?? [];
    return events.length === 0 ? null : storedRunHeaders(runId, events);
  }

  async verifyGovernedPayloadPublication(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification> {
    const events = this.#runs.get(intent.publicationScope ?? '') ?? [];
    return verifyJournalPayloadPublication(intent, events);
  }

  async read(runId: string): Promise<readonly WorkroomEvent[]> {
    const events = this.#runs.get(runId) ?? [];
    return events.length === 0
      ? Object.freeze([])
      : await materializeStoredEvents(events, this.#payloads);
  }

  async append(
    runId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]> {
    const current = this.#runs.get(runId) ?? [];
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (actualSequence !== expectedSequence) {
      throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
    }
    if (drafts.length === 0) return [];
    const appended = materializeEvents(runId, expectedSequence, drafts);
    const projectId = projectIdForAppend(current, appended);
    const protectedEvents = await protectEvents(appended, projectId, this.#payloads);
    const winner = this.#runs.get(runId) ?? [];
    const winnerSequence = winner.at(-1)?.sequence ?? -1;
    if (winnerSequence !== expectedSequence) {
      throw new WorkroomSequenceConflictError(runId, expectedSequence, winnerSequence);
    }
    this.#runs.set(runId, Object.freeze([...current, ...protectedEvents]));
    return appended;
  }
}

/** In-memory authority used by the non-production Memory journal. */
export class MemoryWorkroomJournalPayloadPort implements WorkroomJournalPayloadPort {
  readonly #values = new Map<string, unknown>();

  async write(input: WorkroomJournalPayloadWriteInput): Promise<WorkroomGovernedPayloadReceipt> {
    if (digestCanonicalWorkroomValue(input.value) !== input.contentHash) {
      throw new Error('Memory Workroom Journal payload content hash drift');
    }
    const objectId = createWorkroomJournalPayloadObjectId(input);
    const vaultObjectId = `memory:${digestCanonicalWorkroomValue({ objectId, contentHash: input.contentHash })}`;
    const existing = this.#values.get(vaultObjectId);
    if (existing !== undefined
      && digestCanonicalWorkroomValue(existing) !== input.contentHash) {
      throw new Error('Memory Workroom Journal payload identity conflict');
    }
    this.#values.set(vaultObjectId, structuredClone(input.value));
    return Object.freeze({
      descriptor: Object.freeze({
        vaultObjectId,
        objectId,
        payloadHash: input.contentHash,
        descriptorDigest: digestCanonicalWorkroomValue({
          objectId,
          payloadHash: input.contentHash,
          projectId: input.projectId,
        }),
        locationManifestDigest: digestCanonicalWorkroomValue({ location: vaultObjectId }),
        bytes: Buffer.byteLength(canonicalWorkroomJson(input.value)),
      }),
      source: Object.freeze({
        kind: 'command' as const,
        ref: input.source.ref,
        digest: input.source.digest,
        bindingDigest: input.source.bindingDigest,
        verification: 'verified' as const,
      }),
    });
  }

  async read(input: WorkroomJournalPayloadReadInput): Promise<unknown> {
    const value = this.#values.get(input.receipt.descriptor.vaultObjectId);
    if (value === undefined) throw new Error('Memory Workroom Journal payload is unavailable');
    return structuredClone(value);
  }
}

/**
 * Durable append-only journal. Every committed batch is an immutable segment;
 * publishing its first sequence with an exclusive hard-link is the filesystem
 * CAS. Separate generation instances and separate processes therefore cannot
 * overwrite one another after reading the same expectedSequence.
 */
export class FileWorkroomJournal implements WorkroomJournal {
  readonly #directory: string;
  readonly #store: DurableFileStore;
  readonly #payloads?: WorkroomJournalPayloadPort;

  constructor(directory: string, payloads?: WorkroomJournalPayloadPort) {
    this.#directory = directory;
    this.#store = new DurableFileStore(directory);
    this.#payloads = payloads;
  }

  async listRunIds(): Promise<readonly string[]> {
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch (error) {
      if (isMissingFile(error)) return Object.freeze([]);
      throw error;
    }
    if (names.some(name => name.endsWith('.json') && !isSegmentName(name))) {
      throw new Error('Invalid Workroom journal segment name');
    }
    const ids = new Set<string>();
    for (const name of names) {
      if (!isSegmentName(name)) continue;
      const events = await this.#readStoredFile(
        join(this.#directory, name),
        segmentFirstSequence(name),
      );
      const runId = events[0]?.runId;
      if (runId) ids.add(runId);
    }
    if (ids.size > 0) await this.#store.syncLeaf();
    return Object.freeze([...ids].sort());
  }

  async scanStoredHeaders(): Promise<readonly WorkroomStoredRunHeaders[]> {
    const groups = new Map<string, StoredWorkroomEvent[]>();
    let names: string[];
    try {
      names = (await readdir(this.#directory)).filter(name => name.endsWith('.json')).sort();
    } catch (error) {
      if (isMissingFile(error)) return Object.freeze([]);
      throw error;
    }
    if (names.some(name => !isSegmentName(name))) {
      throw new Error('Invalid Workroom journal segment name');
    }
    for (const name of names) {
      const events = await this.#readStoredFile(join(this.#directory, name), segmentFirstSequence(name));
      const runId = events[0]?.runId;
      if (!runId) throw new Error('Workroom journal segment has no Run header');
      groups.set(runId, [...(groups.get(runId) ?? []), ...events]);
    }
    if (groups.size > 0) await this.#store.syncLeaf();
    return Object.freeze([...groups.entries()]
      .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
      .map(([runId, events]) => storedRunHeaders(runId, events)));
  }

  async readStoredHeaders(runId: string): Promise<WorkroomStoredRunHeaders | null> {
    const events = await this.#readStoredWithoutPayloads(runId);
    return events.length === 0 ? null : storedRunHeaders(runId, events);
  }

  async verifyGovernedPayloadPublication(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification> {
    if (!intent.publicationScope) return deepFreeze({ status: 'missing' as const });
    return verifyJournalPayloadPublication(
      intent,
      await this.#readStoredWithoutPayloads(intent.publicationScope),
    );
  }

  async read(runId: string): Promise<readonly WorkroomEvent[]> {
    const digest = this.#digest(runId);
    let names: string[];
    try {
      const entries = await readdir(this.#directory);
      names = entries
        .filter(name => name.startsWith(`${digest}.`) && name.endsWith('.json'));
      if (names.some(name => !isSegmentName(name))) {
        throw new Error('Invalid Workroom journal segment name');
      }
      names.sort();
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const segments = await Promise.all(names.map(name => this.#readStoredFile(
      join(this.#directory, name),
      segmentFirstSequence(name),
    )));
    const events = segments.flat();
    if (events.some(event => event.runId !== runId)) {
      throw new Error('Workroom journal digest collision');
    }
    const ordered = events.sort((left, right) => left.sequence - right.sequence);
    if (ordered.some((event, index) => event.sequence !== index)) {
      throw new Error('Workroom journal sequence is not contiguous');
    }
    if (ordered.length > 0) {
      await this.#store.syncLeaf();
      await reconcileJournalPayloads(runId, ordered, this.#requirePayloads());
    }
    if (ordered.length === 0) return Object.freeze([]);
    return await materializeStoredEvents(Object.freeze(ordered), this.#requirePayloads());
  }

  async append(
    runId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]> {
    const current = await this.#readStored(runId);
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (actualSequence !== expectedSequence) {
      throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
    }
    if (drafts.length === 0) return [];
    const result = materializeEvents(runId, expectedSequence, drafts);
    const projectId = projectIdForAppend(current, result);
    await this.#store.ensureDurableLeaf('Workroom Journal');
    await this.#assertNoLegacyEmbeddedPayload();
    const protectedEvents = await protectEvents(result, projectId, this.#requirePayloads());
    const segment = this.#segmentPath(runId, expectedSequence + 1);
    const payload: FileWorkroomJournalSegmentPayload = Object.freeze({
      version: 3,
      runId,
      expectedSequence,
      events: protectedEvents,
    });
    const stored: FileWorkroomJournalSegment = Object.freeze({
      ...payload,
      payloadDigest: digestCanonicalWorkroomValue(payload),
    });
    const receipts = collectGovernedPayloadReceipts(protectedEvents);
    await this.#requirePayloads().prepare?.({ projectId, runId, receipts });
    let headerPublished = false;
    try {
      const published = await this.#store.publishCreateOnly({
        target: segment,
        content: canonicalWorkroomJson(stored),
        createdValue: result,
        onConflict: async () => {
          const winner = await this.#readStored(runId);
          throw new WorkroomSequenceConflictError(
            runId,
            expectedSequence,
            winner.at(-1)?.sequence ?? -1,
          );
        },
      });
      headerPublished = true;
      await this.#requirePayloads().publish?.({
        projectId,
        runId,
        receipts,
        publicationDigest: journalPublicationDigest(runId, [...current, ...protectedEvents]),
      });
      return published.value;
    } catch (error) {
      if (!headerPublished) {
        await this.#requirePayloads().abandon?.({ projectId, runId, receipts, reason: 'cas_lost' });
      }
      throw error;
    }
  }

  async #readStored(runId: string): Promise<readonly StoredWorkroomEvent[]> {
    const events = await this.#readStoredWithoutPayloads(runId);
    if (events.length > 0) await reconcileJournalPayloads(runId, events, this.#requirePayloads());
    return events;
  }

  async #assertNoLegacyEmbeddedPayload(): Promise<void> {
    const names = await readdir(this.#directory);
    const unexpected = names.find(name => !isSegmentName(name) && !isSegmentTemporaryName(name));
    if (unexpected) throw new Error('Invalid Workroom journal segment name');
    const segments = names.filter(isSegmentName).sort();
    if (segments.length === 0) return;
    await assertActiveStoreHasNoLegacyEmbeddedPayload(new FileLegacyEmbeddedPayloadReadAdapter(
      segments.map(name => ({ sourceKind: 'journal', path: join(this.#directory, name) })),
    ));
  }

  async #readStoredWithoutPayloads(runId: string): Promise<readonly StoredWorkroomEvent[]> {
    const digest = this.#digest(runId);
    let names: string[];
    try {
      names = (await readdir(this.#directory))
        .filter(name => name.startsWith(`${digest}.`) && name.endsWith('.json'))
        .sort();
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const events = (await Promise.all(names.map(name => this.#readStoredFile(
      join(this.#directory, name), segmentFirstSequence(name),
    )))).flat().sort((left, right) => left.sequence - right.sequence);
    if (events.some((event, index) => event.runId !== runId || event.sequence !== index)) {
      throw new Error('Workroom journal sequence or Run binding is invalid');
    }
    if (events.length > 0) await this.#store.syncLeaf();
    return Object.freeze(events);
  }

  async #readStoredFile(path: string, expectedFirstSequence: number): Promise<readonly StoredWorkroomEvent[]> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        throw legacyJournalPayloadError();
      }
      if (isRecord(parsed) && (parsed.version === 1 || parsed.version === 2)) {
        throw legacyJournalPayloadError();
      }
      if (!isRecord(parsed) || parsed.version !== 3 || !isNonEmptyString(parsed.runId)
        || !Number.isSafeInteger(parsed.expectedSequence)
        || !Array.isArray(parsed.events) || typeof parsed.payloadDigest !== 'string') {
        throw new Error('Invalid Workroom journal segment envelope');
      }
      if (parsed.expectedSequence !== expectedFirstSequence - 1) {
        throw new Error('Workroom journal segment first sequence does not match its filename');
      }
      const events = parseStoredEvents(parsed.events);
      const payload: FileWorkroomJournalSegmentPayload = Object.freeze({
        version: 3,
        runId: parsed.runId,
        expectedSequence: parsed.expectedSequence,
        events,
      });
      const stored: FileWorkroomJournalSegment = Object.freeze({
        ...payload,
        payloadDigest: parsed.payloadDigest,
      });
      if (parsed.payloadDigest !== digestCanonicalWorkroomValue(payload)
        || canonicalWorkroomJson(parsed) !== canonicalWorkroomJson(stored)) {
        throw new Error('Workroom journal segment payload digest mismatch');
      }
      if (events.some(event => event.runId !== parsed.runId)) {
        throw new Error('Workroom journal segment Run binding drift');
      }
      if (basename(path) !== `${this.#digest(parsed.runId)}.${String(expectedFirstSequence).padStart(16, '0')}.json`) {
        throw new Error('Workroom journal segment Run digest does not match its filename');
      }
      if (events.length === 0 || events[0]!.sequence !== expectedFirstSequence) {
        throw new Error('Workroom journal segment first sequence does not match its filename');
      }
      if (events.some((event, index) => event.sequence !== expectedFirstSequence + index)) {
        throw new Error('Workroom journal segment sequence is not contiguous');
      }
      return events;
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  #digest(runId: string): string {
    return createHash('sha256').update(runId).digest('hex');
  }

  #segmentPath(runId: string, firstSequence: number): string {
    return join(this.#directory, `${this.#digest(runId)}.${String(firstSequence).padStart(16, '0')}.json`);
  }

  #requirePayloads(): WorkroomJournalPayloadPort {
    if (!this.#payloads) throw new WorkroomJournalPayloadAuthorityUnavailableError();
    return this.#payloads;
  }
}

/** Candidate-owned latch: no caller can observe a placeholder journal. */
export class ActivatableWorkroomJournal implements WorkroomJournal {
  #delegate: WorkroomJournal | null = null;

  get active(): boolean {
    return this.#delegate !== null;
  }

  activate(delegate: WorkroomJournal): void {
    if (this.#delegate) throw new Error('Workroom journal is already active');
    this.#delegate = delegate;
  }

  listRunIds(): Promise<readonly string[]> {
    return this.#require().listRunIds();
  }

  scanStoredHeaders(): Promise<readonly WorkroomStoredRunHeaders[]> {
    return this.#require().scanStoredHeaders();
  }

  readStoredHeaders(runId: string): Promise<WorkroomStoredRunHeaders | null> {
    return this.#require().readStoredHeaders(runId);
  }

  verifyGovernedPayloadPublication(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification> {
    const delegate = this.#require();
    return delegate.verifyGovernedPayloadPublication
      ? delegate.verifyGovernedPayloadPublication(intent)
      : Promise.resolve(deepFreeze({ status: 'unknown' as const }));
  }

  read(runId: string): Promise<readonly WorkroomEvent[]> {
    return this.#require().read(runId);
  }

  append(runId: string, expectedSequence: number, events: readonly WorkroomEventDraft[]): Promise<readonly WorkroomEvent[]> {
    return this.#require().append(runId, expectedSequence, events);
  }

  #require(): WorkroomJournal {
    if (!this.#delegate) throw new Error('Workroom journal is not active');
    return this.#delegate;
  }
}

interface WorkroomEventModel {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

interface WorkroomTransaction {
  select(table: string): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

interface WorkroomDatabase {
  transaction<T>(
    operation: (transaction: WorkroomTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

export class DatabaseWorkroomJournal implements WorkroomJournal {
  readonly #database: WorkroomDatabase;
  readonly #eventModel: WorkroomEventModel;
  readonly #payloads?: WorkroomJournalPayloadPort;

  constructor(
    database: WorkroomDatabase,
    eventModel: WorkroomEventModel,
    payloads?: WorkroomJournalPayloadPort,
  ) {
    this.#database = database;
    this.#eventModel = eventModel;
    this.#payloads = payloads;
  }

  async listRunIds(): Promise<readonly string[]> {
    return Object.freeze((await this.scanStoredHeaders()).map(run => run.runId));
  }

  async scanStoredHeaders(): Promise<readonly WorkroomStoredRunHeaders[]> {
    const rows = await this.#eventModel.select().where({});
    return Object.freeze([...parseStoredRowGroups(rows).entries()]
      .map(([runId, events]) => storedRunHeaders(runId, events)));
  }

  async readStoredHeaders(runId: string): Promise<WorkroomStoredRunHeaders | null> {
    const rows = await this.#eventModel.select().where({ run_id: runId });
    const events = parseStoredRows(runId, rows);
    return events.length === 0 ? null : storedRunHeaders(runId, events);
  }

  async verifyGovernedPayloadPublication(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification> {
    if (!intent.publicationScope) return deepFreeze({ status: 'missing' as const });
    const rows = await this.#eventModel.select().where({ run_id: intent.publicationScope });
    return verifyJournalPayloadPublication(
      intent,
      parseStoredRows(intent.publicationScope, rows),
    );
  }

  async read(runId: string): Promise<readonly WorkroomEvent[]> {
    const rows = await this.#eventModel.select().where({ run_id: runId });
    const events = parseStoredRows(runId, rows);
    if (events.length === 0) return Object.freeze([]);
    await reconcileJournalPayloads(runId, events, this.#requirePayloads());
    return await materializeStoredEvents(events, this.#requirePayloads());
  }

  async append(
    runId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]> {
    let publication: Readonly<{
      projectId: string;
      protectedEvents: readonly StoredWorkroomEvent[];
      current: readonly StoredWorkroomEvent[];
    }> | undefined;
    let headerPublished = false;
    try {
      const allRows = await this.#eventModel.select().where({});
      await assertActiveStoreHasNoLegacyEmbeddedPayload({
        read: async () => legacyDatabaseJournalRecords(allRows),
      });
      const current = parseStoredRowGroups(allRows).get(runId) ?? Object.freeze([]);
      if (current.length > 0) {
        await reconcileJournalPayloads(runId, current, this.#requirePayloads());
      }
      const actualSequence = current.at(-1)?.sequence ?? -1;
      if (actualSequence !== expectedSequence) {
        throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
      }
      if (drafts.length === 0) return [];
      const appended = materializeEvents(runId, expectedSequence, drafts);
      const projectId = projectIdForAppend(current, appended);
      const protectedEvents = await protectEvents(appended, projectId, this.#requirePayloads());
      publication = { projectId, protectedEvents, current };
      await this.#requirePayloads().prepare?.({
        projectId,
        runId,
        receipts: collectGovernedPayloadReceipts(protectedEvents),
      });
      await this.#database.transaction(async transaction => {
        const transactionRows = await transaction.select('workroom_events').where({});
        await assertActiveStoreHasNoLegacyEmbeddedPayload({
          read: async () => legacyDatabaseJournalRecords(transactionRows),
        });
        const transactionCurrent = parseStoredRowGroups(transactionRows).get(runId)
          ?? Object.freeze([]);
        const transactionSequence = transactionCurrent.at(-1)?.sequence ?? -1;
        if (transactionSequence !== expectedSequence) {
          throw new WorkroomSequenceConflictError(runId, expectedSequence, transactionSequence);
        }
        await transaction.insertMany('workroom_events', protectedEvents.map(toRow));
      }, { isolationLevel: 'SERIALIZABLE' });
      headerPublished = true;
      await this.#requirePayloads().publish?.({
        projectId: publication.projectId,
        runId,
        receipts: collectGovernedPayloadReceipts(publication.protectedEvents),
        publicationDigest: journalPublicationDigest(
          runId,
          [...publication.current, ...publication.protectedEvents],
        ),
      });
      return appended;
    } catch (error) {
      if (publication && !headerPublished) {
        await this.#requirePayloads().abandon?.({
          projectId: publication.projectId,
          runId,
          receipts: collectGovernedPayloadReceipts(publication.protectedEvents),
          reason: error instanceof WorkroomSequenceConflictError ? 'cas_lost' : 'write_failed',
        });
      }
      if (error instanceof WorkroomSequenceConflictError || headerPublished) throw error;
      // A serializable/unique-key loser is dialect-specific. Re-read the
      // authoritative sequence and normalize only a proven concurrent winner;
      // unrelated database failures retain their original error.
      const actualSequence = (await this.read(runId)).at(-1)?.sequence ?? -1;
      if (actualSequence !== expectedSequence) {
        throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
      }
      throw error;
    }
  }

  #requirePayloads(): WorkroomJournalPayloadPort {
    if (!this.#payloads) throw new WorkroomJournalPayloadAuthorityUnavailableError();
    return this.#payloads;
  }
}

function legacyDatabaseJournalRecords(
  rows: readonly Record<string, unknown>[],
): readonly LegacyEmbeddedPayloadRecord[] {
  return Object.freeze(rows.map(row => {
    let envelope: unknown;
    try {
      envelope = JSON.parse(String(row.payload_json)) as unknown;
    } catch {
      throw new Error('Legacy Workroom Journal database payload is corrupt or unknown');
    }
    return Object.freeze({
      storage: 'database' as const,
      sourceKind: 'journal' as const,
      recordRef: `workroom-events:${digestCanonicalWorkroomValue({
        runId: String(row.run_id),
        sequence: row.sequence,
      })}`,
      value: Object.freeze({ version: row.version, envelope }),
    });
  }));
}

function materializeEvents(
  runId: string,
  expectedSequence: number,
  drafts: readonly WorkroomEventDraft[],
): readonly WorkroomEvent[] {
  if (!isNonEmptyString(runId) || !Number.isSafeInteger(expectedSequence) || expectedSequence < -1) {
    throw new Error('Invalid Workroom append position');
  }
  return Object.freeze(drafts.map<WorkroomEvent>((draft, index) => {
    if (!isNonEmptyString(draft.eventId) || !isFiniteNumber(draft.occurredAt)
      || !isWorkroomEventType(draft.type) || !isRecord(draft.payload)) {
      throw new Error('Invalid Workroom event draft');
    }
    validatePayload(draft.type, draft.payload, expectedSequence + index + 1);
    return Object.freeze({
      ...draft,
      version: 1,
      runId,
      sequence: expectedSequence + index + 1,
      payload: Object.freeze({ ...draft.payload }),
    });
  }));
}

function parseStoredEvents(values: readonly unknown[]): readonly StoredWorkroomEvent[] {
  const events = values.map((value): StoredWorkroomEvent => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid Workroom journal event');
    }
    const raw = value as Record<string, unknown>;
    if (raw.version === 1 || raw.version === 2) throw legacyJournalPayloadError();
    assertExactRecordKeys(raw, [
      'version', 'eventId', 'runId', 'sequence', 'occurredAt', 'type', 'control', 'payload',
    ], 'Stored Workroom event');
    const event = value as Partial<StoredWorkroomEvent>;
    if (event.version !== 3 || !isNonEmptyString(event.eventId) || !isNonEmptyString(event.runId)
      || !isSequence(event.sequence) || !isFiniteNumber(event.occurredAt)
      || !isWorkroomEventType(event.type) || !isRecord(event.control) || !isRecord(event.payload)) {
      throw new Error('Invalid Workroom journal event');
    }
    validateStoredEventControl(event.type, event.control);
    validateProtectedPayload(event.type, event.payload);
    const sequence = Number(event.sequence);
    return Object.freeze({
      ...event,
      version: 3,
      eventId: event.eventId,
      runId: event.runId,
      sequence,
      occurredAt: event.occurredAt,
      type: event.type,
      control: deepFreeze({ ...event.control }),
      payload: Object.freeze({ ...event.payload }),
    });
  });
  return Object.freeze(events.sort((left, right) => left.sequence - right.sequence));
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function isSegmentName(name: string): boolean {
  return /^[a-f0-9]{64}\.[0-9]{16}\.json$/u.test(name);
}

function isSegmentTemporaryName(name: string): boolean {
  return /^[a-f0-9]{64}\.[0-9]{16}\.json\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/u
    .test(name);
}

function segmentFirstSequence(name: string): number {
  if (!isSegmentName(name)) throw new Error('Invalid Workroom journal segment name');
  const value = Number(name.slice(65, 81));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid Workroom journal segment first sequence');
  }
  return value;
}

function toRow(event: StoredWorkroomEvent): Record<string, unknown> {
  const storedEventDigest = digestStoredWorkroomEvent(event);
  const row: Record<string, unknown> = {
    id: `${event.runId}:${event.sequence}`,
    run_id: event.runId,
    sequence: event.sequence,
    version: event.version,
    type: event.type,
    payload_json: canonicalWorkroomJson({
      eventId: event.eventId,
      control: event.control,
      payload: event.payload,
    }),
    occurred_at: event.occurredAt,
    stored_event_digest: storedEventDigest,
  };
  return { ...row, row_binding_digest: digestWorkroomEventRowBinding(row) };
}

function parseStoredRows(runId: string, rows: readonly Record<string, unknown>[]): readonly StoredWorkroomEvent[] {
  const events = rows.map(row => {
    if (row.version === 1 || row.version === 2) throw legacyJournalPayloadError();
    if (!isDigest(row.stored_event_digest) || !isDigest(row.row_binding_digest)) {
      throw legacyJournalPayloadError();
    }
    if (row.version !== 3) throw new Error(`Unsupported Workroom event version: ${String(row.version)}`);
    let envelope: { eventId?: unknown; control?: unknown; payload?: unknown };
    try {
      envelope = JSON.parse(String(row.payload_json)) as typeof envelope;
    } catch {
      throw new Error('Invalid Workroom event payload JSON');
    }
    if (!envelope || !isNonEmptyString(envelope.eventId) || !isRecord(envelope.control)
      || !isRecord(envelope.payload)
      || !isSequence(row.sequence) || !isFiniteNumber(row.occurred_at)
      || !isWorkroomEventType(row.type)) {
      throw new Error('Invalid Workroom event payload envelope');
    }
    assertExactRecordKeys(envelope, ['eventId', 'control', 'payload'], 'Workroom event payload envelope');
    const expectedId = `${runId}:${Number(row.sequence)}`;
    if (row.id !== expectedId) throw new Error('Workroom event row id binding is invalid');
    if (String(row.payload_json) !== canonicalWorkroomJson(envelope)) {
      throw new Error('Workroom event payload JSON is not canonical');
    }
    validateStoredEventControl(row.type, envelope.control);
    validateProtectedPayload(row.type, envelope.payload);
    const event = Object.freeze<StoredWorkroomEvent>({
      version: 3 as const,
      eventId: envelope.eventId,
      runId,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      type: row.type,
      control: deepFreeze({ ...envelope.control }),
      payload: Object.freeze({ ...envelope.payload }),
    });
    if (row.stored_event_digest !== digestStoredWorkroomEvent(event)) {
      throw new Error('Workroom stored event digest mismatch');
    }
    if (row.row_binding_digest !== digestWorkroomEventRowBinding(row)) {
      throw new Error('Workroom event row binding digest mismatch');
    }
    return event;
  }).sort((left, right) => left.sequence - right.sequence);
  const stored = Object.freeze(events);
  if (stored.length > 0) assertStoredEventReceiptBindings(stored);
  return stored;
}

function parseStoredRowGroups(
  rows: readonly Record<string, unknown>[],
): ReadonlyMap<string, readonly StoredWorkroomEvent[]> {
  const rowGroups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const runId = String(row.run_id ?? '');
    if (!isNonEmptyString(runId)) throw new Error('Invalid Workroom event Run id');
    rowGroups.set(runId, [...(rowGroups.get(runId) ?? []), row]);
  }
  return new Map([...rowGroups.entries()]
    .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
    .map(([runId, runRows]) => [runId, parseStoredRows(runId, runRows)] as const));
}

export function digestStoredWorkroomEvent(event: Readonly<{
  version: 3;
  eventId: string;
  runId: string;
  sequence: number;
  occurredAt: number;
  type: WorkroomEvent['type'];
  control: WorkroomStoredEventControl;
  payload: Readonly<Record<string, unknown>>;
}>): string {
  return digestCanonicalWorkroomValue({
    version: event.version,
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    control: event.control,
    payload: event.payload,
  });
}

export function digestWorkroomEventRowBinding(row: Readonly<Record<string, unknown>>): string {
  return digestCanonicalWorkroomValue({
    version: 1,
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    storedVersion: row.version,
    type: row.type,
    payloadJson: row.payload_json,
    occurredAt: row.occurred_at,
    storedEventDigest: row.stored_event_digest,
  });
}

function storedRunHeaders(
  runId: string,
  values: readonly StoredWorkroomEvent[],
): WorkroomStoredRunHeaders {
  if (!isNonEmptyString(runId) || values.length === 0
    || values.some((event, index) => event.runId !== runId || event.sequence !== index)) {
    throw new Error('Stored Workroom Journal header sequence or Run binding is invalid');
  }
  assertStoredEventReceiptBindings(values);
  const events = values.map((event): WorkroomStoredEventHeader => {
    const protectedPayloadDigest = digestCanonicalWorkroomValue(event.payload);
    const body = deepFreeze({
      version: 1 as const,
      eventRef: `workroom-event:${digestCanonicalWorkroomValue({
        runId, eventId: event.eventId, sequence: event.sequence,
      })}`,
      runId,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      type: event.type,
      control: event.control,
      protectedPayloadDigest,
      protectedReceipts: storedProtectedReceiptHeaders(event.payload),
    });
    return deepFreeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
  });
  const body = deepFreeze({ version: 1 as const, runId, events });
  return deepFreeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
}

function deriveStoredEventControl(event: WorkroomEvent): WorkroomStoredEventControl {
  const payload = event.payload;
  const taskKey = (): string => opaqueStoredRef('task', event.runId, storedHeaderText(payload, 'taskKey'));
  const assignmentId = (): string =>
    opaqueStoredRef('assignment', event.runId, storedHeaderText(payload, 'assignmentId'));
  switch (event.type) {
    case 'run.created': return deepFreeze({ projectId: storedHeaderText(payload, 'projectId') });
    case 'task.planned': return deepFreeze({
      taskKey: taskKey(),
      required: payload.required === true,
      maxAttempts: storedHeaderPositiveInteger(payload, 'maxAttempts'),
    });
    case 'task.blocked': return deepFreeze({
      taskKey: taskKey(),
      blockerId: opaqueStoredRef('blocker', event.runId, storedHeaderText(payload, 'blockerId')),
      blockerKind: storedHeaderBlockerKind(payload.kind),
      blockerDeadline: storedHeaderNonNegativeInteger(payload, 'deadline'),
      blockerAllowedActions: Object.freeze(['resolve', 'replan', 'cancel'] as const),
    });
    case 'task.blocker_resolved': return deepFreeze({
      taskKey: taskKey(),
      blockerId: opaqueStoredRef('blocker', event.runId, storedHeaderText(payload, 'blockerId')),
    });
    case 'assignment.claimed': return deepFreeze({
      taskKey: taskKey(),
      assignmentId: assignmentId(),
      role: storedHeaderRole(payload.role),
      attempt: storedHeaderPositiveInteger(payload, 'attempt'),
      assignmentRevision: storedHeaderPositiveInteger(payload, 'assignmentRevision'),
      fence: storedHeaderPositiveInteger(payload, 'fence'),
    });
    case 'assignment.started':
    case 'assignment.progress':
    case 'assignment.heartbeat':
    case 'assignment.checkpointed':
    case 'assignment.checkpoint_requested':
    case 'assignment.preempted':
    case 'assignment.execution_completed':
    case 'assignment.cancel_requested':
    case 'assignment.lease_expired': return deepFreeze({ assignmentId: assignmentId() });
    case 'assignment.cancelled': return deepFreeze({
      assignmentId: assignmentId(), outcome: storedHeaderOutcome(payload.outcome),
    });
    case 'task.accepted':
    case 'task.acceptance_pinned':
    case 'task.acceptance_blocked':
    case 'task.cancel_requested':
    case 'task.cancelled':
    case 'task.failed':
    case 'task.rework_requested': return deepFreeze({ taskKey: taskKey() });
    case 'task.revised': return deepFreeze({
      taskKey: taskKey(), maxAttempts: storedHeaderPositiveInteger(payload, 'maxAttempts'),
    });
    case 'task.plan_revised': return deepFreeze({
      taskKey: taskKey(), required: payload.required === true,
      maxAttempts: storedHeaderPositiveInteger(payload, 'maxAttempts'),
      newTaskRevision: storedHeaderPositiveInteger(payload, 'newTaskRevision'),
    });
    case 'reviewer.assigned': {
      const assignment = storedHeaderRecord(payload, 'assignment');
      return deepFreeze({
        taskKey: taskKey(),
        waitId: opaqueStoredRef('reviewer', event.runId, storedHeaderText(assignment, 'id')),
        waitStatus: storedHeaderText(assignment, 'status'),
      });
    }
    case 'reviewer.claimed':
    case 'reviewer.verdict_recorded':
    case 'reviewer.expired': return deepFreeze({
      taskKey: taskKey(),
      waitId: opaqueStoredRef('reviewer', event.runId, storedHeaderText(payload, 'assignmentId')),
      ...(event.type === 'reviewer.verdict_recorded'
        ? { verdictOutcome: payload.outcome === 'passed' ? 'passed' as const : 'rework' as const }
        : {}),
    });
    case 'sponsor_gate.opened': {
      const gate = storedHeaderRecord(payload, 'gate');
      return deepFreeze({
        taskKey: taskKey(),
        waitId: opaqueStoredRef('sponsor-gate', event.runId, storedHeaderText(gate, 'id')),
        waitStatus: storedHeaderText(gate, 'status'),
      });
    }
    case 'sponsor_gate.decided': return deepFreeze({
      taskKey: taskKey(),
      waitId: opaqueStoredRef('sponsor-gate', event.runId, storedHeaderText(payload, 'gateId')),
      decision: storedHeaderDecision(payload.decision),
    });
    case 'sponsor_gate.expired': return deepFreeze({
      taskKey: taskKey(),
      waitId: opaqueStoredRef('sponsor-gate', event.runId, storedHeaderText(payload, 'gateId')),
    });
    default: return Object.freeze({});
  }
}

const WORKROOM_EVENT_CONTROL_KEYS: Readonly<Record<WorkroomEvent['type'], readonly string[]>> = Object.freeze({
  'run.created': ['projectId'],
  'task.planned': ['taskKey', 'required', 'maxAttempts'],
  'task.blocked': [
    'taskKey', 'blockerId', 'blockerKind', 'blockerDeadline', 'blockerAllowedActions',
  ],
  'task.blocker_resolved': ['taskKey', 'blockerId'],
  'assignment.claimed': [
    'taskKey', 'assignmentId', 'role', 'attempt', 'assignmentRevision', 'fence',
  ],
  'assignment.started': ['assignmentId'],
  'assignment.progress': ['assignmentId'],
  'assignment.heartbeat': ['assignmentId'],
  'assignment.checkpointed': ['assignmentId'],
  'assignment.checkpoint_requested': ['assignmentId'],
  'assignment.preempted': ['assignmentId'],
  'assignment.execution_completed': ['assignmentId'],
  'assignment.cancel_requested': ['assignmentId'],
  'assignment.cancelled': ['assignmentId', 'outcome'],
  'assignment.lease_expired': ['assignmentId'],
  'task.accepted': ['taskKey'],
  'task.acceptance_pinned': ['taskKey'],
  'task.acceptance_blocked': ['taskKey'],
  'task.cancel_requested': ['taskKey'],
  'task.cancelled': ['taskKey'],
  'task.failed': ['taskKey'],
  'task.rework_requested': ['taskKey'],
  'task.revised': ['taskKey', 'maxAttempts'],
  'task.plan_revised': ['taskKey', 'required', 'maxAttempts', 'newTaskRevision'],
  'reviewer.assigned': ['taskKey', 'waitId', 'waitStatus'],
  'reviewer.claimed': ['taskKey', 'waitId'],
  'reviewer.verdict_recorded': ['taskKey', 'waitId', 'verdictOutcome'],
  'reviewer.expired': ['taskKey', 'waitId'],
  'sponsor_gate.opened': ['taskKey', 'waitId', 'waitStatus'],
  'sponsor_gate.decided': ['taskKey', 'waitId', 'decision'],
  'sponsor_gate.expired': ['taskKey', 'waitId'],
  'plan.admitted': [],
  'plan.revision_applied': [],
  'plan_gate.decided': [],
  'run.control_decided': [],
  'run.replan_requested': [],
  'run.cancel_requested': [],
  'run.cancelled': [],
  'scheduler.dispatch_requested': [],
  'scheduler.priority_changed': [],
  'scheduler.preemption_requested': [],
  'scheduler.preemption_checkpoint_acknowledged': [],
  'scheduler.preemption_timed_out': [],
  'local_execution.requested': [],
  'remote_dispatch.requested': [],
  'clock.advanced': [],
});

function validateStoredEventControl(
  type: WorkroomEvent['type'],
  control: Readonly<Record<string, unknown>>,
): void {
  const keys = type === 'task.blocked' && Object.keys(control).length === 2
    ? ['taskKey', 'blockerId']
    : WORKROOM_EVENT_CONTROL_KEYS[type];
  assertExactRecordKeys(control, keys, 'Stored Workroom control');
  if (control.projectId !== undefined) storedHeaderText(control, 'projectId');
  for (const key of ['taskKey', 'assignmentId', 'blockerId', 'waitId'] as const) {
    if (control[key] !== undefined && (typeof control[key] !== 'string'
      || !/^workroom-[a-z-]+:[a-f0-9]{64}$/u.test(control[key]))) {
      throw new Error(`Stored Workroom control ${key} is invalid`);
    }
  }
  for (const key of ['maxAttempts', 'attempt', 'assignmentRevision', 'fence', 'newTaskRevision'] as const) {
    if (control[key] !== undefined) storedHeaderPositiveInteger(control, key);
  }
  if (control.required !== undefined && typeof control.required !== 'boolean') {
    throw new Error('Stored Workroom control required is invalid');
  }
  if (control.blockerKind !== undefined) storedHeaderBlockerKind(control.blockerKind);
  if (control.blockerDeadline !== undefined) {
    storedHeaderNonNegativeInteger(control, 'blockerDeadline');
  }
  if (control.blockerAllowedActions !== undefined) {
    storedHeaderBlockerActions(control.blockerAllowedActions);
  }
  if (control.role !== undefined) storedHeaderRole(control.role);
  if (control.outcome !== undefined) storedHeaderOutcome(control.outcome);
  if (control.decision !== undefined) storedHeaderDecision(control.decision);
  if (control.verdictOutcome !== undefined
    && control.verdictOutcome !== 'passed' && control.verdictOutcome !== 'rework') {
    throw new Error('Stored Workroom control verdict outcome is invalid');
  }
  if (control.waitStatus !== undefined && ![
    'open', 'claimed', 'passed', 'rework', 'expired', 'cancelled', 'satisfied', 'stale',
  ].includes(String(control.waitStatus))) {
    throw new Error('Stored Workroom control wait status is invalid');
  }
}

function storedProtectedReceiptHeaders(
  value: Readonly<Record<string, unknown>>,
): readonly WorkroomStoredProtectedReceiptHeader[] {
  const headers: WorkroomStoredProtectedReceiptHeader[] = [];
  const visit = (candidate: unknown): void => {
    if (isGovernedJournalPayloadReference(candidate)) {
      headers.push(deepFreeze({
        fieldPath: candidate.fieldPath,
        contentHash: candidate.contentHash,
        descriptorDigest: candidate.receipt.descriptor.descriptorDigest,
        sourceDigest: candidate.receipt.source.digest,
        sourceBindingDigest: candidate.receipt.source.bindingDigest,
      }));
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (isRecord(candidate)) for (const item of Object.values(candidate)) visit(item);
  };
  visit(value);
  return deepFreeze(headers.sort((left, right) =>
    compareCanonicalWorkroomText(left.fieldPath, right.fieldPath)));
}

function opaqueStoredRef(kind: string, runId: string, rawId: string): string {
  return `workroom-${kind}:${digestCanonicalWorkroomValue({ kind, runId, rawId }).slice('sha256:'.length)}`;
}

function storedHeaderText(payload: Readonly<Record<string, unknown>>, key: string): string {
  const value = payload[key];
  if (!isNonEmptyString(value)) throw new Error(`Stored Workroom header ${key} is invalid`);
  return value;
}

function storedHeaderPositiveInteger(payload: Readonly<Record<string, unknown>>, key: string): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Stored Workroom header ${key} is invalid`);
  }
  return Number(value);
}

function storedHeaderNonNegativeInteger(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Stored Workroom header ${key} is invalid`);
  }
  return Number(value);
}

function storedHeaderBlockerKind(value: unknown): WorkroomBlockerKind {
  if (value !== 'dependency' && value !== 'approval' && value !== 'capability'
    && value !== 'external' && value !== 'human_input') {
    throw new Error('Stored Workroom header Blocker kind is invalid');
  }
  return value;
}

function storedHeaderBlockerActions(value: unknown): WorkroomBlocker['allowedActions'] {
  if (!Array.isArray(value)
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(['resolve', 'replan', 'cancel'])) {
    throw new Error('Stored Workroom header Blocker allowedActions are invalid');
  }
  return Object.freeze([...value]) as WorkroomBlocker['allowedActions'];
}

function storedHeaderRecord(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = payload[key];
  if (!isRecord(value)) throw new Error(`Stored Workroom header ${key} is invalid`);
  return value;
}

function storedHeaderRole(value: unknown): WorkroomAssignmentRoleHeader {
  if (value !== 'executor' && value !== 'reviewer' && value !== 'integration') {
    throw new Error('Stored Workroom header Assignment role is invalid');
  }
  return value;
}

function storedHeaderOutcome(value: unknown): NonNullable<WorkroomStoredEventControl['outcome']> {
  if (value !== 'interrupted' && value !== 'committed' && value !== 'outcome_unknown') {
    throw new Error('Stored Workroom header Assignment outcome is invalid');
  }
  return value;
}

function storedHeaderDecision(value: unknown): NonNullable<WorkroomStoredEventControl['decision']> {
  if (value !== 'approve' && value !== 'reject' && value !== 'request_changes' && value !== 'cancel') {
    throw new Error('Stored Workroom header Sponsor decision is invalid');
  }
  return value;
}

async function protectEvents(
  events: readonly WorkroomEvent[],
  projectId: string,
  payloads: WorkroomJournalPayloadPort,
): Promise<readonly StoredWorkroomEvent[]> {
  return Object.freeze(await Promise.all(events.map(async event => Object.freeze({
    ...event,
    version: 3 as const,
    control: deriveStoredEventControl(event),
    payload: await protectValue(event.payload, '$.payload', event, projectId, payloads) as Readonly<Record<string, unknown>>,
  }))));
}

async function protectValue(
  value: unknown,
  fieldPath: string,
  event: WorkroomEvent,
  projectId: string,
  payloads: WorkroomJournalPayloadPort,
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Object.freeze(await Promise.all(value.map((item, index) =>
      protectValue(item, `${fieldPath}[${index}]`, event, projectId, payloads))));
  }
  if (!isRecord(value)) return value;
  const entries: Array<readonly [string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    const path = `${fieldPath}.${key}`;
    if (!isContentFreeJournalValue(event.type, path, child) && containsGovernedValue(child)) {
      const contentHash = digestCanonicalWorkroomValue(child);
      const source = journalPayloadSource(event, path, contentHash);
      const receipt = await payloads.write({
        projectId,
        runId: event.runId,
        eventId: event.eventId,
        eventType: event.type,
        occurredAt: event.occurredAt,
        fieldPath: path,
        value: structuredClone(child),
        contentHash,
        source,
      });
      assertJournalPayloadReceipt(
        receipt,
        createWorkroomJournalPayloadObjectId({
          projectId,
          runId: event.runId,
          eventId: event.eventId,
          eventType: event.type,
          occurredAt: event.occurredAt,
          fieldPath: path,
          contentHash,
        }),
        contentHash,
        source,
      );
      entries.push([key, Object.freeze<GovernedWorkroomJournalPayloadReference>({
        version: 1,
        kind: 'governed_workroom_journal_payload',
        fieldPath: path,
        contentHash,
        receipt,
      })]);
      continue;
    }
    entries.push([key, await protectValue(child, path, event, projectId, payloads)]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

async function materializeStoredEvents(
  events: readonly StoredWorkroomEvent[],
  payloads: WorkroomJournalPayloadPort,
): Promise<readonly WorkroomEvent[]> {
  assertStoredEventReceiptBindings(events);
  const projectId = storedProjectId(events);
  const materialized = await Promise.all(events.map(async event => {
    const payload = await materializeValue(event.payload, '$.payload', event, projectId, payloads);
    if (!isRecord(payload)) throw new Error('Materialized Workroom Journal payload is invalid');
    validatePayload(event.type, payload, event.sequence);
    const derivedControl = deriveStoredEventControl({ ...event, version: 1, payload });
    const comparableControl = event.type === 'task.blocked'
      && Object.keys(event.control).length === 2
      ? Object.freeze({ taskKey: derivedControl.taskKey, blockerId: derivedControl.blockerId })
      : derivedControl;
    if (canonicalWorkroomJson(event.control) !== canonicalWorkroomJson(comparableControl)) {
      throw new Error('Stored Workroom control projection does not match the governed payload');
    }
    const { control: _control, ...eventHeader } = event;
    return Object.freeze<WorkroomEvent>({
      ...eventHeader,
      version: 1,
      payload: Object.freeze({ ...payload }),
    });
  }));
  return Object.freeze(materialized);
}

async function reconcileJournalPayloads(
  runId: string,
  events: readonly StoredWorkroomEvent[],
  payloads: WorkroomJournalPayloadPort,
): Promise<void> {
  if (!payloads.reconcile || events.length === 0) return;
  await payloads.reconcile({
    projectId: storedProjectId(events),
    runId,
    receipts: collectGovernedPayloadReceipts(events),
    publicationDigest: journalPublicationDigest(runId, events),
  });
}

function journalPublicationDigest(
  runId: string,
  events: readonly StoredWorkroomEvent[],
): string {
  return digestCanonicalWorkroomValue({
    version: 1,
    runId,
    eventHeaders: events.map(event => ({
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      control: event.control,
      payload: event.payload,
    })),
  });
}

function verifyJournalPayloadPublication(
  intent: GovernedPayloadWriteSagaSnapshot,
  events: readonly StoredWorkroomEvent[],
): GovernedPayloadPublicationVerification {
  if (intent.consumer !== 'journal_header') return deepFreeze({ status: 'unknown' as const });
  const runId = intent.publicationScope;
  if (!runId || events.length === 0 || events.some(event => event.runId !== runId)) {
    return deepFreeze({ status: 'missing' as const });
  }
  const exact = collectGovernedPayloadReceipts(events).some(receipt =>
    receipt.descriptor.objectId === intent.objectId
    && receipt.descriptor.payloadHash === intent.payloadHash
    && receipt.descriptor.descriptorDigest === intent.descriptorDigest
    && receipt.source.bindingDigest === intent.sourceBindingDigest);
  return exact
    ? deepFreeze({
        status: 'exact' as const,
        publicationDigest: journalPublicationDigest(runId, events),
      })
    : deepFreeze({ status: 'missing' as const });
}

function collectGovernedPayloadReceipts(
  events: readonly StoredWorkroomEvent[],
): readonly WorkroomGovernedPayloadReceipt[] {
  const receipts: WorkroomGovernedPayloadReceipt[] = [];
  const visit = (value: unknown): void => {
    if (isGovernedJournalPayloadReference(value)) {
      receipts.push(value.receipt);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const event of events) visit(event.payload);
  return Object.freeze(receipts);
}

async function materializeValue(
  value: unknown,
  fieldPath: string,
  event: StoredWorkroomEvent,
  projectId: string,
  payloads: WorkroomJournalPayloadPort,
): Promise<unknown> {
  if (isGovernedJournalPayloadReference(value)) {
    if (value.fieldPath !== fieldPath) throw new Error('Governed Workroom Journal payload field binding drift');
    const source = journalPayloadSource(event, fieldPath, value.contentHash);
    assertJournalPayloadReceipt(
      value.receipt,
      createWorkroomJournalPayloadObjectId({
        projectId,
        runId: event.runId,
        eventId: event.eventId,
        eventType: event.type,
        occurredAt: event.occurredAt,
        fieldPath,
        contentHash: value.contentHash,
      }),
      value.contentHash,
      source,
    );
    const materialized = await payloads.read({
      projectId,
      runId: event.runId,
      eventId: event.eventId,
      eventType: event.type,
      fieldPath,
      contentHash: value.contentHash,
      receipt: value.receipt,
      purpose: 'kernel-replay',
    });
    if (digestCanonicalWorkroomValue(materialized) !== value.contentHash) {
      throw new Error('Governed Workroom Journal payload content hash mismatch');
    }
    if (Buffer.byteLength(canonicalWorkroomJson(materialized)) !== value.receipt.descriptor.bytes) {
      throw new Error('Governed Workroom Journal payload byte length mismatch');
    }
    return materialized;
  }
  if (Array.isArray(value)) {
    return Object.freeze(await Promise.all(value.map((item, index) =>
      materializeValue(item, `${fieldPath}[${index}]`, event, projectId, payloads))));
  }
  if (!isRecord(value)) return value;
  return Object.freeze(Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [
    key,
    await materializeValue(child, `${fieldPath}.${key}`, event, projectId, payloads),
  ]))));
}

function projectIdForAppend(
  current: readonly StoredWorkroomEvent[],
  appended: readonly WorkroomEvent[],
): string {
  if (current.length > 0) return storedProjectId(current);
  const created = appended[0];
  if (!created || created.type !== 'run.created' || !isNonEmptyString(created.payload.projectId)) {
    throw new Error('Workroom Journal first append must begin with a Project-bound run.created event');
  }
  return created.payload.projectId;
}

function storedProjectId(events: readonly StoredWorkroomEvent[]): string {
  const created = events[0];
  if (!created || created.type !== 'run.created' || !isNonEmptyString(created.payload.projectId)) {
    throw new Error('Stored Workroom Journal has no Project-bound run.created header');
  }
  return created.payload.projectId;
}

function journalPayloadSource(
  event: Pick<WorkroomEvent, 'runId' | 'eventId' | 'type'>,
  fieldPath: string,
  contentHash: string,
) {
  const ref = `workroom-journal-event:${event.runId}:${event.eventId}:${fieldPath}`;
  const sourceBody = Object.freeze({
    version: 1 as const,
    runId: event.runId,
    eventId: event.eventId,
    eventType: event.type,
    fieldPath,
    contentHash,
  });
  const sourceDigest = digestCanonicalWorkroomValue(sourceBody);
  return Object.freeze({
    ref,
    digest: sourceDigest,
    bindingDigest: digestCanonicalWorkroomValue({ ref, sourceDigest, ...sourceBody }),
  });
}

function assertJournalPayloadReceipt(
  receipt: WorkroomGovernedPayloadReceipt,
  objectId: string,
  contentHash: string,
  source: ReturnType<typeof journalPayloadSource>,
): void {
  if (!receipt || !isRecord(receipt.descriptor) || !isRecord(receipt.source)
    || !isNonEmptyString(receipt.descriptor.vaultObjectId)
    || receipt.descriptor.objectId !== objectId
    || receipt.descriptor.payloadHash !== contentHash
    || !isDigest(receipt.descriptor.descriptorDigest)
    || !isDigest(receipt.descriptor.locationManifestDigest)
    || !Number.isSafeInteger(receipt.descriptor.bytes) || Number(receipt.descriptor.bytes) < 0
    || receipt.source.kind !== 'command'
    || receipt.source.ref !== source.ref
    || receipt.source.digest !== source.digest
    || receipt.source.bindingDigest !== source.bindingDigest
    || receipt.source.verification !== 'verified') {
    throw new Error('Governed Workroom Journal payload receipt is forged or incomplete');
  }
}

function assertStoredEventReceiptBindings(events: readonly StoredWorkroomEvent[]): void {
  if (events.length === 0) return;
  const projectId = storedProjectId(events);
  const visit = (value: unknown, fieldPath: string, event: StoredWorkroomEvent): void => {
    if (isGovernedJournalPayloadReference(value)) {
      if (value.fieldPath !== fieldPath) {
        throw new Error('Governed Workroom Journal payload field binding drift');
      }
      const source = journalPayloadSource(event, fieldPath, value.contentHash);
      assertJournalPayloadReceipt(
        value.receipt,
        createWorkroomJournalPayloadObjectId({
          projectId,
          runId: event.runId,
          eventId: event.eventId,
          eventType: event.type,
          occurredAt: event.occurredAt,
          fieldPath,
          contentHash: value.contentHash,
        }),
        value.contentHash,
        source,
      );
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${fieldPath}[${index}]`, event));
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, `${fieldPath}.${key}`, event);
      }
    }
  };
  for (const event of events) visit(event.payload, '$.payload', event);
}

export function createWorkroomJournalPayloadObjectId(input: Readonly<{
  projectId: string;
  runId: string;
  eventId: string;
  eventType: WorkroomEvent['type'];
  occurredAt: number;
  fieldPath: string;
  contentHash: string;
}>): string {
  return `workroom-journal-payload:${digestCanonicalWorkroomValue({
    version: 2,
    projectId: input.projectId,
    runId: input.runId,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    fieldPath: input.fieldPath,
    contentHash: input.contentHash,
  })}`;
}

function isGovernedJournalPayloadReference(value: unknown): value is GovernedWorkroomJournalPayloadReference {
  if (!isRecord(value) || value.version !== 1 || value.kind !== 'governed_workroom_journal_payload'
    || !isNonEmptyString(value.fieldPath) || !isDigest(value.contentHash)
    || !isRecord(value.receipt)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 5
    && ['contentHash', 'fieldPath', 'kind', 'receipt', 'version'].every((key, index) => keys[index] === key);
}

function validateProtectedPayload(
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
): void {
  assertAllowedPayloadKeys(type, payload);
  const visit = (value: unknown, fieldPath: string): void => {
    if (isGovernedJournalPayloadReference(value)) {
      if (value.fieldPath !== fieldPath) throw new Error('Governed Workroom Journal payload path is invalid');
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${fieldPath}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (!isContentFreeJournalValue(type, `${fieldPath}.${key}`, child) && containsGovernedValue(child)
        && !isGovernedJournalPayloadReference(child)) {
        throw legacyJournalPayloadError();
      }
      visit(child, `${fieldPath}.${key}`);
    }
  };
  visit(payload, '$.payload');
}

function isContentFreeJournalValue(
  type: WorkroomEvent['type'],
  fieldPath: string,
  value: unknown,
): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return true;
  if (typeof value !== 'string') return false;
  if (type === 'run.created' && fieldPath === '$.payload.projectId') return true;
  return isDigest(value);
}

function containsGovernedValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== 'object' || Object.keys(value).length > 0;
}

function legacyJournalPayloadError(): Error {
  return new LegacyEmbeddedPayloadDetectedError(
    'Legacy embedded Workroom Journal payload is quarantined; use offline export/purge verification before activation',
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

const WORKROOM_EVENT_TYPES = new Set<WorkroomEvent['type']>([
  'run.created', 'run.control_decided', 'run.replan_requested',
  'run.cancel_requested', 'run.cancelled', 'plan.admitted', 'plan_gate.decided',
  'plan.revision_applied',
  'task.planned', 'task.blocked', 'task.blocker_resolved',
  'task.cancel_requested', 'task.cancelled', 'task.failed',
  'task.accepted', 'task.acceptance_pinned', 'task.acceptance_blocked', 'task.rework_requested', 'task.revised',
  'task.plan_revised',
  'reviewer.assigned', 'reviewer.claimed', 'reviewer.verdict_recorded', 'reviewer.expired',
  'sponsor_gate.opened', 'sponsor_gate.decided', 'sponsor_gate.expired',
  'assignment.claimed', 'assignment.started', 'assignment.heartbeat',
  'assignment.progress', 'assignment.checkpointed',
  'assignment.checkpoint_requested', 'assignment.preempted',
  'assignment.execution_completed', 'assignment.cancel_requested',
  'assignment.cancelled', 'assignment.lease_expired',
  'scheduler.dispatch_requested', 'scheduler.priority_changed', 'scheduler.preemption_requested',
  'scheduler.preemption_checkpoint_acknowledged', 'scheduler.preemption_timed_out',
  'local_execution.requested',
  'remote_dispatch.requested', 'clock.advanced',
]);

function isWorkroomEventType(value: unknown): value is WorkroomEvent['type'] {
  return typeof value === 'string' && WORKROOM_EVENT_TYPES.has(value as WorkroomEvent['type']);
}

/**
 * Closed top-level schema for every persisted Kernel fact. Values not listed
 * here are rejected before either the Journal header or Payload Vault is
 * written, so adding a future field requires an explicit governance choice.
 */
const WORKROOM_EVENT_PAYLOAD_KEYS: Readonly<Record<WorkroomEvent['type'], readonly string[]>> = Object.freeze({
  'run.created': ['projectId', 'title'],
  'run.control_decided': [
    'operationId', 'action', 'reasonCode', 'expectedSequence', 'principalId', 'requestDigest',
    'catalogRevision', 'projectDigest', 'authorizationRef',
    'stateSequence', 'stateStatus', 'stateDigest',
  ],
  'run.replan_requested': ['operationId', 'reasonCode', 'requestDigest'],
  'run.cancel_requested': ['reason'],
  'run.cancelled': ['reason'],
  'plan.admitted': [
    'operationId', 'sourceEventRef', 'sourceEventDigest', 'orchestratorAgentDefinitionId',
    'plan', 'schedulerPolicy',
  ],
  'plan.revision_applied': ['candidate', 'planRevision', 'recomputedDiffDigest'],
  'plan_gate.decided': [
    'operationId', 'requestDigest', 'taskKey', 'taskRevision', 'gateId', 'planDigest',
    'policyRevisionId', 'policyDigest', 'decision', 'sponsorPrincipalId', 'authorizedBy',
    'reasonDigest',
  ],
  'task.planned': [
    'type', 'taskKey', 'title', 'required', 'maxAttempts', 'role', 'dependsOn', 'requires',
    'sponsorLane', 'localRank', 'deadline', 'enqueuedAt', 'preemptibility', 'approvalGate',
  ],
  'task.blocked': [
    'type', 'taskKey', 'blockerId', 'kind', 'owner', 'reason', 'deadline', 'allowedActions',
  ],
  'task.blocker_resolved': ['type', 'taskKey', 'blockerId'],
  'task.cancel_requested': ['taskKey', 'reason'],
  'task.cancelled': ['taskKey', 'reason'],
  'task.failed': ['taskKey', 'reason'],
  'task.accepted': ['taskKey', 'reportRef', 'record'],
  'task.acceptance_pinned': ['taskKey', 'contract'],
  'task.acceptance_blocked': ['taskKey', 'reportRef', 'reason', 'evaluation'],
  'task.rework_requested': ['type', 'taskKey', 'reason', 'evaluation'],
  'task.revised': ['type', 'taskKey', 'title', 'reason', 'maxAttempts'],
  'task.plan_revised': [
    'taskKey', 'title', 'required', 'maxAttempts', 'role', 'dependsOn', 'requires',
    'sponsorLane', 'localRank', 'deadline', 'enqueuedAt', 'preemptibility', 'approvalGate',
    'expectedTaskRevision', 'newTaskRevision', 'reason',
  ],
  'reviewer.assigned': ['taskKey', 'reason', 'assignment'],
  'reviewer.claimed': [
    'taskKey', 'assignmentId', 'reviewerPrincipalId', 'authorizedBy', 'authorization',
  ],
  'reviewer.verdict_recorded': [
    'taskKey', 'assignmentId', 'reviewerPrincipalId', 'authorizedBy', 'outcome',
    'verdict', 'authorization',
  ],
  'reviewer.expired': ['taskKey', 'assignmentId'],
  'sponsor_gate.opened': ['taskKey', 'reason', 'gate'],
  'sponsor_gate.decided': [
    'taskKey', 'gateId', 'sponsorPrincipalId', 'authorizedBy', 'reason', 'candidateHash',
    'decision', 'authorization',
  ],
  'sponsor_gate.expired': ['taskKey', 'gateId'],
  'assignment.claimed': [
    'type', 'taskKey', 'assignmentId', 'owner', 'role', 'taskRevision', 'attempt',
    'assignmentRevision', 'fence', 'envelopeDigest', 'leaseExpiresAt',
  ],
  'assignment.started': ['assignmentId'],
  'assignment.progress': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'progress',
  ],
  'assignment.heartbeat': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'leaseExpiresAt',
  ],
  'assignment.checkpointed': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest',
    'checkpointRef', 'checkpointDigest',
  ],
  'assignment.checkpoint_requested': [
    'decisionId', 'assignmentId', 'envelopeDigest', 'reservedTaskKey', 'requestedAt',
    'deadline', 'takeoverFence', 'owner', 'allowedSuccessors',
  ],
  'assignment.preempted': [
    'decisionId', 'assignmentId', 'checkpointRef', 'checkpointDigest', 'outcome',
  ],
  'assignment.execution_completed': [
    'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'reportRef',
    'reportDigest', 'candidateRef', 'candidateHash', 'completionReceiptDigest',
  ],
  'assignment.cancel_requested': ['assignmentId', 'controlDeadline'],
  'assignment.cancelled': ['assignmentId', 'outcome'],
  'assignment.lease_expired': ['assignmentId'],
  'scheduler.dispatch_requested': [
    'version', 'type', 'decisionId', 'digest', 'projectId', 'runId', 'expectedSequence',
    'taskKey', 'taskRevision', 'role', 'sponsorLane', 'reason', 'policy',
  ],
  'scheduler.priority_changed': [
    'version', 'type', 'proposalId', 'digest', 'projectId', 'runId', 'taskKey',
    'taskRevision', 'expectedSequence', 'currentLane', 'requestedLane', 'localRank',
    'principalId', 'authority', 'authorityRef', 'deadline', 'owner', 'allowedSuccessors',
    'authorizedBy',
  ],
  'scheduler.preemption_requested': [
    'version', 'type', 'decisionId', 'digest', 'projectId', 'runId', 'expectedSequence',
    'victimTaskKey', 'victimTaskRevision', 'reservedTaskKey', 'reservedTaskRevision',
    'assignmentId', 'assignmentAttempt', 'assignmentFence', 'assignmentEnvelopeDigest',
    'owner', 'requestedAt', 'deadline', 'takeoverFence', 'reason', 'allowedSuccessors', 'policy',
  ],
  'scheduler.preemption_checkpoint_acknowledged': [
    'decisionId', 'assignmentId', 'envelopeDigest', 'observationId', 'observationDigest',
    'checkpointRef', 'checkpointDigest', 'assignmentAttempt', 'assignmentFence', 'takeoverFence',
  ],
  'scheduler.preemption_timed_out': [
    'decisionId', 'assignmentId', 'reservedTaskKey', 'blockerId', 'owner', 'deadline',
    'allowedSuccessors', 'reason',
  ],
  'local_execution.requested': [
    'operationId', 'requestDigest', 'agentDefinitionId', 'issuedAt', 'envelope',
  ],
  'remote_dispatch.requested': [
    'operationId', 'requestDigest', 'issuedAt', 'reconcileDeadline', 'envelope', 'dispatchItem',
  ],
  'clock.advanced': ['now'],
});

function assertAllowedPayloadKeys(
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
): void {
  const allowed = WORKROOM_EVENT_PAYLOAD_KEYS[type];
  if (Object.keys(payload).some(key => !allowed.includes(key))) {
    throw new Error(`Invalid Workroom event payload keys: ${type}`);
  }
}

function validatePayload(
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
  sequence: number,
): void {
  assertAllowedPayloadKeys(type, payload);
  switch (type) {
    case 'run.created':
      requirePayloadString(payload, 'projectId'); requirePayloadString(payload, 'title'); return;
    case 'run.control_decided':
      requirePayloadString(payload, 'operationId');
      requirePayloadEnum(payload, 'action', ['cancel', 'request_replan']);
      requirePayloadString(payload, 'reasonCode');
      if (payload.action === 'cancel'
        ? !isWorkroomRunCancelReasonCode(payload.reasonCode)
        : !isWorkroomRunReplanReasonCode(payload.reasonCode)) {
        throw new Error('Invalid Workroom event payload: Run control reasonCode');
      }
      if (!Number.isSafeInteger(payload.expectedSequence) || Number(payload.expectedSequence) < 0) {
        throw new Error('Invalid Workroom event payload: expectedSequence');
      }
      requirePayloadString(payload, 'principalId'); requirePayloadDigest(payload, 'requestDigest');
      requirePayloadString(payload, 'catalogRevision'); requirePayloadDigest(payload, 'projectDigest');
      requirePayloadString(payload, 'authorizationRef');
      if (!Number.isSafeInteger(payload.stateSequence) || Number(payload.stateSequence) < 0) {
        throw new Error('Invalid Workroom event payload: stateSequence');
      }
      requirePayloadEnum(payload, 'stateStatus', [
        'active', 'blocked', 'needs_replan', 'cancelling', 'completed', 'cancelled',
      ]);
      requirePayloadDigest(payload, 'stateDigest'); return;
    case 'run.replan_requested':
      requirePayloadString(payload, 'operationId'); requirePayloadString(payload, 'reasonCode');
      if (!isWorkroomRunReplanReasonCode(payload.reasonCode)) {
        throw new Error('Invalid Workroom event payload: replan reasonCode');
      }
      requirePayloadDigest(payload, 'requestDigest'); return;
    case 'plan.admitted':
      requirePayloadString(payload, 'operationId'); requirePayloadString(payload, 'sourceEventRef');
      requirePayloadDigest(payload, 'sourceEventDigest');
      requirePayloadString(payload, 'orchestratorAgentDefinitionId');
      assertWorkflowPlanProposal(requirePayloadRecord(payload, 'plan') as unknown as import('./workflow-plan-builder.js').WorkflowPlanProposal);
      if (payload.schedulerPolicy !== undefined) {
        assertWorkroomSchedulerPolicySnapshot(
          payload.schedulerPolicy as import('./workroom-scheduler.js').WorkroomSchedulerPolicySnapshot,
          sequence,
        );
      }
      return;
    case 'plan.revision_applied': {
      const candidate = requirePayloadRecord(payload, 'candidate') as unknown as import('./plan-revision.js').WorkflowPlanRevisionCandidate;
      assertWorkflowPlanRevisionCandidate(candidate);
      requirePayloadPositiveInteger(payload, 'planRevision');
      requirePayloadDigest(payload, 'recomputedDiffDigest');
      if (payload.recomputedDiffDigest !== digestCanonicalWorkroomValue(candidate.diff)) {
        throw new Error('Persisted Plan Revision recomputed diff digest is invalid');
      }
      return;
    }
    case 'plan_gate.decided':
      requirePayloadString(payload, 'operationId'); requirePayloadDigest(payload, 'requestDigest');
      requirePayloadString(payload, 'taskKey'); requirePayloadPositiveInteger(payload, 'taskRevision');
      requirePayloadString(payload, 'gateId'); requirePayloadDigest(payload, 'planDigest');
      requirePayloadString(payload, 'policyRevisionId'); requirePayloadDigest(payload, 'policyDigest');
      requirePayloadEnum(payload, 'decision', ['approve', 'reject', 'request_changes', 'cancel']);
      requirePayloadString(payload, 'sponsorPrincipalId'); requirePayloadString(payload, 'authorizedBy');
      requirePayloadDigest(payload, 'reasonDigest');
      return;
    case 'local_execution.requested':
      parseWorkroomLocalAssignmentIssuance(payload);
      return;
    case 'remote_dispatch.requested':
      parseWorkroomRemoteAssignmentIssuance(payload);
      return;
    case 'scheduler.dispatch_requested':
      parseWorkroomDispatchTaskDecision(payload); return;
    case 'scheduler.priority_changed':
      requirePayloadString(payload, 'proposalId'); requirePayloadDigest(payload, 'digest');
      requirePayloadString(payload, 'projectId'); requirePayloadString(payload, 'runId');
      requirePayloadString(payload, 'taskKey'); requirePayloadPositiveInteger(payload, 'taskRevision');
      requirePayloadEnum(payload, 'currentLane', ['urgent', 'high', 'normal', 'low']);
      requirePayloadEnum(payload, 'requestedLane', ['urgent', 'high', 'normal', 'low']);
      requirePayloadEnum(payload, 'authority', ['sponsor', 'orchestrator']);
      requirePayloadString(payload, 'principalId'); requirePayloadString(payload, 'authorityRef');
      requirePayloadString(payload, 'owner'); requirePayloadNumber(payload, 'deadline');
      requirePayloadString(payload, 'authorizedBy');
      parseWorkroomPriorityChangeProposal({
        version: payload.version,
        type: payload.type,
        proposalId: payload.proposalId,
        digest: payload.digest,
        projectId: payload.projectId,
        runId: payload.runId,
        taskKey: payload.taskKey,
        taskRevision: payload.taskRevision,
        expectedSequence: payload.expectedSequence,
        currentLane: payload.currentLane,
        requestedLane: payload.requestedLane,
        localRank: payload.localRank,
        principalId: payload.principalId,
        authority: payload.authority,
        authorityRef: payload.authorityRef,
        deadline: payload.deadline,
        owner: payload.owner,
        allowedSuccessors: payload.allowedSuccessors,
      });
      if (payload.authorizedBy !== payload.authorityRef) {
        throw new Error('Persisted Workroom priority authority proof is not exact');
      }
      return;
    case 'scheduler.preemption_requested':
      parseWorkroomPreemptionPrepareDecision(payload); return;
    case 'scheduler.preemption_checkpoint_acknowledged':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadDigest(payload, 'envelopeDigest'); requirePayloadString(payload, 'observationId');
      requirePayloadDigest(payload, 'observationDigest'); requirePayloadString(payload, 'checkpointRef');
      requirePayloadDigest(payload, 'checkpointDigest'); requirePayloadPositiveInteger(payload, 'assignmentAttempt');
      requirePayloadPositiveInteger(payload, 'assignmentFence'); requirePayloadPositiveInteger(payload, 'takeoverFence');
      if (payload.takeoverFence !== Number(payload.assignmentFence) + 1) {
        throw new Error('Invalid Workroom event payload: preemption takeover fence');
      }
      return;
    case 'scheduler.preemption_timed_out':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'reservedTaskKey'); requirePayloadString(payload, 'blockerId');
      requirePayloadString(payload, 'owner'); requirePayloadNumber(payload, 'deadline');
      requirePayloadString(payload, 'reason');
      if (canonicalWorkroomJson(payload.allowedSuccessors) !== canonicalWorkroomJson(['replan', 'cancel_run'])) {
        throw new Error('Invalid Workroom event payload: preemption timeout successors');
      }
      return;
    case 'run.cancel_requested':
    case 'run.cancelled':
      requirePayloadString(payload, 'reason'); return;
    case 'task.planned':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'title');
      requirePayloadBoolean(payload, 'required'); requirePayloadPositiveInteger(payload, 'maxAttempts');
      if (payload.approvalGate !== undefined) {
        const gate = requirePayloadRecord(payload, 'approvalGate');
        requirePayloadString(gate, 'id'); requirePayloadEnum(gate, 'kind', ['sponsor']);
        requirePayloadString(gate, 'owner'); requirePayloadPositiveInteger(gate, 'decisionTimeoutMs');
        requirePayloadString(gate, 'policyRevisionId'); requirePayloadDigest(gate, 'policyDigest');
        if (!Array.isArray(gate.allowedActions)
          || canonicalWorkroomJson(gate.allowedActions) !== canonicalWorkroomJson(['approve', 'reject', 'replan', 'cancel'])) {
          throw new Error('Invalid Workroom event payload: approvalGate allowedActions');
        }
      }
      return;
    case 'task.blocked':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'blockerId');
      requirePayloadEnum(payload, 'kind', ['dependency', 'approval', 'capability', 'external', 'human_input']);
      requirePayloadString(payload, 'owner'); requirePayloadString(payload, 'reason');
      requirePayloadNumber(payload, 'deadline'); return;
    case 'task.blocker_resolved':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'blockerId'); return;
    case 'task.cancel_requested':
    case 'task.cancelled':
    case 'task.failed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason'); return;
    case 'task.accepted':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reportRef');
      assertPersistedAcceptanceRecord(
        payload.record,
        String(payload.taskKey),
        String(payload.reportRef),
        sequence,
      ); return;
    case 'task.acceptance_pinned': {
      requirePayloadString(payload, 'taskKey');
      const contract = requirePayloadRecord(payload, 'contract');
      assertAcceptanceContract(
        contract as unknown as import('./acceptance-policy.js').WorkroomAcceptanceContract,
        String(payload.taskKey),
        Number(contract.taskRevision),
      );
      return;
    }
    case 'task.acceptance_blocked':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reportRef');
      requirePayloadString(payload, 'reason'); requirePayloadRecord(payload, 'evaluation'); return;
    case 'reviewer.assigned':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason');
      validateAcceptanceWait(requirePayloadRecord(payload, 'assignment'), String(payload.taskKey), true); return;
    case 'reviewer.expired':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId'); return;
    case 'reviewer.claimed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'reviewerPrincipalId'); requirePayloadString(payload, 'authorizedBy');
      requirePayloadRecord(payload, 'authorization'); return;
    case 'reviewer.verdict_recorded':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId');
      requirePayloadEnum(payload, 'outcome', ['passed', 'rework']);
      requirePayloadRecord(payload, 'verdict'); requirePayloadRecord(payload, 'authorization'); return;
    case 'sponsor_gate.opened':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason');
      validateAcceptanceWait(requirePayloadRecord(payload, 'gate'), String(payload.taskKey), false); return;
    case 'sponsor_gate.expired':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'gateId'); return;
    case 'sponsor_gate.decided':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'gateId');
      requirePayloadString(payload, 'sponsorPrincipalId'); requirePayloadString(payload, 'authorizedBy');
      requirePayloadString(payload, 'reason'); requirePayloadString(payload, 'candidateHash');
      requirePayloadEnum(payload, 'decision', ['approve', 'reject', 'request_changes', 'cancel']);
      requirePayloadRecord(payload, 'authorization'); return;
    case 'task.rework_requested':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason'); return;
    case 'task.revised':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'title');
      requirePayloadString(payload, 'reason'); requirePayloadPositiveInteger(payload, 'maxAttempts'); return;
    case 'task.plan_revised':
      requirePayloadString(payload, 'taskKey'); requirePayloadPositiveInteger(payload, 'expectedTaskRevision');
      requirePayloadPositiveInteger(payload, 'newTaskRevision'); requirePayloadString(payload, 'title');
      requirePayloadBoolean(payload, 'required'); requirePayloadPositiveInteger(payload, 'maxAttempts');
      requirePayloadString(payload, 'role'); requirePayloadString(payload, 'reason');
      return;
    case 'assignment.claimed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'owner'); requirePayloadEnum(payload, 'role', ['executor', 'reviewer', 'integration']);
      requirePayloadPositiveInteger(payload, 'taskRevision'); requirePayloadPositiveInteger(payload, 'attempt');
      requirePayloadPositiveInteger(payload, 'assignmentRevision'); requirePayloadPositiveInteger(payload, 'fence');
      requirePayloadDigest(payload, 'envelopeDigest');
      requirePayloadNumber(payload, 'leaseExpiresAt'); return;
    case 'assignment.started':
    case 'assignment.lease_expired':
      requirePayloadString(payload, 'assignmentId'); return;
    case 'assignment.progress':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'progress',
      ], type);
      validateProgress(requirePayloadRecord(payload, 'progress'));
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'progress',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
        progress: payload.progress,
      });
      return;
    case 'assignment.heartbeat':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest', 'leaseExpiresAt',
      ], type);
      requirePayloadNumber(payload, 'leaseExpiresAt');
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'heartbeat',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
      });
      return;
    case 'assignment.checkpointed':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest',
        'checkpointRef', 'checkpointDigest',
      ], type);
      requirePayloadString(payload, 'checkpointRef'); requirePayloadDigest(payload, 'checkpointDigest');
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'checkpoint',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
        checkpoint: { ref: payload.checkpointRef, digest: payload.checkpointDigest },
      });
      return;
    case 'assignment.checkpoint_requested':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadDigest(payload, 'envelopeDigest'); requirePayloadString(payload, 'reservedTaskKey');
      requirePayloadNumber(payload, 'requestedAt'); requirePayloadNumber(payload, 'deadline');
      requirePayloadPositiveInteger(payload, 'takeoverFence'); requirePayloadString(payload, 'owner');
      if (Number(payload.deadline) <= Number(payload.requestedAt)
        || canonicalWorkroomJson(payload.allowedSuccessors) !== canonicalWorkroomJson(['replan', 'cancel_run'])) {
        throw new Error('Invalid Workroom event payload: checkpoint request recovery metadata');
      }
      return;
    case 'assignment.preempted':
      requirePayloadString(payload, 'decisionId'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'checkpointRef'); requirePayloadDigest(payload, 'checkpointDigest');
      requirePayloadEnum(payload, 'outcome', ['interrupted']); return;
    case 'assignment.execution_completed':
      validateAssignmentObservationHeader(payload);
      assertExactPayloadKeys(payload, [
        'assignmentId', 'observationId', 'observationDigest', 'envelopeDigest',
        'reportRef', 'reportDigest', 'candidateRef', 'candidateHash',
        ...(payload.completionReceiptDigest === undefined
          ? []
          : ['completionReceiptDigest']),
      ], type);
      requirePayloadString(payload, 'reportRef'); requirePayloadDigest(payload, 'reportDigest');
      requirePayloadString(payload, 'candidateRef'); requirePayloadDigest(payload, 'candidateHash');
      if (payload.completionReceiptDigest !== undefined) {
        requirePayloadDigest(payload, 'completionReceiptDigest');
      }
      assertPersistedAssignmentObservationDigest(payload, {
        version: 1,
        type: 'execution_completed',
        observationId: payload.observationId,
        envelopeDigest: payload.envelopeDigest,
        completion: {
          report: { ref: payload.reportRef, digest: payload.reportDigest },
          candidate: { ref: payload.candidateRef, hash: payload.candidateHash },
          ...(payload.completionReceiptDigest === undefined
            ? {}
            : { completionReceiptDigest: payload.completionReceiptDigest }),
        },
      });
      return;
    case 'assignment.cancel_requested':
      requirePayloadString(payload, 'assignmentId'); requirePayloadNumber(payload, 'controlDeadline'); return;
    case 'assignment.cancelled':
      requirePayloadString(payload, 'assignmentId');
      requirePayloadEnum(payload, 'outcome', ['interrupted', 'committed', 'outcome_unknown']); return;
    case 'clock.advanced':
      requirePayloadNumber(payload, 'now'); return;
  }
}

function validateAssignmentObservationHeader(payload: Readonly<Record<string, unknown>>): void {
  requirePayloadString(payload, 'assignmentId');
  requirePayloadString(payload, 'observationId');
  requirePayloadDigest(payload, 'observationDigest');
  requirePayloadDigest(payload, 'envelopeDigest');
}

function assertPersistedAssignmentObservationDigest(
  payload: Readonly<Record<string, unknown>>,
  observation: Readonly<Record<string, unknown>>,
): void {
  if (digestCanonicalWorkroomValue(observation) !== payload.observationDigest) {
    throw new Error('Invalid Workroom event payload: observationDigest does not match body');
  }
}

function validateProgress(progress: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(progress);
  if (keys.some(key => !['summary', 'completedUnits', 'totalUnits'].includes(key))) {
    throw new Error('Invalid Workroom event payload: progress keys');
  }
  requirePayloadString(progress, 'summary');
  const completed = progress.completedUnits;
  const total = progress.totalUnits;
  if (completed !== undefined && (!Number.isSafeInteger(completed) || (completed as number) < 0)) {
    throw new Error('Invalid Workroom event payload: completedUnits');
  }
  if (total !== undefined && (!Number.isSafeInteger(total) || (total as number) < 1)) {
    throw new Error('Invalid Workroom event payload: totalUnits');
  }
  if (typeof completed === 'number' && typeof total === 'number' && completed > total) {
    throw new Error('Invalid Workroom event payload: completedUnits exceeds totalUnits');
  }
}

function assertExactPayloadKeys(
  payload: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  type: WorkroomEvent['type'],
): void {
  const actual = Object.keys(payload).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`Invalid Workroom event payload keys: ${type}`);
  }
}

function assertExactRecordKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${label} keys are invalid`);
  }
}

function validateAcceptanceWait(value: Record<string, unknown>, taskKey: string, reviewer: boolean): void {
  for (const key of ['id', 'taskKey', 'candidateHash', 'contractId', 'owner']) {
    requirePayloadString(value, key);
  }
  requirePayloadPositiveInteger(value, 'taskRevision');
  requirePayloadEnum(value, 'riskTier', ['low', 'medium', 'high', 'critical']);
  requirePayloadEnum(value, 'route', ['reviewer_required', 'sponsor_required', 'reviewer_then_sponsor']);
  if (value.taskKey !== taskKey) throw new Error('Invalid Workroom event payload: wait taskKey');
  requirePayloadNumber(value, 'deadline');
  requirePayloadEnum(value, 'status', ['open']);
  requirePayloadRecord(value, 'evaluation');
  const policy = requirePayloadRecord(value, 'policy');
  requirePayloadString(policy, 'id'); requirePayloadString(policy, 'digest');
  requirePayloadPositiveInteger(policy, 'revision');
  if (reviewer) requirePayloadString(value, 'producerPrincipalId');
  if (!Array.isArray(value.allowedActions) || value.allowedActions.length === 0
    || value.allowedActions.some(action => !isNonEmptyString(action)
      || !ACCEPTANCE_WAIT_ACTIONS.has(action))) {
    throw new Error('Invalid Workroom event payload: allowedActions');
  }
}

const ACCEPTANCE_WAIT_ACTIONS = new Set([
  'claim', 'submit_verdict', 'approve', 'reject', 'request_changes',
  'reassign', 'reopen', 'rebase', 'replan', 'cancel',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requirePayloadString(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (!isNonEmptyString(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadNumber(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (!isFiniteNumber(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadDigest(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (typeof payload[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(payload[key])) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}

function requirePayloadRecord(payload: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  if (!isRecord(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
  return payload[key];
}

function requirePayloadPositiveInteger(payload: Readonly<Record<string, unknown>>, key: string): void {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}

function requirePayloadBoolean(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (typeof payload[key] !== 'boolean') throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadEnum(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly string[],
): void {
  if (typeof payload[key] !== 'string' || !values.includes(payload[key])) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}
