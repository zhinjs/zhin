/**
 * Register Agent Mesh MCP tools via @zhin.js/mcp mesh registrar hook.
 */
import { getPlugin } from '@zhin.js/core';
import { setAgentMeshToolsRegistrar } from '@zhin.js/mcp';
import { registerAgentMeshTools } from '../mcp-server/agent-mesh-tools.js';

export function registerAgentMeshMcp(): void {
  const plugin = getPlugin();
  setAgentMeshToolsRegistrar(registerAgentMeshTools);
  plugin.onDispose(() => {
    setAgentMeshToolsRegistrar(null);
  });
}
