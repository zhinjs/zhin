import type { IncomingMessage } from 'node:http';
import { timingSafeEqualString } from './timing-safe-equal.js';

type ProtocolRequest = Pick<IncomingMessage, 'headers' | 'url'> & {
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
};

/** IPv4 / IPv6 / IPv4-mapped loopback peer. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return /^127(?:\.\d{1,3}){3}$/u.test(v4);
}

/**
 * Access check for a plugin socket mounted with `ws(path, { auth: 'protocol' })` (adapter
 * reverse WebSockets: OneBot, NapCat, Milky…). With an access token the peer must present it
 * as `Authorization: Bearer <token>` or `?access_token=<token>` (constant-time compare);
 * without one only loopback peers are admitted, so an unconfigured socket is never public.
 */
export function verifyProtocolAccessToken(accessToken: string | undefined, request: ProtocolRequest): boolean {
  if (!accessToken) return isLoopbackAddress(request.socket?.remoteAddress);
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')
    && timingSafeEqualString(header.slice(7).trim(), accessToken)) return true;
  let presented: string | null = null;
  try {
    presented = new URL(request.url ?? '/', 'http://localhost').searchParams.get('access_token');
  } catch {
    presented = null;
  }
  return presented !== null && timingSafeEqualString(presented, accessToken);
}
