/**
 * MCP Bearer auth helpers — exported for unit tests (L4 mesh-auth contract).
 */
import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AGENT_MESH_TOOL_NAMES } from './mesh-registrar.js';

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

export function isLocalhost(req: IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  const addr = req.socket.remoteAddress ?? '';
  return (
    host.startsWith('127.0.0.1')
    || host.startsWith('localhost')
    || addr === '127.0.0.1'
    || addr === '::1'
    || addr === '::ffff:127.0.0.1'
  );
}

export function extractMcpToolName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const params = (body as { params?: { name?: string } }).params;
  return typeof params?.name === 'string' ? params.name : undefined;
}

export function mcpAuthRequired(
  body: unknown,
  req: IncomingMessage,
  mcpCfg: McpAuthConfig,
  isProduction: boolean,
): boolean {
  const toolName = extractMcpToolName(body);
  if (toolName && (AGENT_MESH_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return true;
  }
  if (!isProduction && mcpCfg.allowUnauthenticatedLocalhost !== false && isLocalhost(req)) {
    return false;
  }
  return true;
}

export function verifyMcpBearer(
  req: IncomingMessage,
  expectedToken: string,
): boolean {
  if (!expectedToken) return false;
  const auth = req.headers.authorization ?? '';
  const reqToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return timingSafeEqualString(expectedToken, reqToken);
}
