import { timingSafeEqualString } from './timing-safe-equal.js';

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
 * Access check for a plugin socket mounted with `ws(path, { auth: 'protocol' })` (adapter
 * reverse WebSockets: OneBot, NapCat, Milky…) or a protocol webhook. With an access token the
 * peer must present it as `Authorization: Bearer <token>` or `?access_token=<token>`
 * (constant-time compare); without one only loopback peers are admitted, so an unconfigured
 * socket is never public. A {@link WsConnection} can be passed directly; for an HTTP route pass
 * `{ headers: request.headers, url: context.url, remoteAddress: context.remoteAddress }`.
 */
export function verifyProtocolAccessToken(accessToken: string | undefined, request: ProtocolAuthRequest): boolean {
  if (!accessToken) return isLoopbackAddress(request.remoteAddress);
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
