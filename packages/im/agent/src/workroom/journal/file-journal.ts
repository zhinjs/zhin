import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { WorkroomEvent, WorkroomEventDraft } from '../kernel-contracts.js';
import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from '../canonical-value.js';
import { DurableFileStore } from '../durable-file-store.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../../data-governance/governed-payload-write-saga.js';
import {
  FileLegacyEmbeddedPayloadReadAdapter,
  assertActiveStoreHasNoLegacyEmbeddedPayload,
} from '../legacy-embedded-payload-migration.js';
import {
  WorkroomJournalPayloadAuthorityUnavailableError,
  WorkroomSequenceConflictError,
  type StoredWorkroomEvent,
  type WorkroomJournal,
  type WorkroomJournalPayloadPort,
  type WorkroomStoredRunHeaders,
} from './contracts.js';
import {
  isMissingFile,
  isSegmentName,
  isSegmentTemporaryName,
  materializeEvents,
  parseStoredEvents,
  segmentFirstSequence,
  storedRunHeaders,
} from './event-codec.js';
import { isNonEmptyString, isRecord } from './event-validation.js';
import { legacyJournalPayloadError } from './payload-reference.js';
import {
  collectGovernedPayloadReceipts,
  journalPublicationDigest,
  materializeStoredEvents,
  projectIdForAppend,
  protectEvents,
  reconcileJournalPayloads,
  verifyJournalPayloadPublication,
} from './payload-governance.js';

interface FileWorkroomJournalSegmentPayload {
  readonly version: 3;
  readonly runId: string;
  readonly expectedSequence: number;
  readonly events: readonly StoredWorkroomEvent[];
}

interface FileWorkroomJournalSegment extends FileWorkroomJournalSegmentPayload {
  readonly payloadDigest: string;
}


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
