import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONVERSATION_CURSOR_MODEL,
  CONVERSATION_EVENT_MODEL,
  CONVERSATION_EVENT_QUERY_MODEL,
  conversationEventQueryFields,
  DatabaseConversationEventStore,
  messageRefKey,
  type ConversationEvent,
} from '@zhin.js/im-contract';
import {
  INBOX_TABLE_DEFINITIONS,
  INBOX_TABLE_MESSAGE,
  INBOX_TABLE_NOTICE,
  INBOX_TABLE_REQUEST,
  insertInboxRow,
} from '@zhin.js/plugin-runtime';
import type { StructuredDatabase } from '@zhin.js/database';
import { migrateConversationColumns, migrateInboxColumns } from '../../src/plugin-runtime/conversation-migration.js';
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
  const legacyConversation = {
    endpoint: { adapter: 'icqq', id: 'main\0legacy' },
    kind: 'group' as const,
    id: 'legacy-group',
    threadId: 'legacy\0thread',
  };
  const legacyEvent: ConversationEvent = {
    type: 'message.created', eventId: 'legacy-message', conversation: legacyConversation, timestamp: 1,
    message: {
      ref: { conversation: legacyConversation, id: 'old-message' }, actor: { id: 'old-user' },
      segments: [{ type: 'text', data: { text: 'preserve old content' } }], timestamp: 1,
    },
  };

  beforeAll(async () => {
    const legacy = createDatabaseHost(config);
    try {
      await legacy.start();
      const legacyDb = legacy.getRawDatabase() as { query(sql: string, params?: unknown[]): Promise<unknown> };
      await legacyDb.query('DROP TABLE IF EXISTS "conversation_events"');
      await legacyDb.query('DROP TABLE IF EXISTS "conversation_event_cursors"');
      await legacyDb.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_MESSAGE}"`);
      await legacyDb.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_REQUEST}"`);
      await legacyDb.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_NOTICE}"`);
      await legacyDb.query(`CREATE TABLE "conversation_events" (
      "id" INTEGER PRIMARY KEY,
      "event_id" TEXT NOT NULL UNIQUE,
      "conversation_key" TEXT NOT NULL,
      "message_key" TEXT DEFAULT '',
      "event_json" TEXT NOT NULL,
      "time" INTEGER NOT NULL
    )`);
      await legacyDb.query(`INSERT INTO "conversation_events"
        ("id", "event_id", "conversation_key", "message_key", "event_json", "time")
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [1, legacyEvent.eventId, 'legacy-conversation-key', 'legacy-message-key', JSON.stringify(legacyEvent), 1]);
      await legacyDb.query(`CREATE TABLE "conversation_event_cursors" (
      "id" INTEGER PRIMARY KEY,
      "cursor_key" TEXT NOT NULL UNIQUE,
      "sequence" INTEGER NOT NULL
    )`);
      await legacyDb.query(`CREATE TABLE "${INBOX_TABLE_MESSAGE}" (
      "id" INTEGER PRIMARY KEY,
      "adapter" TEXT NOT NULL,
      "endpoint_id" TEXT NOT NULL,
      "platform_message_id" TEXT NOT NULL,
      "channel_id" TEXT NOT NULL,
      "channel_type" TEXT NOT NULL,
      "channel_name" TEXT,
      "channel_parent_type" TEXT,
      "channel_parent_id" TEXT,
      "sender_id" TEXT NOT NULL,
      "sender_name" TEXT,
      "sender_payload" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "raw" TEXT,
      "created_at" INTEGER NOT NULL
    )`);
      await legacyDb.query(`CREATE TABLE "${INBOX_TABLE_REQUEST}" (
      "id" INTEGER PRIMARY KEY,
      "adapter" TEXT NOT NULL,
      "endpoint_id" TEXT NOT NULL,
      "platform_request_id" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "scene_type" TEXT,
      "scene_id" TEXT NOT NULL,
      "sub_type" TEXT,
      "actor_id" TEXT NOT NULL,
      "actor_name" TEXT,
      "comment" TEXT,
      "created_at" INTEGER NOT NULL,
      "resolved" INTEGER NOT NULL DEFAULT 0,
      "resolved_at" INTEGER,
      "consumed" INTEGER NOT NULL DEFAULT 0,
      "consumed_at" INTEGER
    )`);
      await legacyDb.query(`CREATE TABLE "${INBOX_TABLE_NOTICE}" (
      "id" INTEGER PRIMARY KEY,
      "adapter" TEXT NOT NULL,
      "endpoint_id" TEXT NOT NULL,
      "platform_notice_id" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "scene_type" TEXT,
      "scene_id" TEXT NOT NULL,
      "sub_type" TEXT,
      "actor_id" TEXT,
      "actor_name" TEXT,
      "target_id" TEXT,
      "target_name" TEXT,
      "payload" TEXT NOT NULL,
      "created_at" INTEGER NOT NULL,
      "consumed" INTEGER NOT NULL DEFAULT 0,
      "consumed_at" INTEGER
    )`);
    } finally {
      await legacy.stop();
    }

    host.define('conversation_events', CONVERSATION_EVENT_MODEL);
    host.define('conversation_event_cursors', CONVERSATION_CURSOR_MODEL);
    for (const [name, definition] of Object.entries(INBOX_TABLE_DEFINITIONS)) {
      host.define(name, definition);
    }
    await host.start();
    // 与 Runtime 启动顺序一致：安装持久化读写端口前，先补列并回填旧数据。
    const database = host.getRawDatabase() as StructuredDatabase;
    await migrateConversationColumns(database);
    await migrateInboxColumns(database);
    const db = host.getRawDatabase() as { query(sql: string): Promise<unknown> };
    const columns = await db.query(`SELECT column_name, data_type, is_identity
      FROM information_schema.columns
      WHERE table_name = 'conversation_events' AND column_name IN ('id', 'time')`) as Array<{
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
      await db.query('DROP TABLE IF EXISTS "conversation_events"');
      await db.query('DROP TABLE IF EXISTS "conversation_event_cursors"');
      await db.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_MESSAGE}"`);
      await db.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_REQUEST}"`);
      await db.query(`DROP TABLE IF EXISTS "${INBOX_TABLE_NOTICE}"`);
    } finally {
      await cleanup.stop();
    }
  });

  it('backfills structured conversation fields without changing legacy replay data', async () => {
    const db = host.getRawDatabase() as StructuredDatabase;
    const events = host.models.get('conversation_events')!;
    const [before] = await events.select('id', 'event_id', 'conversation_key', 'message_key', 'event_json', 'time',
      ...Object.keys(CONVERSATION_EVENT_QUERY_MODEL)).where({ event_id: legacyEvent.eventId });
    expect(before).toMatchObject({
      id: 1, event_id: legacyEvent.eventId, conversation_key: 'legacy-conversation-key',
      message_key: 'legacy-message-key', event_json: JSON.stringify(legacyEvent),
      ...conversationEventQueryFields(legacyEvent),
    });
    expect(Number(before!.time)).toBe(1);
    await migrateConversationColumns(db);
    const [after] = await events.select('id', 'event_id', 'conversation_key', 'message_key', 'event_json', 'time',
      ...Object.keys(CONVERSATION_EVENT_QUERY_MODEL)).where({ event_id: legacyEvent.eventId });
    expect(after).toEqual(before);
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
    await expect(insertInboxRow(host, INBOX_TABLE_MESSAGE, {
      adapter: 'icqq',
      endpoint_id: 'bot',
      platform_message_id: 'message-1',
      channel_id: 'group-1',
      channel_type: 'group',
      channel_name: null,
      channel_parent_type: null,
      channel_parent_id: null,
      sender_id: 'user-1',
      sender_name: 'Alice',
      sender_payload: '{}',
      content: 'hello',
      raw: null,
      created_at: timestamp,
    })).resolves.toBe(true);
    await expect(insertInboxRow(host, INBOX_TABLE_REQUEST, {
      adapter: 'icqq',
      endpoint_id: 'bot',
      platform_request_id: 'request-1',
      type: 'friend',
      scene_type: 'private',
      scene_id: 'user-1',
      sub_type: null,
      actor_id: 'user-1',
      actor_name: 'Alice',
      comment: null,
      created_at: timestamp,
      resolved: 0,
      resolved_at: null,
      consumed: 0,
      consumed_at: null,
    })).resolves.toBe(true);
    await expect(insertInboxRow(host, INBOX_TABLE_NOTICE, {
      adapter: 'icqq',
      endpoint_id: 'bot',
      platform_notice_id: 'notice-1',
      type: 'member_increase',
      scene_type: 'group',
      scene_id: 'group-1',
      sub_type: null,
      actor_id: 'user-1',
      actor_name: 'Alice',
      target_id: 'user-2',
      target_name: 'Bob',
      payload: '{}',
      created_at: timestamp,
      consumed: 0,
      consumed_at: null,
    })).resolves.toBe(true);
  });

  it('persists canonical NUL-delimited identities through PostgreSQL text columns', async () => {
    const events = host.models.get('conversation_events');
    const cursors = host.models.get('conversation_event_cursors');
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
