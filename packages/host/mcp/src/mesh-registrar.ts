/**
 * Optional Agent Mesh tools registrar — set by @zhin.js/agent at runtime.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const AGENT_MESH_TOOL_NAMES = [
  "agent.delegate_task",
  "agent.query_status",
  "agent.get_result",
  "agent.cancel_task",
] as const;

let registrar: ((server: McpServer) => void) | null = null;

export function setAgentMeshToolsRegistrar(fn: ((server: McpServer) => void) | null): void {
  registrar = fn;
}

export function applyAgentMeshTools(server: McpServer): void {
  registrar?.(server);
}
