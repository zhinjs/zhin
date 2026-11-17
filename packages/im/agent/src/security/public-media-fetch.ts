/**
 * Download media from a URL a remote user controls (an inbound voice message address, a `voice_stt`
 * argument). Same address rules as other inbound media (`fetchUrlAsBase64`), plus a pinned
 * connection (#1250 第 45 批 `speech-url-ssrf`):
 *
 * - HTTPS only; private, loopback, link-local and metadata hosts are refused by name;
 * - the name is resolved once, every address must be public, and the request connects to the
 *   address that was checked (`NodeNetworkTransport`), so DNS rebinding cannot swap in a private
 *   address between the check and the connection;
 * - redirects are followed by hand and every hop is checked again;
 * - the body is capped at `maxBytes` and the whole download at `timeoutMs`.
 *
 * There is no allow-list for private hosts: an operator who needs one transcribes from a public URL.
 */
import { checkUrlNetworkAccess, NetworkAccessDeniedError } from './network-policy.js';
import { NodeNetworkTransport, type NetworkTransport } from './turn-network-client.js';

export const PUBLIC_MEDIA_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface PublicMediaFetchOptions {
  readonly maxBytes: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly signal?: AbortSignal;
  /** Replaces the pinned Node transport (tests). */
  readonly transport?: NetworkTransport;
}

/**
 * `blocked`: the address (or a redirect hop, or what the name resolves to) is not a public HTTPS
 * target; `too_large`: the body exceeds `maxBytes`; `http_status`: the final response is not 2xx;
 * `failed`: timeout, connection or TLS error, too many redirects.
 */
export type PublicMediaFetchFailure = 'blocked' | 'too_large' | 'http_status' | 'failed';

export type PublicMediaFetchResult =
  | Readonly<{ ok: true; bytes: Buffer; mimeType?: string; url: string }>
  /** `host` is the host name of the refused or failed hop, for logs; never the full URL. */
  | Readonly<{ ok: false; code: PublicMediaFetchFailure; host?: string; status?: number }>;

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function withHost(code: PublicMediaFetchFailure, url: string, status?: number): PublicMediaFetchResult {
  const host = hostOf(url);
  return Object.freeze({ ok: false as const, code, ...(host ? { host } : {}), ...(status !== undefined ? { status } : {}) });
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
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!checkUrlNetworkAccess(current, { httpsOnly: true, allowedDomains: [] }).allowed) return withHost('blocked', current);
    const parsed = new URL(current);
    let response: Awaited<ReturnType<NonNullable<NetworkTransport['requestBytes']>>>;
    try {
      signal.throwIfAborted();
      response = await transport.requestBytes(parsed, {}, signal, options.maxBytes);
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
