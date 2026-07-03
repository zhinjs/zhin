import type { AgentBindingConfig, ResolvedAgentBinding } from './types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';

export function resolveAgentBinding(
  name: string,
  agents: Record<string, AgentBindingConfig>,
): ResolvedAgentBinding | null {
  const raw = agents[name];
  if (!raw) return null;
  return {
    name,
    providerAlias: raw.provider,
    model: raw.model,
    mcpServers: raw.mcpServers ?? [],
    nickname: raw.nickname,
  };
}

export function getZhinBinding(
  agents: Record<string, AgentBindingConfig>,
): ResolvedAgentBinding {
  return resolveAgentBinding(DEFAULT_ZHIN_AGENT_NAME, agents)!;
}
