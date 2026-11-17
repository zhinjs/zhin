import type { AgentBindingConfig, ResolvedAgentBinding } from './types.js';
import { bindingMcpPermits, parseAgentMcpServers, type McpToolPermit } from '../plugin-runtime/mcp-tool-permit.js';

export function resolveAgentBinding(
  name: string,
  agents: Record<string, AgentBindingConfig>,
  serverPermits: Readonly<Record<string, McpToolPermit | undefined>> = {},
): ResolvedAgentBinding | null {
  const raw = agents[name];
  if (!raw) return null;
  const servers = parseAgentMcpServers(raw.mcpServers, `ai.agents.${name}`);
  return {
    name,
    mcpServers: servers.names,
    ...(servers.names.length ? { mcpPermits: bindingMcpPermits(servers.names, serverPermits, servers.permits) } : {}),
    nickname: raw.nickname,
  };
}
