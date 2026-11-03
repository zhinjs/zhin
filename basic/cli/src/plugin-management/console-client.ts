import { randomUUID } from 'node:crypto';

/** A request was dispatched but no authoritative RPC result was received. Never retry a mutation blindly. */
export class ConsoleRequestUnconfirmedError extends Error {
  constructor(readonly requestId: string) {
    super('Console request result is unconfirmed');
    this.name = 'ConsoleRequestUnconfirmedError';
  }
}

/** Calls the existing control plane; never creates a second Runtime to perform verification. */
export async function requestPluginConsole<T>(
  host: string,
  request: Readonly<Record<string, unknown>>,
  tokenEnvironment = 'ZHIN_CONSOLE_TOKEN',
  options: Readonly<{ token?: string; requestId?: string }> = {},
): Promise<T> {
  const url = new URL(host);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Console host must be an HTTP(S) base URL without credentials, query or fragment');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenEnvironment)) throw new Error('Invalid token environment variable name');
  const base = url.pathname === '/' ? '/api' : url.pathname.replace(/\/$/u, '');
  url.pathname = `${base}/console/request`;
  const token = options.token ?? process.env[tokenEnvironment];
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
  if (token && url.protocol === 'http:' && !loopback) throw new Error('Console credentials require HTTPS for non-loopback hosts');
  const requestId = options.requestId ?? randomUUID();
  let response: Response;
  let reply: { error?: unknown; data?: T };
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...request, requestId }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    reply = await response.json() as { error?: unknown; data?: T };
  } catch {
    throw new ConsoleRequestUnconfirmedError(requestId);
  }
  if (!reply || typeof reply !== 'object') throw new ConsoleRequestUnconfirmedError(requestId);
  if (typeof reply.error === 'string') throw new Error(reply.error);
  if (!response.ok) throw new Error(`Console request failed: HTTP ${response.status}`);
  if (!Object.hasOwn(reply, 'data')) throw new ConsoleRequestUnconfirmedError(requestId);
  return reply.data as T;
}
