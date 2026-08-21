import { AGENT_ROLE_CONFIGS, type AgentRole } from '../../orchestrator/role-configs.js';
import { isFiveAgentRole, type FiveAgentRole } from './roles.js';

export function isToolAllowedForRole(toolName: string, role: AgentRole): boolean {
  const config = AGENT_ROLE_CONFIGS[role];
  if (!config) return true;
  if (config.blockedTools.includes(toolName)) return false;
  if (config.allowedTools.includes('*')) return true;
  return config.allowedTools.includes(toolName);
}

export function filterToolNamesForRole(names: string[], role: FiveAgentRole): string[] {
  return names.filter((name) => isToolAllowedForRole(name, role));
}

export function filterToolsForRole<T extends { name: string }>(
  tools: T[],
  role: FiveAgentRole,
): T[] {
  return tools.filter((tool) => isToolAllowedForRole(tool.name, role));
}

export function asFiveAgentRole(value: unknown): FiveAgentRole | undefined {
  return isFiveAgentRole(value) ? value : undefined;
}
