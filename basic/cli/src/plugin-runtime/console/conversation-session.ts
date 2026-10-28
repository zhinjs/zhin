import { INBOX_TABLE_MESSAGE, type DatabaseHost } from '@zhin.js/plugin-runtime';

/** Session keys deliberately omit parent containers and threads. */
export function parseConversationSessionKey(sessionKey: string): {
  adapter: string; endpointKey: string; kind: string; id: string;
} | undefined {
  const first = sessionKey.indexOf(':');
  const second = sessionKey.indexOf(':', first + 1);
  const third = sessionKey.indexOf(':', second + 1);
  if (first <= 0 || second <= first + 1 || third <= second + 1 || third >= sessionKey.length - 1) return undefined;
  const kind = sessionKey.slice(second + 1, third);
  return { adapter: sessionKey.slice(0, first), endpointKey: sessionKey.slice(first + 1, second), kind, id: sessionKey.slice(third + 1) };
}

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
