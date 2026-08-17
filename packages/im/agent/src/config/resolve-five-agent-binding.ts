import type { FiveAgentRole } from '../builtin/five-agent/roles.js';
import {
  type AgentBindingConfig,
  type ResolvedAgentBinding,
  DEFAULT_ZHIN_AGENT_NAME,
} from './types.js';

export const FIVE_AGENT_ROLE_LABELS: Record<FiveAgentRole, string> = {
  planner: 'Planner',
  researcher: 'Researcher',
  evaluator: 'Evaluator',
  executor: 'Executor',
  reviewer: 'Reviewer',
};

export interface FiveAgentBindingSources {
  agents: Record<string, AgentBindingConfig>;
}

/** Resolve an optional Five-Agent role from the canonical Agent binding table. */
export function resolveFiveAgentRoleBinding(
  role: FiveAgentRole,
  sources: FiveAgentBindingSources,
): ResolvedAgentBinding {
  const base = sources.agents[DEFAULT_ZHIN_AGENT_NAME];
  if (!base) {
    throw new Error(
      `ai.agents.${DEFAULT_ZHIN_AGENT_NAME} is required to resolve Five-Agent role "${role}"`,
    );
  }
  const override = sources.agents[role];
  return {
    name: role,
    providerAlias: override?.provider ?? base.provider,
    model: override?.model ?? base.model,
    mcpServers: override?.mcpServers ?? base.mcpServers ?? [],
    nickname: override?.nickname
      ?? (role === 'planner' ? base.nickname : undefined)
      ?? FIVE_AGENT_ROLE_LABELS[role],
    permission: override?.permission ?? base.permission,
  };
}

export function resolvePlannerNickname(sources: FiveAgentBindingSources): string {
  return resolveFiveAgentRoleBinding('planner', sources).nickname
    ?? FIVE_AGENT_ROLE_LABELS.planner;
}
