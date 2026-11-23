import { parseConversationSessionKey } from '@zhin.js/console-protocol';
import { INBOX_TABLE_MESSAGE, type DatabaseHost } from '@zhin.js/plugin-runtime';

/** Verifies canonical IM session keys against the durable Console inbox. */
export async function isKnownConversationSession(
  databaseHost: Pick<DatabaseHost, 'started' | 'models'>,
  sessionKey: string,
): Promise<boolean | undefined> {
  if (!databaseHost.started) return undefined;
  const parsed = parseConversationSessionKey(sessionKey);
  if (!parsed) return false;
  const model = databaseHost.models.get(INBOX_TABLE_MESSAGE);
  if (!model) return undefined;
  const rows = await model.select('id').where({
    adapter: parsed.adapter,
    endpoint_id: parsed.endpointKey,
    channel_type: parsed.kind,
    channel_id: parsed.id,
  }).limit(1);
  return rows.length > 0;
}
