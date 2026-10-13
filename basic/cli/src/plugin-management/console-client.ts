import { randomUUID } from 'node:crypto';

/** Calls the existing control plane; never creates a second Runtime to perform verification. */
export async function requestPluginConsole<T>(
  host: string,
  request: Readonly<Record<string, unknown>>,
  tokenEnvironment = 'ZHIN_CONSOLE_TOKEN',
): Promise<T> {
  const url = new URL(host);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Console host must be an HTTP(S) base URL without credentials, query or fragment');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenEnvironment)) throw new Error('Invalid token environment variable name');
  const base = url.pathname === '/' ? '/api' : url.pathname.replace(/\/$/u, '');
  url.pathname = `${base}/console/request`;
  const token = process.env[tokenEnvironment];
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...request, requestId: randomUUID() }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  const reply = await response.json() as { error?: unknown; data?: T };
  if (typeof reply.error === 'string') throw new Error(reply.error);
  if (!response.ok) throw new Error(`Console request failed: HTTP ${response.status}`);
  if (!Object.hasOwn(reply, 'data')) throw new Error('Console response contains no result');
  return reply.data as T;
}
