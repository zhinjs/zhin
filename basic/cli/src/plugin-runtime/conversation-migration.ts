import { INBOX_MESSAGE_QUERY_COLUMNS, INBOX_TABLE_MESSAGE, encodeStorageIdentity } from '@zhin.js/plugin-runtime';
import { ensureDatabaseColumns, ensureDatabaseIndex, type StructuredDatabase } from '@zhin.js/database';
import { CONVERSATION_EVENT_QUERY_MODEL, conversationEventQueryFields, type ConversationEvent } from '@zhin.js/im-contract';

/** Run before installing the durable event reader into a candidate generation. */
export async function migrateConversationColumns(database: StructuredDatabase): Promise<void> {
  if (!['sqlite', 'mysql', 'pg'].includes(database.dialectName)) return;
  await ensureDatabaseColumns(database, 'conversation_events', CONVERSATION_EVENT_QUERY_MODEL);
  const model = database.models.get('conversation_events');
  if (!model) throw new Error('Missing conversation_events model');
  while (true) {
    const rows = await model.select('id', 'event_json').where({ query_version: null }).orderBy('id').limit(200);
    if (!rows.length) break;
    for (const row of rows) {
      const event = JSON.parse(String(row.event_json)) as ConversationEvent;
      const fields = conversationEventQueryFields(event);
      await model.update(fields).where({ id: row.id, query_version: null });
    }
  }
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_conversation_time', [{ name: 'conversation_key', text: true }, { name: 'time' }]);
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_type_time', [{ name: 'event_type', text: true }, { name: 'time' }]);
  await ensureDatabaseIndex(database, 'conversation_events', 'conversation_events_scene', [
    { name: 'endpoint_adapter', text: true }, { name: 'endpoint_id', text: true },
    { name: 'conversation_kind', text: true }, { name: 'conversation_id', text: true },
    { name: 'id' },
  ]);
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
