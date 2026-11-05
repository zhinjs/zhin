import { type AgentBindingConfig, type ResolvedAgentBinding, DEFAULT_ZHIN_AGENT_NAME } from './types.js';
export function resolveAgentBinding(
  name: string,
  agents: Record<string, AgentBindingConfig>,
): ResolvedAgentBinding | null {
  const raw = agents[name];
  if (!raw) return null;
  return {
    name,
    mcpServers: raw.mcpServers ?? [],
    nickname: raw.nickname,
  };
}

export function getZhinBinding(
  agents: Record<string, AgentBindingConfig>,
): ResolvedAgentBinding {
  return resolveAgentBinding(DEFAULT_ZHIN_AGENT_NAME, agents)!;
}
