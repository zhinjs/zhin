/**
 * Register Agent Mesh MCP tools via core mesh registrar hook.
 * Skips registration when @modelcontextprotocol/sdk optional peer is not installed.
 */
import { createRequire } from 'node:module';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPlugin, setAgentMeshToolsRegistrar } from '@zhin.js/core';

const requirePeer = createRequire(import.meta.url);

function isMcpSdkInstalled(): boolean {
  try {
    requirePeer.resolve('@modelcontextprotocol/sdk/package.json');
    return true;
  } catch {
    return false;
  }
}

export function registerAgentMeshMcp(): void {
  if (!isMcpSdkInstalled()) {
    return;
  }

  const plugin = getPlugin();
  void import('../mcp-server/agent-mesh-tools.js').then(({ registerAgentMeshTools }) => {
    setAgentMeshToolsRegistrar((server) => registerAgentMeshTools(server as McpServer));
  });
  plugin.onDispose(() => {
    setAgentMeshToolsRegistrar(null);
  });
}
