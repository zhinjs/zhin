/**
 * MCP Bearer auth helpers — exported for unit tests (L4 mesh-auth contract).
 */
import { timingSafeEqual } from 'node:crypto';

export interface McpAuthConfig {
  allowUnauthenticatedLocalhost?: boolean;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** What the auth helpers read from a request: its headers and the peer address. */
export interface McpAuthRequest {
  readonly headers: Headers;
  readonly remoteAddress?: string;
}

export function isLocalhost(req: McpAuthRequest): boolean {
  const addr = req.remoteAddress ?? '';
  return (
    addr === '127.0.0.1'
    || addr === '::1'
    || addr === '::ffff:127.0.0.1'
  );
}

export function mcpAuthRequired(
  _body: unknown,
  req: McpAuthRequest,
  mcpCfg: McpAuthConfig,
  isProduction: boolean,
): boolean {
  if (!isProduction && mcpCfg.allowUnauthenticatedLocalhost !== false && isLocalhost(req)) {
    return false;
  }
  return true;
}

export function verifyMcpBearer(
  req: McpAuthRequest,
  expectedToken: string,
): boolean {
  if (!expectedToken) return false;
  const auth = req.headers.get('authorization') ?? '';
  const reqToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return timingSafeEqualString(expectedToken, reqToken);
}
