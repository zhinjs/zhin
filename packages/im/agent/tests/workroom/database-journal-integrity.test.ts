import { describe, expect, it } from 'vitest';
import type { AIConfig } from '@zhin.js/ai';
import {
  ActivatableWorkroomJournal,
  DatabaseWorkroomJournal,
  MemoryWorkroomJournalPayloadPort,
  digestStoredWorkroomEvent,
  digestWorkroomEventRowBinding,
} from '../../src/workroom/journal.js';
import { WORKROOM_EVENT_MODEL } from '../../src/workroom/journal-model.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { activateAiDatabaseStorage } from '../../src/init/activate-ai-database-storage.js';
import { ActivatableWorkroomCatalog } from '../../src/workroom/catalog.js';
import type { AIServiceRefs } from '../../src/internal/ai-service-refs.js';

describe('Database Workroom Journal row integrity', () => {
  it('persists and revalidates canonical event and row-binding digests after restart', async () => {
    const fixture = await databaseFixture();
    expect(WORKROOM_EVENT_MODEL).toHaveProperty('stored_event_digest');
    expect(WORKROOM_EVENT_MODEL).toHaveProperty('row_binding_digest');
    expect(fixture.rows.every(row => typeof row.stored_event_digest === 'string')).toBe(true);
    expect(fixture.rows.every(row => typeof row.row_binding_digest === 'string')).toBe(true);

    const restarted = fixture.journal();
    await expect(restarted.scanStoredHeaders()).resolves.toHaveLength(1);
    await expect(new WorkroomKernel({ journal: restarted }).read('support', 'run-db-integrity'))
      .resolves.toMatchObject({ projectId: 'support', sequence: 1 });
  });

  it('rejects valid JSON tampering both without resigning and with only the event digest recomputed', async () => {
    const unsigned = await databaseFixture();
    rewriteEnvelope(unsigned.rows[0]!, envelope => {
      envelope.eventId = 'forged-event-id';
    });
    await expect(unsigned.journal().scanStoredHeaders()).rejects.toThrow('stored event digest');

    const partiallyResigned = await databaseFixture();
    rewriteEnvelope(partiallyResigned.rows[0]!, envelope => {
      (envelope.payload as Record<string, unknown>).projectId = 'another-project';
    });
    partiallyResigned.rows[0]!.stored_event_digest = eventDigestForRow(partiallyResigned.rows[0]!);
    await expect(partiallyResigned.journal().scanStoredHeaders()).rejects.toThrow('row binding digest');

    await expect(unsigned.journal().append('unrelated-run', -1, [{
      eventId: 'unrelated-created', occurredAt: 200, type: 'run.created',
      payload: { projectId: 'unrelated', title: 'must not append over corrupt store' },
    }])).rejects.toThrow('stored event digest');
    expect(unsigned.rows).toHaveLength(2);
  });

  it('rejects row swaps and fully re-digested forged governed receipt bindings', async () => {
    const swapped = await databaseFixture();
    [swapped.rows[0]!.id, swapped.rows[1]!.id] = [swapped.rows[1]!.id, swapped.rows[0]!.id];
    await expect(swapped.journal().scanStoredHeaders()).rejects.toThrow('row id binding');

    const fullyResignedEvent = await databaseFixture();
    rewriteEnvelope(fullyResignedEvent.rows[0]!, envelope => {
      envelope.eventId = 'fully-resigned-forged-event';
    });
    fullyResignedEvent.rows[0]!.stored_event_digest = eventDigestForRow(fullyResignedEvent.rows[0]!);
    fullyResignedEvent.rows[0]!.row_binding_digest =
      digestWorkroomEventRowBinding(fullyResignedEvent.rows[0]!);
    await expect(fullyResignedEvent.journal().scanStoredHeaders())
      .rejects.toThrow('receipt is forged or incomplete');

    const forgedReceipt = await databaseFixture();
    rewriteEnvelope(forgedReceipt.rows[0]!, envelope => {
      const title = (envelope.payload as Record<string, unknown>).title as {
        receipt: { source: { ref: string } };
      };
      title.receipt.source.ref = 'forged-source-ref';
    });
    forgedReceipt.rows[0]!.stored_event_digest = eventDigestForRow(forgedReceipt.rows[0]!);
    forgedReceipt.rows[0]!.row_binding_digest = digestWorkroomEventRowBinding(forgedReceipt.rows[0]!);
    await expect(forgedReceipt.journal().scanStoredHeaders())
      .rejects.toThrow('receipt is forged or incomplete');
  });

  it('quarantines old v2 rows without digests and refuses Database activation', async () => {
    const fixture = await databaseFixture();
    delete fixture.rows[0]!.stored_event_digest;
    delete fixture.rows[0]!.row_binding_digest;
    await expect(fixture.journal().readStoredHeaders('run-db-integrity'))
      .rejects.toThrow('offline export/purge');

    const journal = new ActivatableWorkroomJournal();
    const catalog = new ActivatableWorkroomCatalog();
    const db = {
      models: new Map<string, unknown>([
        ['workroom_events', fixture.model],
        ['workroom_catalog', { select: () => ({ where: async () => [] }) }],
      ]),
      transaction: fixture.database.transaction,
    };
    const refs = {
      zhinAgent: { configure: () => undefined },
    } as unknown as AIServiceRefs;
    await expect(activateAiDatabaseStorage(
      db,
      refs,
      { sessions: { useDatabase: true } } as AIConfig,
      journal,
      fixture.payloads,
      catalog,
      null,
    )).rejects.toThrow('offline export/purge');
    expect(journal.active).toBe(false);
  });
});

async function databaseFixture() {
  const rows: Record<string, unknown>[] = [];
  const where = async (condition: Record<string, unknown>) => condition.run_id === undefined
    ? [...rows]
    : rows.filter(row => row.run_id === condition.run_id);
  const database = {
    transaction: async <T>(operation: (transaction: {
      select(table: string): { where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]> };
      insertMany(table: string, inserted: Record<string, unknown>[]): Promise<void>;
    }) => Promise<T>) => await operation({
      select: () => ({ where }),
      insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
        rows.push(...inserted.map(row => ({ ...row })));
      },
    }),
  };
  const model = { select: () => ({ where }) };
  const payloads = new MemoryWorkroomJournalPayloadPort();
  const journal = () => new DatabaseWorkroomJournal(database, model, payloads);
  const kernel = new WorkroomKernel({ journal: journal(), now: () => 100, createId: (() => {
    let id = 0; return () => `db-integrity-${++id}`;
  })() });
  await kernel.createRun({ runId: 'run-db-integrity', projectId: 'support', title: 'private title' });
  await kernel.execute('support', 'run-db-integrity', {
    type: 'plan_task', taskKey: 'triage', title: 'private task', required: true, maxAttempts: 2,
  });
  return { rows, database, model, payloads, journal };
}

function rewriteEnvelope(
  row: Record<string, unknown>,
  mutate: (envelope: { eventId: string; control: Readonly<Record<string, unknown>>; payload: unknown }) => void,
): void {
  const envelope = JSON.parse(String(row.payload_json)) as {
    eventId: string; control: Readonly<Record<string, unknown>>; payload: unknown;
  };
  mutate(envelope);
  row.payload_json = JSON.stringify(envelope);
}

function eventDigestForRow(row: Record<string, unknown>): string {
  const envelope = JSON.parse(String(row.payload_json)) as {
    eventId: string; control: Readonly<Record<string, unknown>>;
    payload: Readonly<Record<string, unknown>>;
  };
  return digestStoredWorkroomEvent({
    version: 3,
    eventId: envelope.eventId,
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    occurredAt: Number(row.occurred_at),
    type: row.type as never,
    control: envelope.control,
    payload: envelope.payload,
  });
}
