/**
 * Bearer auth for A2A HTTP endpoints (reuses MCP mesh-auth timing-safe compare).
 */
import { timingSafeEqual } from 'node:crypto';

export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** What the auth helpers read from a request: its headers and the peer address. */
export interface A2aAuthRequest {
  readonly headers: Headers;
  readonly remoteAddress?: string;
}

export function extractBearerToken(req: A2aAuthRequest): string {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

/** Same loopback test as the MCP Host (duplicated: Hosts do not import each other). */
export function isLocalhost(req: A2aAuthRequest): boolean {
  const addr = req.remoteAddress ?? '';
  // Proxied requests are never local, whatever the proxy's own address.
  if (req.headers.has('x-forwarded-for') || req.headers.has('forwarded')) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function verifyA2aBearer(req: A2aAuthRequest, expectedToken: string): boolean {
  if (!expectedToken) return false;
  return timingSafeEqualString(expectedToken, extractBearerToken(req));
}
