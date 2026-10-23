import { createReminderState } from '../../../../plugins/utils/reminder/src/storage.js';
import { ADMIN_REMINDER_STATE_KEY } from '../../../../plugins/utils/reminder/src/admin-tasks.js';
import { createAdministratorRssState } from '../../../../plugins/utils/rss/src/storage.js';
import { ADMIN_RSS_STATE_KEY } from '../../../../plugins/utils/rss/src/admin-tasks.js';
import { CONVERSATION_EVENT_MODEL, CONVERSATION_EVENT_QUERY_MODEL, CONVERSATION_CURSOR_MODEL, DatabaseConversationEventStore, type ConversationEvent } from '@zhin.js/im-contract';
import { INBOX_MESSAGE_QUERY_COLUMNS, INBOX_MESSAGE_DEFINITION, INBOX_TABLE_MESSAGE } from '@zhin.js/plugin-runtime';
import { migrateConversationColumns, migrateInboxColumns } from '../../src/plugin-runtime/conversation-migration.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childPluginId, rootPluginId, PluginDatabaseHost, createRelationalStateStore, type RelationalStateCodec, type DatabaseHostModel } from '@zhin.js/plugin-runtime';
import { AGENT_USAGE_TURN_MODEL, AGENT_USAGE_CALL_MODEL, DatabaseAgentUsageStore, AgentUsageCollector, DatabaseScheduleJobStorage, SCHEDULE_JOB_MODEL, SCHEDULE_JOB_MIGRATION_MODEL } from '@zhin.js/agent/runtime';
import type { TurnRequest } from '@zhin.js/agent';
import { ensureDatabaseColumns, ensureDatabaseIndex, type StructuredDatabase } from '@zhin.js/database';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';

type Book = { revision: number; items: readonly { id: string; state: string }[] };
const codec: RelationalStateCodec = {
  key: 'jobs/v1', header: { table: 'job_books', definition: { revision: { type: 'integer', nullable: true } } },
  tables: { jobs: { id: { type: 'text', primary: true }, state: { type: 'text' }, position: { type: 'integer' } } },
  encode(value) {
    const book = value as Book;
    return { header: { revision: book.revision }, rows: { jobs: book.items.map((item, position) => ({ ...item, position })) } };
  },
  decode(header, rows) { return { revision: Number(header.revision), items: rows.jobs!.map(row => ({ id: String(row.id), state: String(row.state) })) }; },
};

const dialects = ['sqlite', ...(process.env.ZHIN_TEST_STRUCTURED_SQL === '1' ? ['mysql', 'pg', 'mysql-single', 'pg-single'] : [])];
describe.each(dialects)('transactional relational state (%s)', mode => {
  const dialect = mode.split('-')[0]!;
  let directory: string;
  let host: ReturnType<typeof createDatabaseHost>;
  const owner = childPluginId(rootPluginId(), 'tasks');
  function createHost() {
    return createDatabaseHost(dialect === 'sqlite' ? { dialect, filename: join(directory, 'db.sqlite') } : {
      dialect, host: '127.0.0.1', port: Number(process.env[dialect === 'pg' ? 'ZHIN_TEST_PG_PORT' : 'ZHIN_TEST_MYSQL_PORT']),
      user: 'zhin', password: process.env[dialect === 'pg' ? 'ZHIN_TEST_PG_PASSWORD' : 'ZHIN_TEST_MYSQL_PASSWORD'] ?? 'zhin', database: 'zhin_test', ...(mode.endsWith('-single') ? {} : { pool: { max: 4 } }),
    });
  }
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhin-relational-')); host = createHost(); });
  afterEach(async () => {
    if (dialect !== 'sqlite' && host.started) {
      const raw = host.getRawDatabase() as StructuredDatabase;
      for (const table of host.tables()) await raw.query(`DROP TABLE IF EXISTS ${dialect === 'mysql' ? '`' + table + '`' : '"' + table + '"'}`);
    }
    await host.stop(); await rm(directory, { recursive: true, force: true });
  });

  it('migrates once, serializes concurrent CAS, survives restart without resurrecting deleted jobs', async () => {
    let database = new PluginDatabaseHost(owner, host);
    let store = createRelationalStateStore(database, [codec]);
    await host.start();
    await database.state.set(codec.key, { revision: 0, items: [{ id: 'one', state: 'unknown' }] });
    expect(await store.get(codec.key)).toEqual({ revision: 0, items: [{ id: 'one', state: 'unknown' }] });
    expect(await database.state.get(codec.key)).toBeUndefined();
    const second = createHost();
    const otherWriter = createRelationalStateStore(new PluginDatabaseHost(owner, second), [codec]);
    await second.start();
    try {
      await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? store : otherWriter).update<Book>(codec.key, old => ({ ...old!, revision: old!.revision + 1 }))));
    } finally { await second.stop(); }
    expect((await store.get<Book>(codec.key))?.revision).toBe(12);
    await store.delete(codec.key);
    await host.stop();
    host = createHost();
    database = new PluginDatabaseHost(owner, host);
    store = createRelationalStateStore(database, [codec]);
    await host.start();
    // Even an old backup value must not resurrect a deleted migrated book.
    await database.state.set(codec.key, { revision: 0, items: [{ id: 'old', state: 'pending' }] });
    expect(await store.get(codec.key)).toBeUndefined();
    expect(await database.models.get('jobs')!.select()).toEqual([]);
  });

  it('rolls back rows and revision together after a failed write', async () => {
    const database = new PluginDatabaseHost(owner, host);
    const store = createRelationalStateStore(database, [codec]);
    await host.start();
    const initial: Book = { revision: 1, items: [{ id: 'a', state: 'unknown' }] };
    await store.set(codec.key, initial);
    await expect(database.transaction(async transaction => {
      await transaction.model('jobs').delete().where({});
      await transaction.model('job_books').update({ revision: 2 }).where({ storage_id: 1 });
      throw new Error('injected failure');
    })).rejects.toThrow('injected failure');
    expect(await store.get(codec.key)).toEqual(initial);
  });

  it('isolates owners and disallows saved transaction models and queries after completion', async () => {
    const database = new PluginDatabaseHost(owner, host);
    const other = new PluginDatabaseHost(childPluginId(rootPluginId(), 'other'), host);
    const store = createRelationalStateStore(database, [codec]);
    const otherStore = createRelationalStateStore(other, [codec]);
    await host.start();
    await store.set(codec.key, { revision: 1, items: [{ id: 'a', state: 'unknown' }] });
    expect(await otherStore.get(codec.key)).toBeUndefined();
    let escaped!: DatabaseHostModel;
    let query: PromiseLike<unknown> | undefined;
    await database.transaction(async transaction => { escaped = transaction.model('jobs'); query = escaped.select(); });
    await expect(escaped.insert({ id: 'b', position: 0, state: 'pending' })).rejects.toThrow('closed');
    await expect(Promise.resolve(query)).rejects.toThrow('closed');
  });

  it('does not roll back an unrelated write queued on the same connection', async () => {
    const database = new PluginDatabaseHost(owner, host);
    createRelationalStateStore(database, [codec]);
    await host.start();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const transaction = database.transaction(async transaction => {
      await transaction.model('jobs').insert({ id: 'rolled-back', state: 'unknown', position: 0 });
      entered(); await barrier; throw new Error('rollback');
    });
    await ready;
    const outside = database.models.get('jobs')!.insert({ id: 'kept', state: 'unknown', position: 0 });
    release(); await expect(transaction).rejects.toThrow('rollback'); await outside;
    expect((await database.models.get('jobs')!.select()).map(row => row.id)).toEqual(['kept']);
  });
  it('migrates SQL columns/indexes and commits usage and scheduled jobs across connections', async () => {
    host.define('agent_usage_turns', AGENT_USAGE_TURN_MODEL); host.define('agent_usage_calls', AGENT_USAGE_CALL_MODEL);
    host.define('agent_schedule_jobs', SCHEDULE_JOB_MODEL); host.define('agent_schedule_migration', SCHEDULE_JOB_MIGRATION_MODEL);
    host.define('migration_probe', { id: { type: 'integer', primary: true } });
    await host.start();
    const raw = host.getRawDatabase() as StructuredDatabase;
    await ensureDatabaseColumns(raw, 'migration_probe', { source: { type: 'text', nullable: true } });
    await ensureDatabaseIndex(raw, 'migration_probe', 'migration_probe_source', [{ name: 'source', text: true }]);
    await ensureDatabaseIndex(raw, 'migration_probe', 'migration_probe_source', [{ name: 'source', text: true }]);
    const request = { identity: { turnId: 'turn', traceId: 'trace' }, session: { key: 'key' }, origin: { kind: 'internal', source: 'test' }, principal: { subjectId: 'user' } } as TurnRequest;
    const collector = new AgentUsageCollector('owner', request, { provider: 'p', model: 'm' });
    collector.record({ type: 'usage', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } });
    const record = collector.finish('completed');
    const usage = new DatabaseAgentUsageStore(host);
    await Promise.all([usage.save(record), usage.save(record)]);
    expect(await host.models.get('agent_usage_calls')!.select()).toHaveLength(1);
    const scheduler = new DatabaseScheduleJobStorage(host);
    await scheduler.activate(async () => ({ version: 1, jobs: [] }));
    const job = { id: 'job'.repeat(100), enabled: true, createdAt: 1, updatedAt: 1, schedule: { kind: 'every', everyMs: 60000 }, action: { kind: 'agent', prompt: 'text\0%' }, notify: { channel: 'silent' }, state: { retryCount: 0 } } as const;
    await scheduler.mutateJob(job.id, () => ({ job, result: undefined }));
    await Promise.all(Array.from({ length: 8 }, () => scheduler.mutateJob(job.id, current => ({ job: { ...current!, state: { retryCount: current!.state.retryCount! + 1 } }, result: undefined }))));
    expect(await scheduler.get(job.id)).toEqual({ ...job, state: { retryCount: 8 } });
  });

  it('migrates reminder/RSS claims, receipts and pending summaries losslessly into separate rows', async () => {
    const db = new PluginDatabaseHost(owner, host);
    const reminders = createReminderState(db), rss = createAdministratorRssState(db);
    await host.start();
    const target = { endpoint: { adapter: 'root/slack', id: 'root/slack\0bot' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'parent' }, threadId: 'thread' };
    const receipts = [{ id: 'operation', fingerprint: 'f', taskId: 'task', operation: 'create' }];
    const reminderBook = { version: 1, revision: 'v', receipts, tasks: [{ id: 'task', creation: 'f', target, text: 'hello\0%', state: 'unknown', createdAt: 1, nextRunAt: 2, intervalMs: null, claimId: 'claim', lastRunAt: null, detail: 'unknown\0%' }] };
    const rssBook = { version: 2, revision: 'r', receipts, tasks: [{ id: 'task', creation: 'f', version: 'v', target, url: 'https://test.invalid/rss', state: 'unknown', createdAt: 1, claimId: 'claim', lastCheckAt: 3, lastRunAt: null, detail: 'pending', seen: ['id\0%'], quiet: { timezone: 'UTC', start: '22:00', end: '08:00' }, pending: { from: 1, to: 3, count: 2, countCapped: true, items: [{ key: 'id\0%', title: 'title\0%', link: 'https://test.invalid/' }] } }] };
    await db.state.set(ADMIN_REMINDER_STATE_KEY, reminderBook); await db.state.set(ADMIN_RSS_STATE_KEY, rssBook);
    expect(await reminders.get(ADMIN_REMINDER_STATE_KEY)).toEqual(reminderBook);
    expect(await rss.get(ADMIN_RSS_STATE_KEY)).toEqual(rssBook);
    expect(await db.state.get(ADMIN_REMINDER_STATE_KEY)).toBeUndefined(); expect(await db.state.get(ADMIN_RSS_STATE_KEY)).toBeUndefined();
    expect(await db.models.get('admin_reminder_tasks')!.select()).toHaveLength(1);
    expect(await db.models.get('admin_rss_seen')!.select()).toHaveLength(1);
    expect(await db.models.get('admin_rss_pending_items')!.select()).toHaveLength(1);
    expect(await db.models.get('admin_rss_receipts')!.select()).toEqual([expect.objectContaining({ id: 'operation', task_id: 'task' })]);
  });

  it('backfills canonical message identities and inbox direction without changing replay data', async () => {
    const without = (model: Record<string, unknown>, added: Record<string, unknown>) => Object.fromEntries(Object.entries(model).filter(([key]) => !(key in added)));
    host.define('conversation_events', without(CONVERSATION_EVENT_MODEL, CONVERSATION_EVENT_QUERY_MODEL));
    host.define('conversation_event_cursors', CONVERSATION_CURSOR_MODEL);
    host.define(INBOX_TABLE_MESSAGE, without(INBOX_MESSAGE_DEFINITION, INBOX_MESSAGE_QUERY_COLUMNS));
    await host.start();
    const conversation = { endpoint: { adapter: 'slack', id: 'bot\0main' }, kind: 'channel' as const, id: 'room', parent: { kind: 'channel' as const, id: 'parent' }, threadId: 'thread' };
    const event: ConversationEvent = { type: 'message.created', eventId: 'event', conversation, timestamp: 1,
      message: { ref: { conversation, id: 'message' }, actor: { id: 'alice' }, segments: [{ type: 'text', data: { text: 'hello' } }], timestamp: 1 } };
    await host.models.get('conversation_events')!.insert({ event_id: 'event', conversation_key: 'old-key', message_key: 'old-message-key', event_json: JSON.stringify(event), time: 1 });
    await host.models.get(INBOX_TABLE_MESSAGE)!.insert({ adapter: 'slack', endpoint_id: 'main', platform_message_id: 'message', channel_id: 'room', channel_type: 'channel', sender_id: 'alice', sender_payload: '{}', content: 'hello', created_at: 1, raw: JSON.stringify({ $console: 'zhin.message-observation/1', direction: 'inbound', conversation }) });
    const raw = host.getRawDatabase() as StructuredDatabase;
    await migrateConversationColumns(raw); await migrateInboxColumns(raw);
    const row = (await host.models.get('conversation_events')!.select())[0]!;
    expect(row).toMatchObject({ event_json: JSON.stringify(event), conversation_key: 'old-key', endpoint_id: 'k1:bot%00main', parent_id: 'k1:parent', thread_id: 'k1:thread', actor_id: 'k1:alice' });
    expect((await host.models.get(INBOX_TABLE_MESSAGE)!.select())[0]).toMatchObject({ direction: 'inbound', thread_id: 'k1:thread', endpoint_capability_id: 'k1:bot%00main' });
    const events = new DatabaseConversationEventStore(host.models.get('conversation_events')! as never, host.models.get('conversation_event_cursors')! as never);
    const fresh = { ...event, eventId: 'new' };
    await events.append(fresh); expect(await events.getMessage(event.message.ref)).toEqual(event.message);
  });

});
