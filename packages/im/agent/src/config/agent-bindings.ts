import type { AgentBindingConfig, ResolvedAgentBinding } from './types.js';
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
