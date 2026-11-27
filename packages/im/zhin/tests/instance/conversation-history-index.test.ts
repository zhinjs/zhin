import { CONVERSATION_EVENT_QUERY_MODEL } from '@zhin.js/im-contract';
import type { StructuredDatabase } from '@zhin.js/database';
import { migrateConversationColumns } from '@zhin.js/core/runtime';

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

describe('a bad event_json row (#1250 conversation-migration-bad-row-blocks-start)', () => {
  const event = (id: string) => JSON.stringify({ type: 'conversation.joined', conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'group', id }, actor: { id: 'u1' } });

  it('skips the row with a warning naming its id (not its content), migrates the rest and keeps event_json', async () => {
    const batches = [[
      { id: 1, event_json: event('g1') },
      { id: 2, event_json: '{"truncated secret' },
      { id: 3, event_json: 'null' },
      { id: 4, event_json: event('g4') },
    ], []];
    const selection = { where() { return this; }, orderBy() { return this; }, limit: async () => batches.shift() ?? [] };
    const updated: { fields: Record<string, unknown>; where: unknown }[] = [];
    const update = vi.fn((fields: Record<string, unknown>) => ({ where: async (where: unknown) => { updated.push({ fields, where }); } }));
    const query = vi.fn(async (sql: string) => sql.startsWith('PRAGMA table_info') ? Object.keys(CONVERSATION_EVENT_QUERY_MODEL).map(name => ({ name })) : []);
    const warn = vi.fn();
    await migrateConversationColumns({ dialectName: 'sqlite', query, models: new Map([['conversation_events', { select: () => selection, update }]]) } as unknown as StructuredDatabase, { logger: { warn } });
    expect(updated.map(entry => entry.where)).toEqual([{ id: 1 }, { id: 4 }]);
    expect(updated.every(entry => !('event_json' in entry.fields))).toBe(true);
    const warnings = warn.mock.calls.map(([message]) => String(message));
    expect(warnings.filter(line => line.startsWith('conversation_migration_skip |'))).toHaveLength(2);
    expect(warnings.join('\n')).toContain('id: 2');
    expect(warnings.join('\n')).toContain('id: 3');
    expect(warnings.join('\n')).not.toContain('secret');
    expect(warnings.some(line => line.includes('conversation_migration_skipped') && line.includes('skipped: 2'))).toBe(true);
    // The indexes are still created after the skipped rows.
    expect(query.mock.calls.some(([sql]) => String(sql).includes('conversation_events_scene'))).toBe(true);
  });
});
