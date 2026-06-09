/**
 * Agent Mesh MCP 工具注册钩子（无 MCP SDK 依赖，供 @zhin.js/agent / @zhin.js/mcp 共用）。
 */
export const AGENT_MESH_TOOL_NAMES = [
  'agent.delegate_task',
  'agent.query_status',
  'agent.get_result',
  'agent.cancel_task',
] as const;

type AgentMeshToolsRegistrar = (server: unknown) => void;

let registrar: AgentMeshToolsRegistrar | null = null;

export function setAgentMeshToolsRegistrar(fn: AgentMeshToolsRegistrar | null): void {
  registrar = fn;
}

export function applyAgentMeshTools(server: unknown): void {
  registrar?.(server);
}
