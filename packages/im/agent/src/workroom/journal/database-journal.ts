import type { WorkroomEvent, WorkroomEventDraft } from '../kernel-contracts.js';
import { deepFreezeWorkroomValue as deepFreeze } from '../canonical-value.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../../data-governance/governed-payload-write-saga.js';
import { assertActiveStoreHasNoLegacyEmbeddedPayload } from '../legacy-embedded-payload-migration.js';
import {
  WorkroomJournalPayloadAuthorityUnavailableError,
  WorkroomSequenceConflictError,
  type StoredWorkroomEvent,
  type WorkroomJournal,
  type WorkroomJournalPayloadPort,
  type WorkroomStoredRunHeaders,
} from './contracts.js';
import {
  legacyDatabaseJournalRecords,
  materializeEvents,
  parseStoredRowGroups,
  parseStoredRows,
  storedRunHeaders,
  toRow,
} from './event-codec.js';
import {
  collectGovernedPayloadReceipts,
  journalPublicationDigest,
  materializeStoredEvents,
  projectIdForAppend,
  protectEvents,
  reconcileJournalPayloads,
  verifyJournalPayloadPublication,
} from './payload-governance.js';

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
