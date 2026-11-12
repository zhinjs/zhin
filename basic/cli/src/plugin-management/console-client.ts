import { randomUUID } from 'node:crypto';
import type { LocalGatewayFetch } from '@zhin.js/gateway/local';

/** A request was dispatched but no authoritative RPC result was received. Never retry a mutation blindly. */
export class ConsoleRequestUnconfirmedError extends Error {
  constructor(readonly requestId: string, readonly httpStatus?: number) {
    super(`Console request result is unconfirmed${httpStatus === undefined ? '' : ` (HTTP ${httpStatus})`}`);
    this.name = 'ConsoleRequestUnconfirmedError';
  }
}

/** The request never reached a Host (DNS, refused, unreachable, TLS): nothing was dispatched. */
export class ConsoleConnectionError extends Error {
  constructor(readonly host: string, readonly code: string | undefined) {
    super(`Not connected to a running Host at ${host}${code ? ` (${code})` : ''}`);
    this.name = 'ConsoleConnectionError';
  }
}

/** The Host answered with HTTP 401/403: credentials were rejected, nothing was executed. */
export class ConsoleAuthenticationError extends Error {
  constructor(readonly status: number, detail?: string) {
    super(`Console request rejected: HTTP ${status}${detail ? ` (${detail})` : ''}`);
    this.name = 'ConsoleAuthenticationError';
  }
}

/**
 * An authoritative error reply from the Host RPC handler: HTTP 400 carrying an `error`
 * string and echoing this request's `requestId` (the `/console/request` route contract).
 */
export class ConsoleRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsoleRpcError';
  }
}

// Failures raised before any request byte can have reached a Host. Anything else
// (timeouts, resets, unparsable replies) is treated as dispatched-but-unconfirmed.
const PRE_DISPATCH_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET_CONNECT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER',
]);

function connectionCode(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && PRE_DISPATCH_CODES.has(code)) return code;
    const errors = (current as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      const nested = errors.map(connectionCode).find(Boolean);
      if (nested) return nested;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Calls the existing control plane; never creates a second Runtime to perform verification. */
export async function requestPluginConsole<T>(
  host: string,
  request: Readonly<Record<string, unknown>>,
  tokenEnvironment = 'ZHIN_CONSOLE_TOKEN',
  options: Readonly<{ token?: string; requestId?: string; timeoutMs?: number; fetch?: LocalGatewayFetch }> = {},
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
  try {
    // Exactly one attempt: no retry, no redirect.
    response = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...request, requestId }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      redirect: 'error',
    });
  } catch (error) {
    const code = connectionCode(error);
    if (code) throw new ConsoleConnectionError(url.origin, code);
    throw new ConsoleRequestUnconfirmedError(requestId);
  }
  if (response.status === 401 || response.status === 403) {
    let message: unknown;
    try { message = ((await response.json()) as { error?: unknown } | null)?.error; } catch { message = undefined; }
    throw new ConsoleAuthenticationError(response.status, typeof message === 'string' ? message.slice(0, 200) : undefined);
  }
  let reply: { error?: unknown; data?: T; requestId?: unknown };
  try { reply = await response.json() as { error?: unknown; data?: T; requestId?: unknown }; }
  catch { throw new ConsoleRequestUnconfirmedError(requestId, response.ok ? undefined : response.status); }
  if (!reply || typeof reply !== 'object') throw new ConsoleRequestUnconfirmedError(requestId, response.ok ? undefined : response.status);
  // Only the RPC handler's own rejection is a definitive receipt. A proxy 502/504, a route-level 500
  // or any other non-2xx reply (even with an `error` string) says nothing about whether it was executed.
  if (response.status === 400 && typeof reply.error === 'string' && reply.requestId === requestId) {
    throw new ConsoleRpcError(reply.error);
  }
  if (!response.ok || reply.error !== undefined) throw new ConsoleRequestUnconfirmedError(requestId, response.status);
  if (!Object.hasOwn(reply, 'data')) throw new ConsoleRequestUnconfirmedError(requestId);
  return reply.data as T;
}
