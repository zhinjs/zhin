/**
 * 协作群 pipelineRole → agent 绑定。
 *
 * SSOT：`ai.agents.zhin`；可选 `ai.agents.<role>`（如 researcher）覆盖 provider/model/nickname。
 */
import type { PipelineRole } from '../collaboration/types.js';
import type { AgentBindingConfig, ResolvedAgentBinding } from './types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';

/** 角色昵称缺省回退（英文 role label）。 */
export const PIPELINE_ROLE_LABELS: Record<PipelineRole, string> = {
  planner: 'Planner',
  researcher: 'Researcher',
  evaluator: 'Evaluator',
  executor: 'Executor',
  reviewer: 'Reviewer',
};

export interface RoleBindingSources {
  agents: Record<string, AgentBindingConfig>;
}

export function resolvePipelineRoleBinding(
  role: PipelineRole,
  sources: RoleBindingSources,
): ResolvedAgentBinding {
  const base = sources.agents[DEFAULT_ZHIN_AGENT_NAME];
  if (!base) {
    throw new Error(`ai.agents.${DEFAULT_ZHIN_AGENT_NAME} is required to resolve pipeline role "${role}"`);
  }
  const roleAgent = sources.agents[role];
  const provider = roleAgent?.provider ?? base.provider;
  const model = roleAgent?.model ?? base.model;
  const mcpServers = roleAgent?.mcpServers ?? base.mcpServers ?? [];
  const nickname =
    roleAgent?.nickname
    ?? (role === 'planner' ? base.nickname : undefined)
    ?? PIPELINE_ROLE_LABELS[role];
  return {
    name: role,
    providerAlias: provider,
    model,
    mcpServers,
    nickname,
    permission: roleAgent?.permission ?? base.permission,
  };
}

/** Planner 入口（= zhin binding）的展示昵称。 */
export function resolvePlannerNickname(sources: RoleBindingSources): string {
  return resolvePipelineRoleBinding('planner', sources).nickname ?? PIPELINE_ROLE_LABELS.planner;
}
