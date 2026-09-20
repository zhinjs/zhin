import { INBOX_TABLE_MESSAGE, type DatabaseHost } from '@zhin.js/plugin-runtime';

/** Verifies canonical IM session keys against the durable Console inbox. */
export async function isKnownConversationSession(
  databaseHost: Pick<DatabaseHost, 'started' | 'models'>,
  sessionKey: string,
): Promise<boolean | undefined> {
  if (!databaseHost.started) return undefined;
  const first = sessionKey.indexOf(':');
  const second = sessionKey.indexOf(':', first + 1);
  const third = sessionKey.indexOf(':', second + 1);
  if (first <= 0 || second <= first + 1 || third <= second + 1 || third >= sessionKey.length - 1) {
    return false;
  }
  const model = databaseHost.models.get(INBOX_TABLE_MESSAGE);
  if (!model) return undefined;
  const rows = await model.select('id').where({
    adapter: sessionKey.slice(0, first),
    endpoint_id: sessionKey.slice(first + 1, second),
    channel_type: sessionKey.slice(second + 1, third),
    channel_id: sessionKey.slice(third + 1),
  }).limit(1);
  return rows.length > 0;
}
