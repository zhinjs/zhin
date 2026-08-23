import type {
  ConsoleEventHistoryPage,
  ConsoleEventHistoryQuery,
} from '@zhin.js/console-protocol';
import { getStoredToken, resolveApiUrl } from './websocket/remote-settings.js';

export interface FetchConsoleEventHistoryOptions {
  readonly signal?: AbortSignal;
}

/** Read a typed page from the Host's bounded Console event journal. */
export async function fetchConsoleEventHistory(
  query: ConsoleEventHistoryQuery = {},
  options: FetchConsoleEventHistoryOptions = {},
): Promise<ConsoleEventHistoryPage> {
  const params = new URLSearchParams();
  if (query.runtimeId) params.set('runtimeId', query.runtimeId);
  if (query.after !== undefined) params.set('after', String(query.after));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const token = getStoredToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const suffix = params.size ? `?${params}` : '';
  const response = await fetch(resolveApiUrl(`/api/events/history${suffix}`), {
    headers,
    signal: options.signal,
  });
  const body = await response.json() as {
    success?: boolean;
    data?: ConsoleEventHistoryPage;
    error?: string;
  };
  if (!response.ok || body.success !== true || !body.data) {
    throw new Error(body.error ?? `Console event history failed: HTTP ${response.status}`);
  }
  return body.data;
}
