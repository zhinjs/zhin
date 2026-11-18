/**
 * Download media from a URL someone outside the host controls: an inbound voice or image address, a
 * `voice_stt` argument, a media URL in an Agent reply that an adapter uploads to its platform
 * (#1250 第 45 / 46 批). Address rules:
 *
 * - HTTPS only unless `allowHttp` (an address the platform itself produced, never a user-typed
 *   one); private, loopback, link-local and metadata hosts are refused by name either way;
 * - only the scheme's default port (https 443, and http 80 with `allowHttp`; written or not) unless
 *   `allowedPorts` lists more for the first URL's own origin, or the hop's origin is one of
 *   `trustedOrigins` — any other port is refused with `reason: 'port'`, on every hop (a redirect to
 *   another origin gets the default port only), so a URL cannot make the instance open TLS
 *   handshakes to arbitrary public ports (#1250 第 48 批);
 * - the name is resolved once, every address must be public, and the request connects to the
 *   address that was checked (`NodeNetworkTransport`), so DNS rebinding cannot swap in a private
 *   address between the check and the connection;
 * - redirects are followed by hand and every hop is checked again; a redirect from https to http is
 *   always refused, http to http only with `allowHttp`;
 * - the body is capped at `maxBytes` and the whole download (DNS included) at `timeoutMs`;
 * - caller `headers` go only to the origin of the first URL: a redirect to another scheme, host or
 *   port drops them, so an `Authorization` meant for one server never reaches the next.
 *
 * There is no allow-list for private hosts. `allowedDomains` only narrows the public hosts further.
 *
 * Moved from `@zhin.js/agent` (which re-exports it) so the IM core can offer it to adapters.
 */
import { checkUrlNetworkAccess, isDefaultOrAllowedPort, NetworkAccessDeniedError } from './ssrf.js';
import { NodeNetworkTransport, raceAbort, type NetworkTransport } from './pinned-transport.js';

export const PUBLIC_MEDIA_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface PublicMediaFetchOptions {
  readonly maxBytes: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  /**
   * Also accept `http:` (default false). Only for an address the platform adapter produced (a QQ voice
   * CDN link), never for one a user typed or a model chose — outbound media never sets it: the address
   * rules, pinning, redirect checks, size and time limits stay the same, and a redirect from https down
   * to http is still refused.
   */
  readonly allowHttp?: boolean;
  readonly signal?: AbortSignal;
  /**
   * Ports accepted besides the scheme's default (https 443; http 80 with `allowHttp`). They apply only
   * to the first URL's origin (same scheme, host and port — `http:` too with `allowHttp`): a redirect
   * hop to any other origin is held to the default port. Default none: only for a platform whose own
   * media host is known to use another port.
   */
  readonly allowedPorts?: readonly number[];
  /**
   * Origins (`scheme://host:port`, as `URL.origin` writes them) whose hops keep their port: the
   * protocol server an adapter itself is configured to talk to, which may serve media on its own
   * port. Only an exact origin match skips the port rule — the scheme, private-host and DNS checks
   * still apply. Never from user or model input.
   */
  readonly trustedOrigins?: readonly string[];
  /** When non-empty, every hop must also match one of these domains (or a subdomain). */
  readonly allowedDomains?: readonly string[];
  /**
   * Extra request headers (e.g. `Range`). Sent only to hops with the same origin (scheme + host +
   * port) as `url`; a cross-origin redirect drops them.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Replaces the pinned Node transport (tests). */
  readonly transport?: NetworkTransport;
}

/**
 * `blocked`: the address (or a redirect hop, or what the name resolves to) is not a public HTTPS
 * target on the default port; `too_large`: the body exceeds `maxBytes`; `http_status`: the final response is not 2xx;
 * `failed`: timeout, connection or TLS error, too many redirects.
 */
export type PublicMediaFetchFailure = 'blocked' | 'too_large' | 'http_status' | 'failed';

export type PublicMediaFetchResult =
  | Readonly<{ ok: true; bytes: Buffer; mimeType?: string; url: string }>
  /**
   * `host` is the host name of the refused or failed hop, for logs; never the full URL. `reason`
   * (only with `blocked`): `port` when the hop's port is neither the scheme's default nor in `allowedPorts`.
   */
  | Readonly<{ ok: false; code: PublicMediaFetchFailure; host?: string; status?: number; reason?: 'port' }>;

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function withHost(code: PublicMediaFetchFailure, url: string, status?: number, reason?: 'port'): PublicMediaFetchResult {
  const host = hostOf(url);
  return Object.freeze({
    ok: false as const,
    code,
    ...(host ? { host } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(reason ? { reason } : {}),
  });
}

export async function fetchPublicMediaBytes(
  url: string,
  options: PublicMediaFetchOptions,
): Promise<PublicMediaFetchResult> {
  const transport = options.transport ?? new NodeNetworkTransport();
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? PUBLIC_MEDIA_FETCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  if (!transport.requestBytes) return withHost('failed', url);
  let current = url.trim();
  let previousProtocol: string | undefined;
  let firstOrigin: string | undefined;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const allowedDomains = [...(options.allowedDomains ?? [])];
    if (!checkUrlNetworkAccess(current, { httpsOnly: options.allowHttp !== true, allowedDomains }).allowed) {
      return withHost('blocked', current);
    }
    const parsed = new URL(current);
    firstOrigin ??= parsed.origin;
    // `allowedPorts` vouches for the first URL's origin only: a hop to another scheme, host or port gets
    // the default port alone, so a redirect cannot carry an allowed port to a host nobody vouched for.
    // A declared `trustedOrigins` entry vouches for exactly that origin, on whichever hop reaches it.
    const extraPorts = parsed.origin === firstOrigin ? options.allowedPorts : undefined;
    if (!isDefaultOrAllowedPort(parsed, extraPorts) && !options.trustedOrigins?.includes(parsed.origin)) {
      return withHost('blocked', current, undefined, 'port');
    }
    // Never downgrade: once a hop was https, an http hop would expose the download in clear text.
    if (previousProtocol === 'https:' && parsed.protocol !== 'https:') return withHost('blocked', current);
    previousProtocol = parsed.protocol;
    const headers = parsed.origin === firstOrigin ? (options.headers ?? {}) : {};
    let response: Awaited<ReturnType<NonNullable<NetworkTransport['requestBytes']>>>;
    try {
      signal.throwIfAborted();
      // Bound the hop by the deadline even if a transport ignores the signal (a slow resolver, L1).
      response = await raceAbort(transport.requestBytes(parsed, headers, signal, options.maxBytes), signal);
    } catch (error) {
      if (error instanceof NetworkAccessDeniedError) return withHost('blocked', current);
      if (error instanceof Error && /exceeds \d+ bytes/u.test(error.message)) return withHost('too_large', current);
      return withHost('failed', current);
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.location;
      if (!location || hop === maxRedirects) return withHost('failed', current, response.status);
      try {
        current = new URL(location, parsed).href;
      } catch {
        return withHost('failed', current, response.status);
      }
      continue;
    }
    if (response.status < 200 || response.status >= 300) return withHost('http_status', current, response.status);
    if (response.body.byteLength > options.maxBytes) return withHost('too_large', current);
    const contentType = response.headers['content-type']?.split(';')[0]?.trim();
    return Object.freeze({
      ok: true as const,
      bytes: Buffer.from(response.body),
      ...(contentType ? { mimeType: contentType } : {}),
      url: parsed.href,
    });
  }
  return withHost('failed', current);
}
