/**
 * Register Agent Mesh MCP tools via core mesh registrar hook.
 */
import { getPlugin, setAgentMeshToolsRegistrar } from '@zhin.js/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentMeshTools } from '../mcp-server/agent-mesh-tools.js';

export function registerAgentMeshMcp(): void {
  const plugin = getPlugin();
  setAgentMeshToolsRegistrar((server) => registerAgentMeshTools(server as McpServer));
  plugin.onDispose(() => {
    setAgentMeshToolsRegistrar(null);
  });
}
