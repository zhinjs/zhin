/**
 * MCP connection lifecycle helpers for ZhinAgent turns.
 */

import type { McpRegistry } from './mcp-registry.js';

export async function ensureMcpConnections(
  mcps: McpRegistry,
  onEvent?: Parameters<McpRegistry['ensureConnected']>[0],
): Promise<void> {
  await mcps.ensureConnected(onEvent);
}

/** 仅懒连接 binding 列出的 MCP server 名 */
export async function ensureMcpConnectionsForBinding(
  mcps: McpRegistry,
  serverNames: string[],
  onEvent?: Parameters<McpRegistry['ensureConnected']>[0],
): Promise<void> {
  const want = new Set(serverNames.map(n => n.trim()).filter(Boolean));
  if (want.size === 0) return;
  for (const entry of mcps.getAll()) {
    if (!want.has(entry.name)) continue;
    if (mcps.isConnected(entry.name)) continue;
    try {
      await onEvent?.({ phase: 'start', serverName: entry.name });
      await mcps.connect(entry.name);
      await onEvent?.({
        phase: 'finish',
        serverName: entry.name,
        connected: mcps.isConnected(entry.name),
        toolNames: mcps.getToolsFromServer(entry.name).map(t => t.name),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await onEvent?.({ phase: 'error', serverName: entry.name, error: message });
    }
  }
}

export function getMcpToolsForBinding(mcps: McpRegistry, serverNames: string[]): import('@zhin.js/ai').AgentTool[] {
  const tools: import('@zhin.js/ai').AgentTool[] = [];
  for (const name of serverNames) {
    if (mcps.isConnected(name)) tools.push(...mcps.getToolsFromServer(name));
  }
  return tools;
}
