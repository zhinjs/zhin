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
  const event = (id: string) => JSON.stringify({ type: 'conversation.poked', eventId: `e-${id}`, timestamp: 1, conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'group', id }, actor: { id: 'u1' } });

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
    const skips = warnings.filter(line => line.startsWith('conversation_migration_skip |'));
    expect(skips[0]).toContain('table: conversation_events');
    expect(skips[0]).toContain('id: 2');
    expect(skips[0]).toContain('reason: invalid_event_json');
    expect(skips[1]).toContain('table: conversation_events');
    expect(skips[1]).toContain('id: 3');
    expect(skips[1]).toContain('reason: invalid_event');
    expect(warnings.join('\n')).not.toContain('secret');
    expect(warnings.some(line => line.includes('conversation_migration_skipped') && line.includes('skipped: 2'))).toBe(true);
    // The indexes are still created after the skipped rows.
    expect(query.mock.calls.some(([sql]) => String(sql).includes('conversation_events_scene'))).toBe(true);
  });

  function migrate(rows: { id: number; event_json: string }[]) {
    const batches = [rows, []];
    const selection = { where() { return this; }, orderBy() { return this; }, limit: async () => batches.shift() ?? [] };
    const updated: unknown[] = [];
    const update = vi.fn(() => ({ where: async (where: unknown) => { updated.push(where); } }));
    const query = vi.fn(async (sql: string) => sql.startsWith('PRAGMA table_info') ? Object.keys(CONVERSATION_EVENT_QUERY_MODEL).map(name => ({ name })) : []);
    const warn = vi.fn();
    const done = migrateConversationColumns({ dialectName: 'sqlite', query, models: new Map([['conversation_events', { select: () => selection, update }]]) } as unknown as StructuredDatabase, { logger: { warn } });
    return { done, updated, warnings: () => warn.mock.calls.map(([message]) => String(message)) };
  }

  it('skips parsed JSON that is not a valid event (unknown or missing type, missing address) as invalid_event', async () => {
    const run = migrate([
      { id: 1, event_json: JSON.stringify({ type: 'bogus.type', eventId: 'x', timestamp: 1, conversation: { endpoint: { adapter: 'a', id: 'b' }, kind: 'group', id: 'g' } }) },
      { id: 2, event_json: JSON.stringify({ eventId: 'y', timestamp: 1, conversation: { endpoint: { adapter: 'a', id: 'b' }, kind: 'group', id: 'g' } }) },
      { id: 3, event_json: JSON.stringify({ type: 'message.created', eventId: 'z', timestamp: 1 }) },
      { id: 4, event_json: '{}' },
      { id: 5, event_json: event('ok') },
    ]);
    await run.done;
    expect(run.updated).toEqual([{ id: 5 }]);
    const skips = run.warnings().filter(line => line.startsWith('conversation_migration_skip |'));
    expect(skips).toHaveLength(4);
    for (const line of skips) {
      expect(line).toContain('table: conversation_events');
      expect(line).toContain('reason: invalid_event');
    }
  });

  it('warns row by row up to the limit and only counts the rest in the summary', async () => {
    const { MIGRATION_SKIP_REPORT_LIMIT } = await import('@zhin.js/core/runtime');
    const total = MIGRATION_SKIP_REPORT_LIMIT + 7;
    const run = migrate(Array.from({ length: total }, (_, index) => ({ id: index + 1, event_json: 'not json' })));
    await run.done;
    const warnings = run.warnings();
    expect(warnings.filter(line => line.startsWith('conversation_migration_skip |'))).toHaveLength(MIGRATION_SKIP_REPORT_LIMIT);
    const summary = warnings.find(line => line.startsWith('conversation_migration_skipped'));
    expect(summary).toContain(`skipped: ${total}`);
    expect(summary).toContain('unlisted: 7');
  });
});
