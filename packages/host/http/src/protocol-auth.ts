import { timingSafeEqualString } from './timing-safe-equal.js';
import { hasForwardingHeaders } from './trust-proxy.js';

/** What a protocol credential check needs from an HTTP request or a {@link WsConnection}. */
export interface ProtocolAuthRequest {
  readonly headers: Headers;
  readonly url: URL | string;
  readonly remoteAddress?: string;
}

/** IPv4 / IPv6 / IPv4-mapped loopback peer. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return /^127(?:\.\d{1,3}){3}$/u.test(v4);
}

/**
 * Whether a listen address (`http.host`) only accepts connections from this machine:
 * `localhost`, `127.0.0.0/8`, `::1` (bracketed or not). `0.0.0.0`, `::` and any other address are
 * reachable from the network.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === '') return true; // the listener default is 127.0.0.1
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return bare.toLowerCase() === 'localhost' || isLoopbackAddress(bare);
}

/**
 * Access check for a plugin socket mounted with `ws(path, { auth: 'protocol' })` (adapter
 * reverse WebSockets: OneBot, NapCat, Milky…) or a protocol webhook. With an access token the
 * peer must present it as `Authorization: Bearer <token>` or `?access_token=<token>`
 * (constant-time compare); without one only loopback peers are admitted, so an unconfigured
 * socket is never public. Proxied traffic (`X-Forwarded-For` / `Forwarded` present) never counts
 * as loopback: a same-host reverse proxy would otherwise make every client local. A {@link WsConnection} can be passed directly; for an HTTP route pass
 * `{ headers: request.headers, url: context.url, remoteAddress: context.remoteAddress }`.
 */
export function verifyProtocolAccessToken(accessToken: string | undefined, request: ProtocolAuthRequest): boolean {
  if (!accessToken) return isLoopbackAddress(request.remoteAddress) && !hasForwardingHeaders(request.headers);
  const header = request.headers.get('authorization');
  if (typeof header === 'string' && header.startsWith('Bearer ')
    && timingSafeEqualString(header.slice(7).trim(), accessToken)) return true;
  let presented: string | null = null;
  try {
    const url = typeof request.url === 'string' ? new URL(request.url, 'http://localhost') : request.url;
    presented = url.searchParams.get('access_token');
  } catch {
    presented = null;
  }
  return presented !== null && timingSafeEqualString(presented, accessToken);
}
