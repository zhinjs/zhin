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

export function verifyA2aBearer(req: IncomingMessage, expectedToken: string): boolean {
  if (!expectedToken) return false;
  return timingSafeEqualString(expectedToken, extractBearerToken(req));
}
