/**
 * Bearer auth for A2A HTTP endpoints (reuses MCP mesh-auth timing-safe compare).
 */
import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function extractBearerToken(req: IncomingMessage): string {
  const auth = req.headers.authorization ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

/** Same loopback test as the MCP Host (duplicated: Hosts do not import each other). */
export function isLocalhost(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function verifyA2aBearer(req: IncomingMessage, expectedToken: string): boolean {
  if (!expectedToken) return false;
  return timingSafeEqualString(expectedToken, extractBearerToken(req));
}
