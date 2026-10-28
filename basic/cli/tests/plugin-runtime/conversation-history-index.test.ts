import { CONVERSATION_EVENT_QUERY_MODEL } from '@zhin.js/im-contract';
import type { StructuredDatabase } from '@zhin.js/database';
import { migrateConversationColumns } from '../../src/plugin-runtime/conversation-migration.js';

it.each(['sqlite', 'mysql', 'pg'])('adds the scene lookup index through the existing %s migration syntax without changing event rows', async dialectName => {
  const selection = { where() { return this; }, orderBy() { return this; }, limit: async () => [] };
  const update = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('PRAGMA table_info')) return Object.keys(CONVERSATION_EVENT_QUERY_MODEL).map(name => ({ name }));
    if (sql.startsWith('SHOW COLUMNS')) return Object.keys(CONVERSATION_EVENT_QUERY_MODEL).map(Field => ({ Field }));
    if (sql.startsWith('SELECT column_name')) return Object.keys(CONVERSATION_EVENT_QUERY_MODEL).map(column_name => ({ column_name }));
    return [];
  });
  await migrateConversationColumns({ dialectName, query, models: new Map([['conversation_events', { select: () => selection, update }]]) } as unknown as StructuredDatabase);
  const statements = query.mock.calls.map(([sql]) => sql);
  const index = statements.find(sql => sql.startsWith('CREATE INDEX') && sql.includes('conversation_events_scene'));
  expect(index).toBe(dialectName === 'mysql'
    ? 'CREATE INDEX `conversation_events_scene` ON `conversation_events` (`endpoint_adapter`(128), `endpoint_id`(128), `conversation_kind`(128), `conversation_id`(128), `id`)'
    : 'CREATE INDEX IF NOT EXISTS "conversation_events_scene" ON "conversation_events" ("endpoint_adapter", "endpoint_id", "conversation_kind", "conversation_id", "id")');
  // Four utf8mb4 prefixes use 2048 bytes; with the integer sequence this remains below 3072 bytes.
  expect(update).not.toHaveBeenCalled();
});
