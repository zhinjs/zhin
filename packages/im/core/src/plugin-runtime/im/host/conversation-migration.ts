import { INBOX_MESSAGE_QUERY_COLUMNS, INBOX_TABLE_MESSAGE, encodeStorageIdentity } from '@zhin.js/plugin-runtime';
import { ensureDatabaseColumns, ensureDatabaseIndex, type StructuredDatabase } from '@zhin.js/database';
import { CONVERSATION_EVENT_QUERY_MODEL, conversationEventQueryFields, readStoredConversationEvent } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

export interface ConversationMigrationOptions {
  /** Where skipped rows are reported (default: the `Database` logger). */
  readonly logger?: { warn(message: string): void };
}

/** Skipped rows reported one by one per start; the rest only count towards the summary. */
export const MIGRATION_SKIP_REPORT_LIMIT = 20;

/**
 * The derived query columns of one stored event, or why the row cannot be backfilled: unparsable
 * JSON (`invalid_event_json`), or JSON that is not a valid event — unknown or missing `type`,
 * missing address or references (`invalid_event`, the same check the readers apply).
 */
function queryFieldsOf(eventJson: unknown): { fields: Record<string, string | number | null> } | { reason: string } {
  const read = readStoredConversationEvent(eventJson);
  if (!read.ok) return { reason: read.reason };
  try { return { fields: conversationEventQueryFields(read.event) }; } catch { return { reason: 'invalid_event' }; }
}

/**
 * Run before installing the durable event reader into a candidate generation.
 *
 * A row whose `event_json` cannot be parsed (or is not an event) is skipped with a warning naming
 * the table and row id, never its content (#1250 `conversation-migration-bad-row-blocks-start`):
 * one damaged row must not keep the instance from starting. The row is left as it is — its
 * `event_json` intact and its derived columns empty (`query_version` stays null) — so it is not
 * lost, is reported again on the next start, and can be repaired or removed by hand. The first
 * {@link MIGRATION_SKIP_REPORT_LIMIT} skipped rows get a warning each, the rest only the closing
 * summary. Readers (`DatabaseConversationEventStore`, Console history) skip such rows too.
 */
export async function migrateConversationColumns(database: StructuredDatabase, options: ConversationMigrationOptions = {}): Promise<void> {
  if (!['sqlite', 'mysql', 'pg'].includes(database.dialectName)) return;
  await ensureDatabaseColumns(database, 'conversation_events', CONVERSATION_EVENT_QUERY_MODEL);
  const model = database.models.get('conversation_events');
  if (!model) throw new Error('Missing conversation_events model');
  let afterId: unknown;
  let skipped = 0;
  while (true) {
    const rows = await model.select('id', 'event_json').where({ $and: [
      ...(afterId === undefined ? [] : [{ id: { $gt: afterId } }]),
      { $or: [{ query_version: null }, { message_revision: null }] },
    ] }).orderBy('id').limit(200);
    if (!rows.length) break;
    for (const row of rows) {
      const derived = queryFieldsOf(row.event_json);
      if ('reason' in derived) {
        skipped += 1;
        if (skipped <= MIGRATION_SKIP_REPORT_LIMIT) (options.logger ?? getLogger('Database')).warn(formatCompact({ op: 'conversation_migration_skip', table: 'conversation_events', id: String(row.id), reason: derived.reason }));
        continue;
      }
      await model.update(derived.fields).where({ id: row.id });
    }
    // Seek past the completed batch instead of re-scanning already backfilled rows.
    afterId = rows[rows.length - 1]!.id;
  }
  if (skipped > 0) {
    (options.logger ?? getLogger('Database')).warn(formatCompact({ op: 'conversation_migration_skipped', table: 'conversation_events', skipped,
      ...(skipped > MIGRATION_SKIP_REPORT_LIMIT ? { unlisted: skipped - MIGRATION_SKIP_REPORT_LIMIT } : {}),
      hint: 'rows keep event_json; query_version stays null until repaired; readers skip them' }));
  }
  // Derived indexes can be rebuilt from event_json; rollback ignores the additive columns/indexes.
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_message_sequence', [
    { name: 'message_key', text: true }, { name: 'event_type', text: true }, { name: 'id' },
  ]);
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_message_revision', [
    { name: 'message_key', text: true }, { name: 'event_type', text: true }, { name: 'message_revision' }, { name: 'id' },
  ]);
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_conversation_time', [{ name: 'conversation_key', text: true }, { name: 'time' }]);
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_type_time', [{ name: 'event_type', text: true }, { name: 'time' }]);
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_scene', [
    { name: 'endpoint_adapter', text: true }, { name: 'endpoint_id', text: true },
    { name: 'conversation_kind', text: true }, { name: 'conversation_id', text: true },
    { name: 'id' },
  ]);
  // Operator scope directory selects only canonical address columns. SQLite/PostgreSQL
  // can cover the full tuple; MySQL TEXT prefixes cannot cover full identities and
  // seven 128-character utf8mb4 prefixes exceed its key budget, so keep an endpoint seek.
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_scope_directory',
    (database.dialectName === 'mysql' ? ['endpoint_id'] : [
      'endpoint_id', 'endpoint_adapter', 'conversation_kind', 'conversation_id', 'parent_kind', 'parent_id', 'thread_id',
    ]).map(name => ({ name, text: true })));

}

/** Older observations without canonical addresses remain explicitly unknown. */
export async function migrateInboxColumns(database: StructuredDatabase): Promise<void> {
  if (!['sqlite', 'mysql', 'pg'].includes(database.dialectName)) return;
  await ensureDatabaseColumns(database, INBOX_TABLE_MESSAGE, INBOX_MESSAGE_QUERY_COLUMNS);
  const model = database.models.get(INBOX_TABLE_MESSAGE)!;
  while (true) {
    const rows = await model.select('id', 'raw').where({ query_version: null }).orderBy('id').limit(200);
    if (!rows.length) break;
    for (const row of rows) {
      let observation: Record<string, any> | undefined;
      try { observation = JSON.parse(String(row.raw)); } catch { /* Legacy raw is optional, not a canonical event. */ }
      const current = observation?.$console === 'zhin.message-observation/1' ? observation : undefined;
      const encoded = (value: unknown) => typeof value === 'string' ? encodeStorageIdentity(value) : null;
      await model.update({ query_version: 1,
        direction: ['inbound', 'outbound'].includes(current?.direction) ? current!.direction : null,
        endpoint_capability_id: encoded(current?.conversation?.endpoint?.id),
        endpoint_adapter_id: encoded(current?.conversation?.endpoint?.adapter),
        thread_id: encoded(current?.conversation?.threadId),
      }).where({ id: row.id, query_version: null });
    }
  }
  await ensureDatabaseIndex(database, INBOX_TABLE_MESSAGE, 'inbox_message_direction_time', [{ name: 'direction', text: true }, { name: 'created_at' }]);
}
