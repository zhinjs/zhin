import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONVERSATION_CURSOR_MODEL,
  CONVERSATION_EVENT_MODEL,
  DatabaseConversationEventStore,
  messageRefKey,
  type ConversationEvent,
} from '@zhin.js/im-contract';
import {
  INBOX_TABLE_DEFINITIONS,
  INBOX_TABLE_MESSAGE,
  INBOX_TABLE_NOTICE,
  INBOX_TABLE_REQUEST,
} from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';

const live = process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1';

describe.skipIf(!live)('live PostgreSQL conversation store', () => {
  const config = {
    dialect: 'pg',
    host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
    user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
  } as const;
  const host = createDatabaseHost(config);

  beforeAll(async () => {
    const legacy = createDatabaseHost(config);
    try {
      await legacy.start();
      const legacyDb = legacy.getRawDatabase() as { query(sql: string): Promise<unknown> };
      await legacyDb.query('DROP TABLE IF EXISTS "zhin_live_conversation_events"');
      await legacyDb.query('DROP TABLE IF EXISTS "zhin_live_conversation_cursors"');
      await legacyDb.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_MESSAGE}"`);
      await legacyDb.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_REQUEST}"`);
      await legacyDb.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_NOTICE}"`);
      await legacyDb.query(`CREATE TABLE "zhin_live_conversation_events" (
      "id" INTEGER PRIMARY KEY,
      "event_id" TEXT NOT NULL UNIQUE,
      "conversation_key" TEXT NOT NULL,
      "message_key" TEXT DEFAULT '',
      "event_json" TEXT NOT NULL,
      "time" INTEGER NOT NULL
    )`);
      await legacyDb.query(`CREATE TABLE "zhin_live_conversation_cursors" (
      "id" INTEGER PRIMARY KEY,
      "cursor_key" TEXT NOT NULL UNIQUE,
      "sequence" INTEGER NOT NULL
    )`);
      await legacyDb.query(`CREATE TABLE "${INBOX_TABLE_MESSAGE}" (
      "id" INTEGER PRIMARY KEY,
      "created_at" INTEGER NOT NULL
    )`);
      await legacyDb.query(`CREATE TABLE "${INBOX_TABLE_REQUEST}" (
      "id" INTEGER PRIMARY KEY,
      "created_at" INTEGER NOT NULL,
      "resolved_at" INTEGER,
      "consumed_at" INTEGER
    )`);
      await legacyDb.query(`CREATE TABLE "${INBOX_TABLE_NOTICE}" (
      "id" INTEGER PRIMARY KEY,
      "created_at" INTEGER NOT NULL,
      "consumed_at" INTEGER
    )`);
    } finally {
      await legacy.stop();
    }

    host.define('zhin_live_conversation_events', CONVERSATION_EVENT_MODEL);
    host.define('zhin_live_conversation_cursors', CONVERSATION_CURSOR_MODEL);
    for (const [name, definition] of Object.entries(INBOX_TABLE_DEFINITIONS)) {
      host.define(name, definition);
    }
    await host.start();
    const db = host.getRawDatabase() as { query(sql: string): Promise<unknown> };
    const columns = await db.query(`SELECT column_name, data_type, is_identity
      FROM information_schema.columns
      WHERE table_name = 'zhin_live_conversation_events' AND column_name IN ('id', 'time')`) as Array<{
        column_name: string;
        data_type: string;
        is_identity: string;
      }>;
    expect(columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'id', is_identity: 'YES' }),
      expect.objectContaining({ column_name: 'time', data_type: 'bigint' }),
    ]));
  });

  afterAll(async () => {
    await host.stop();
    const cleanup = createDatabaseHost(config);
    try {
      await cleanup.start();
      const db = cleanup.getRawDatabase() as { query(sql: string): Promise<unknown> };
      await db.query('DROP TABLE IF EXISTS "zhin_live_conversation_events"');
      await db.query('DROP TABLE IF EXISTS "zhin_live_conversation_cursors"');
      await db.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_MESSAGE}"`);
      await db.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_REQUEST}"`);
      await db.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_NOTICE}"`);
    } finally {
      await cleanup.stop();
    }
  });

  it('migrates legacy inbox millisecond timestamps before the first write', async () => {
    const db = host.getRawDatabase() as { query(sql: string, params?: unknown[]): Promise<unknown> };
    const tables = [INBOX_TABLE_MESSAGE, INBOX_TABLE_REQUEST, INBOX_TABLE_NOTICE];
    const columns = await db.query(
      `SELECT table_name, column_name, data_type, is_identity
       FROM information_schema.columns
       WHERE table_name = ANY($1::text[])
         AND (column_name = 'id' OR column_name LIKE '%_at')`,
      [tables],
    ) as Array<{ table_name: string; column_name: string; data_type: string; is_identity: string }>;

    for (const table of tables) {
      expect(columns).toContainEqual(expect.objectContaining({
        table_name: table,
        column_name: 'id',
        is_identity: 'YES',
      }));
      expect(columns).toContainEqual(expect.objectContaining({
        table_name: table,
        column_name: 'created_at',
        data_type: 'bigint',
      }));
    }
    for (const row of columns.filter((column) => column.column_name.endsWith('_at'))) {
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe('bigint');
    }

    const timestamp = Date.now();
    for (const table of tables) {
      await expect(db.query(
        `INSERT INTO "${table}" ("created_at") VALUES ($1)`,
        [timestamp],
      )).resolves.toBeDefined();
    }
  });

  it('persists canonical NUL-delimited identities through PostgreSQL text columns', async () => {
    const events = host.models.get('zhin_live_conversation_events');
    const cursors = host.models.get('zhin_live_conversation_cursors');
    expect(events).toBeDefined();
    expect(cursors).toBeDefined();
    const store = new DatabaseConversationEventStore(events!, cursors!);
    const conversation = {
      endpoint: { id: 'main', adapter: 'icqq' },
      kind: 'group' as const,
      id: '10001',
    };
    const ref = { conversation, id: '20002' };
    const event: ConversationEvent = {
      eventId: `message:${messageRefKey(ref)}`,
      conversation,
      timestamp: Date.now(),
      type: 'message.created',
      message: {
        ref,
        actor: { id: '30003' },
        segments: [{ type: 'text', data: { text: '/hello' } }],
        timestamp: Date.now(),
      },
    };

    const appended = await store.append(event);
    expect(appended.appended).toBe(true);
    expect(appended.sequence).toBeGreaterThan(0);
    await expect(store.append(event)).resolves.toEqual({ appended: false, sequence: appended.sequence });
    await expect(store.getMessage(ref)).resolves.toEqual(event.message);
    await expect(store.listBetween(conversation, 0, appended.sequence, 10)).resolves.toEqual([
      { sequence: appended.sequence, event },
    ]);
    await expect(store.commitCursor('agent:main', conversation, appended.sequence)).resolves.toBeUndefined();
    await expect(store.getCursor('agent:main', conversation)).resolves.toBe(appended.sequence);
  });
});
