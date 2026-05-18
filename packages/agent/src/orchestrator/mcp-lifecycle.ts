/**
 * MCP connection lifecycle helpers for ZhinAgent turns.
 */

import type { McpRegistry } from './mcp-registry.js';

export async function ensureMcpConnections(mcps: McpRegistry): Promise<void> {
  await mcps.ensureConnected();
}
