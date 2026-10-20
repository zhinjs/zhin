import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import {
  CONVERSATION_EVENT_MODEL, CONVERSATION_CURSOR_MODEL, DatabaseConversationEventStore,
  type ConversationEvent,
} from '@zhin.js/im-contract';
import { CHAT_MESSAGE_MODEL, CONTEXT_SUMMARY_MODEL } from '@zhin.js/ai';
import type { MySQL } from '@zhin.js/database';

describe.skipIf(process.env.ZHIN_TEST_EXTERNAL_DATABASES !== '1')('MySQL startup through CLI DatabaseHost', () => {
  it.each([false, true])('creates canonical and AI tables, applies defaults and persists cursors (pool=%s)', async (pooled) => {
    const host = createDatabaseHost({
      dialect: 'mysql', host: process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306),
      user: process.env.ZHIN_TEST_MYSQL_USER ?? 'zhin',
      password: process.env.ZHIN_TEST_MYSQL_PASSWORD ?? 'zhin',
      database: process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test',
      ...(pooled ? { pool: { max: 2 } } : {}),
    });
    const prefix = `zhin_mysql_startup_${pooled ? 'pool' : 'single'}_`;
    host.define(`${prefix}events`, CONVERSATION_EVENT_MODEL);
    host.define(`${prefix}cursors`, CONVERSATION_CURSOR_MODEL);
    host.define(`${prefix}messages`, CHAT_MESSAGE_MODEL);
    host.define(`${prefix}summaries`, CONTEXT_SUMMARY_MODEL);
    host.define(`${prefix}defaults`, {
      id: { type: 'text', primary: true, length: 64 },
      label: { type: 'text', default: "o'clock" },
      metadata: { type: 'json', default: { tags: [] } },
    });
    const warning = vi.spyOn(console, 'error');
    try {
      await host.start();
      expect(host.started).toBe(true);
      expect(warning.mock.calls.flat().join(' ')).not.toContain('invalid configuration option');
      const events = host.models.get(`${prefix}events`)!;
      const store = new DatabaseConversationEventStore(events, host.models.get(`${prefix}cursors`)!);
      const conversation = { endpoint: { adapter: 'sandbox', id: 'test' }, kind: 'group' as const, id: '测试群' };
      const event: ConversationEvent = {
        eventId: 'message:测试', conversation, timestamp: 1789978249940, type: 'message.created',
        message: { ref: { conversation, id: 'm1' }, actor: { id: 'u1' },
          segments: [{ type: 'text', data: { text: 'hello' } }], timestamp: 1789978249940 },
      };
      const appended = await store.append(event);
      expect(appended.appended).toBe(true);
      expect(await store.append(event)).toEqual({ appended: false, sequence: appended.sequence });
      expect(await store.getMessage(event.message.ref)).toEqual(event.message);
      await store.commitCursor('agent', conversation, appended.sequence);
      expect(await store.getCursor('agent', conversation)).toBe(appended.sequence);
      const caseEvent = { ...event, eventId: 'message:Case' };
      const lowerEvent = { ...event, eventId: 'message:case' };
      const spacedEvent = { ...event, eventId: 'message:case ' };
      for (const distinct of [caseEvent, lowerEvent, spacedEvent]) {
        expect((await store.append(distinct)).appended).toBe(true);
        expect((await store.append(distinct)).appended).toBe(false);
      }
      await store.commitCursor('Agent', conversation, 10);
      await store.commitCursor('agent ', conversation, 20);
      expect(await store.getCursor('agent', conversation)).toBe(appended.sequence);
      expect(await store.getCursor('Agent', conversation)).toBe(10);
      expect(await store.getCursor('agent ', conversation)).toBe(20);
      const defaults = host.models.get(`${prefix}defaults`)!;
      await defaults.insert({ id: 'first' });
      expect(await defaults.select()).toEqual([{ id: 'first', label: "o'clock", metadata: { tags: [] } }]);
      const sharedPrefix = 'x'.repeat(600);
      await events.insert({ event_id: `${sharedPrefix}a`, conversation_key: '', event_json: '{}', time: 1 });
      await events.insert({ event_id: `${sharedPrefix}b`, conversation_key: '', event_json: '{}', time: 1 });
      await expect(events.insert({ event_id: `${sharedPrefix}a`, conversation_key: '', event_json: '{}', time: 1 })).rejects.toThrow(/Duplicate entry/);
      expect(await events.select('message_key').where({ event_id: `${sharedPrefix}b` })).toEqual([{ message_key: '' }]);
    } finally {
      warning.mockRestore();
      try {
        if (host.started) {
          const db = host.db as MySQL;
          for (const table of host.tables()) await db.query(db.dialect.formatDropTable(table, true));
        }
      } finally {
        await host.stop();
      }
    }
  });
});
