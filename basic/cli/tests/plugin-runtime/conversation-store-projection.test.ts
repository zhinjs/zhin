import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StructuredDatabase } from '@zhin.js/database';
import { CONVERSATION_EVENT_MODEL, CONVERSATION_EVENT_QUERY_MODEL, CONVERSATION_CURSOR_MODEL,
  DatabaseConversationEventStore, conversationEventQueryFields, conversationRefKey, messageRefKey, type ConversationEvent, type ConversationRef } from '@zhin.js/im-contract';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { migrateConversationColumns } from '../../src/plugin-runtime/conversation-migration.js';

const scene: ConversationRef = { endpoint: { adapter: 'sandbox', id: 'bot\0percent%' }, kind: 'private', id: 'room' };
const resources: Array<{ host: ReturnType<typeof createDatabaseHost>; directory: string }> = [];
async function fixture(legacy = false) {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-message-projection-'));
  const host = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'history.sqlite') });
  resources.push({ host, directory });
  host.define('conversation_events', legacy ? Object.fromEntries(Object.entries(CONVERSATION_EVENT_MODEL)
    .filter(([key]) => !(key in CONVERSATION_EVENT_QUERY_MODEL))) : CONVERSATION_EVENT_MODEL);
  host.define('conversation_event_cursors', CONVERSATION_CURSOR_MODEL);
  await host.start();
  const raw = host.getRawDatabase() as StructuredDatabase;
  if (!legacy) await migrateConversationColumns(raw);
  const events = host.models.get('conversation_events')!;
  const store = new DatabaseConversationEventStore(events, host.models.get('conversation_event_cursors')!);
  return { host, raw, events, store };
}
afterEach(async () => {
  for (const { host, directory } of resources.splice(0)) { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});
function created(id: string): ConversationEvent {
  return { type: 'message.created', eventId: `create:${id}`, conversation: scene, timestamp: 1,
    message: { ref: { conversation: scene, id }, actor: { id: 'original' }, timestamp: 1, segments: [{ type: 'text', data: { text: id } }] } };
}
function updated(id: string, revision: number, body: string, suffix = ''): ConversationEvent {
  return { type: 'message.updated', eventId: `update:${id}:${revision}:${suffix}`, conversation: scene, timestamp: revision,
    message: { ref: { conversation: scene, id }, timestamp: revision, revision, segments: [{ type: 'text', data: { text: body } }] } };
}

it('uses the real production model wrapper for fixed-table, read-only grouped aggregates', async () => {
  const f = await fixture();
  await f.store.append(created('a')); await f.store.append(updated('a', 3, 'latest'));
  expect(typeof f.events.aggregate).toBe('function');
  expect(await f.events.aggregate!().max('id', 'latest').min('id', 'first').groupBy('message_key').where({ event_type: 'message.updated' }))
    .toMatchObject([{ latest: 2, first: 2 }]);
});

it('projects out-of-order and equal revisions before the first recall, preserving encoded identity and creation pagination', async () => {
  const f = await fixture();
  await f.store.append(created('a'));
  await f.store.append(updated('a', 3, 'winner'));
  await f.store.append(updated('a', 1, 'stale'));
  await f.store.append(updated('a', 3, 'same revision must not replace', 'tie'));
  await f.store.append({ type: 'message.recalled', eventId: 'recall:a', conversation: scene, timestamp: 5, message: { conversation: scene, id: 'a' } });
  await f.store.append(updated('a', 9, 'after recall'));
  await f.store.append(created('b'));
  expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject({ actor: { id: 'original' }, timestamp: 1,
    recalled: true, revision: 3, segments: [{ type: 'text', data: { text: 'winner' } }] });
  const page = await f.store.listMessages(scene, undefined, 1);
  expect(page.map(row => row.message.ref.id)).toEqual(['b']);
  expect((await f.store.listMessages(scene, page[0]!.sequence, 1))[0]).toMatchObject({ sequence: 1, message: { revision: 3, recalled: true } });
});

it('bounds fetched JSON bodies and query rounds by page identities rather than accumulated revisions', async () => {
  const f = await fixture();
  await f.store.append(created('a')); await f.store.append(created('b'));
  for (let revision = 1; revision <= 100; revision++) await f.store.append(updated('a', revision, `body ${revision}`));
  const query = f.raw.query.bind(f.raw), reads: number[] = [], statements: string[] = [];
  vi.spyOn(f.raw, 'query').mockImplementation(async (sql, params) => {
    const rows = await query(sql, params);
    statements.push(String(sql));
    if (String(sql).startsWith('SELECT') && String(sql).includes('"event_json"')) reads.push(Array.isArray(rows) ? rows.length : 0);
    return rows;
  });
  const page = await f.store.listMessages(scene, undefined, 2);
  expect(page.map(row => row.message.ref.id)).toEqual(['a', 'b']);
  expect(page[0]!.message.revision).toBe(100);
  expect(reads.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(8);
  expect(statements.length).toBeLessThanOrEqual(12);
});

it('idempotently rebuilds indexes from a real old SQLite table without changing stored event JSON', async () => {
  const f = await fixture(true);
  const creation = created('a'), recall: ConversationEvent = { type: 'message.recalled', eventId: 'legacy-recall',
    conversation: scene, timestamp: 3, message: { conversation: scene, id: 'a' } };
  for (const event of [creation, updated('a', 2, 'before recall'), recall]) await f.events.insert({
    event_id: event.eventId, conversation_key: conversationRefKey(scene), message_key: event.type === 'message.recalled' ? '' : messageRefKey(event.message.ref),
    event_json: JSON.stringify(event), time: event.timestamp,
  });
  const before = await f.events.select('id', 'event_json');
  await migrateConversationColumns(f.raw); await migrateConversationColumns(f.raw);
  expect(await f.events.select('id', 'event_json')).toEqual(before);
  expect(await f.events.select('message_key', 'message_revision').where({ event_id: 'legacy-recall' }))
    .toEqual([{ message_key: 'k1:sandbox%00bot%00percent%25%00private%00room%00%00%00%00a', message_revision: 0 }]);
  expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject({ recalled: true, revision: 2 });
  expect(await f.raw.query('PRAGMA index_list("conversation_events")')).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'conversation_events_message_revision' }), expect.objectContaining({ name: 'conversation_events_message_sequence' }),
  ]));
});

it('uses the earliest recall across encoded and legacy key aliases before selecting the greatest revision', async () => {
  const f = await fixture();
  await f.store.append(created('a'));
  const legacy = async (event: ConversationEvent) => f.events.insert({ ...conversationEventQueryFields(event),
    event_id: event.eventId, conversation_key: conversationRefKey(scene), message_key: messageRefKey({ conversation: scene, id: 'a' }),
    event_json: JSON.stringify(event), time: event.timestamp });
  await legacy(updated('a', 4, 'legacy winner'));
  await f.store.append(updated('a', 2, 'encoded stale'));
  await f.store.append({ type: 'message.recalled', eventId: 'encoded-recall', conversation: scene, timestamp: 5, message: { conversation: scene, id: 'a' } });
  await legacy(updated('a', 8, 'legacy post-recall update'));
  expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject({ recalled: true, revision: 4,
    segments: [{ type: 'text', data: { text: 'legacy winner' } }] });
});

it('uses one read high-water mark when recall and a newer update arrive between projection queries', async () => {
  const f = await fixture();
  await f.store.append(created('a')); await f.store.append(updated('a', 1, 'before recall'));
  const query = f.raw.query.bind(f.raw);
  let inject = true;
  vi.spyOn(f.raw, 'query').mockImplementation(async (sql, params) => {
    const rows = await query(sql, params);
    if (inject && String(sql).includes('MIN(') && String(sql).includes('GROUP BY')) {
      inject = false;
      await f.store.append({ type: 'message.recalled', eventId: 'racing-recall', conversation: scene, timestamp: 3, message: { conversation: scene, id: 'a' } });
      await f.store.append(updated('a', 9, 'must not revive'));
    }
    return rows;
  });
  expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject({ revision: 1,
    segments: [{ type: 'text', data: { text: 'before recall' } }] });
  expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject({ recalled: true, revision: 1 });
});

it.each(['encoded-update', 'legacy-key-update', 'empty-key-recall'] as const)(
  'reads committed old-version writes after migration without requiring another migration (%s)', async mode => {
    const f = await fixture();
    await f.store.append(created('a')); await f.store.append(updated('a', 2, 'current indexed body'));
    const [identity] = await f.events.select('conversation_key', 'message_key').where({ event_type: 'message.created' });
    const old: ConversationEvent = mode === 'empty-key-recall'
      ? { type: 'message.recalled', eventId: 'old-recall-after-migration', conversation: scene, timestamp: 3, message: { conversation: scene, id: 'a' } }
      : updated('a', 5, 'old writer latest body');
    const { message_revision: _revision, ...oldFields } = conversationEventQueryFields(old);
    await f.events.insert({ ...oldFields, event_id: old.eventId, conversation_key: identity!.conversation_key,
      message_key: mode === 'empty-key-recall' ? '' : mode === 'legacy-key-update' ? messageRefKey({ conversation: scene, id: 'a' }) : identity!.message_key,
      event_json: JSON.stringify(old), time: old.timestamp });
    if (mode === 'empty-key-recall') await f.store.append(updated('a', 9, 'must not revive'));
    const expected = mode === 'empty-key-recall'
      ? { recalled: true, revision: 2, segments: [{ type: 'text', data: { text: 'current indexed body' } }] }
      : { revision: 5, segments: [{ type: 'text', data: { text: 'old writer latest body' } }] };
    expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject(expected);
    expect((await f.store.listMessages(scene, undefined, 50))[0]!.message).toMatchObject(expected);
    expect((await f.events.select('message_revision').where({ event_id: old.eventId }))[0]!.message_revision).toBeNull();
  },
);

it('surfaces NULL-metadata probe failures instead of treating them as indexed absence', async () => {
  const f = await fixture(); await f.store.append(created('a'));
  const query = f.raw.query.bind(f.raw);
  vi.spyOn(f.raw, 'query').mockImplementation(async (sql, params) => {
    if (String(sql).includes('"message_revision" IS NULL')) throw new Error('synthetic metadata lookup failure');
    return query(sql, params);
  });
  await expect(f.store.getMessage({ conversation: scene, id: 'a' })).rejects.toThrow('synthetic metadata lookup failure');
});

it('defers an old-version write arriving after the probe to the next bounded read', async () => {
  const f = await fixture(); await f.store.append(created('a')); await f.store.append(updated('a', 1, 'indexed'));
  const [identity] = await f.events.select('conversation_key', 'message_key').where({ event_type: 'message.created' });
  const query = f.raw.query.bind(f.raw); let inject = true;
  vi.spyOn(f.raw, 'query').mockImplementation(async (sql, params) => {
    const rows = await query(sql, params);
    if (inject && String(sql).includes('"message_revision" IS NULL')) {
      inject = false;
      const old = updated('a', 5, 'old writer');
      const { message_revision: _revision, ...fields } = conversationEventQueryFields(old);
      await f.events.insert({ ...fields, event_id: old.eventId, conversation_key: identity!.conversation_key,
        message_key: identity!.message_key, event_json: JSON.stringify(old), time: old.timestamp });
    }
    return rows;
  });
  expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject({ revision: 1 });
  expect(inject).toBe(false);
  expect(await f.store.getMessage({ conversation: scene, id: 'a' })).toMatchObject({ revision: 5 });
});

it('seeks past each completed backfill batch and starts fresh on repeated migrations', async () => {
  const f = await fixture(true);
  for (let index = 0; index < 405; index++) {
    const event = created(`old-${index}`);
    await f.events.insert({ id: index * 3 + 1, event_id: event.eventId, conversation_key: conversationRefKey(scene),
      message_key: '', event_json: JSON.stringify(event), time: event.timestamp });
  }
  const before = await f.events.select('id', 'event_json').orderBy('id');
  const query = f.raw.query.bind(f.raw), batches: number[][] = [], plans: string[][] = [];
  const statements = vi.spyOn(f.raw, 'query').mockImplementation(async (sql, params) => {
    const rows = await query(sql, params);
    if (String(sql).startsWith('SELECT') && String(sql).includes('"event_json"') && String(sql).includes('"message_revision" IS NULL')) {
      batches.push((rows as Record<string, unknown>[]).map(row => Number(row.id)));
      const plan = await query(`EXPLAIN QUERY PLAN ${sql}`, params) as Record<string, unknown>[];
      plans.push(plan.map(row => String(row.detail)));
    }
    return rows;
  });
  await migrateConversationColumns(f.raw);
  expect(batches.map(batch => batch.length)).toEqual([200, 200, 5, 0]);
  expect(batches.flat()).toEqual(before.map(row => row.id));
  expect(plans.slice(1).every(plan => plan.some(detail => /SEARCH conversation_events USING INTEGER PRIMARY KEY \(rowid>\?\)/.test(detail)))).toBe(true);
  expect(await f.events.select('id', 'event_json').orderBy('id')).toEqual(before);
  expect((await f.events.select('message_revision', 'query_version')).every(row => row.message_revision === 0 && row.query_version === 1)).toBe(true);
  batches.length = 0; plans.length = 0; statements.mockClear();
  await migrateConversationColumns(f.raw);
  expect(batches).toEqual([[]]);
  expect(statements.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE'))).toBe(false);
  // A later migration must revisit an earlier identity whose derived metadata needs rebuilding.
  await f.events.update({ message_revision: null }).where({ id: before[0]!.id });
  batches.length = 0;
  await migrateConversationColumns(f.raw);
  expect(batches).toEqual([[before[0]!.id], []]);
  expect(await f.events.select('id', 'event_json').orderBy('id')).toEqual(before);
});
