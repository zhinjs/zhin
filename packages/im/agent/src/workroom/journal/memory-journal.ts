import type { WorkroomEvent, WorkroomEventDraft } from '../kernel-contracts.js';
import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  digestCanonicalWorkroomValue,
} from '../canonical-value.js';
import type { WorkroomGovernedPayloadReceipt } from '../workroom-task-report-store.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../../data-governance/governed-payload-write-saga.js';
import {
  WorkroomSequenceConflictError,
  type StoredWorkroomEvent,
  type WorkroomJournal,
  type WorkroomJournalPayloadPort,
  type WorkroomJournalPayloadReadInput,
  type WorkroomJournalPayloadWriteInput,
  type WorkroomStoredRunHeaders,
} from './contracts.js';
import {
  materializeEvents,
  storedRunHeaders,
} from './event-codec.js';
import {
  createWorkroomJournalPayloadObjectId,
  materializeStoredEvents,
  projectIdForAppend,
  protectEvents,
  verifyJournalPayloadPublication,
} from './payload-governance.js';

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
