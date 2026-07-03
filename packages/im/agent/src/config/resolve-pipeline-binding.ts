/**
 * resolvePipelineRoleBinding — Five-Agent 角色 provider/model/nickname 解析（ADR 0024 #12/#14）。
 *
 * SSOT：`ai.agents.zhin` 为默认源；`ai.pipeline.<role>` 可选覆盖。
 * 不依赖独立 `ai.agents.researcher` 等 binding。
 */
import type { PipelineRole } from '../collaboration/types.js';
import type { AgentBindingConfig, PipelineRoleConfig, ResolvedAgentBinding } from './types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';

/** 角色昵称缺省回退（英文 role label，不再硬编码品牌名）。 */
export const PIPELINE_ROLE_LABELS: Record<PipelineRole, string> = {
  planner: 'Planner',
  researcher: 'Researcher',
  evaluator: 'Evaluator',
  executor: 'Executor',
  reviewer: 'Reviewer',
};

export interface PipelineBindingSources {
  agents: Record<string, AgentBindingConfig>;
  pipeline?: Record<string, PipelineRoleConfig>;
}

export function resolvePipelineRoleBinding(
  role: PipelineRole,
  sources: PipelineBindingSources,
): ResolvedAgentBinding {
  const base = sources.agents[DEFAULT_ZHIN_AGENT_NAME];
  if (!base) {
    throw new Error(`ai.agents.${DEFAULT_ZHIN_AGENT_NAME} is required to resolve pipeline role "${role}"`);
  }
  const patch = sources.pipeline?.[role] ?? {};
  const provider = patch.provider ?? base.provider;
  const model = patch.model ?? base.model;
  const mcpServers = patch.mcpServers ?? base.mcpServers ?? [];
  const nickname =
    patch.nickname
    ?? (role === 'planner' ? base.nickname : undefined)
    ?? PIPELINE_ROLE_LABELS[role];
  return {
    name: role,
    providerAlias: provider,
    model,
    mcpServers,
    nickname,
  };
}

/** Planner 入口（= zhin binding）的展示昵称。 */
export function resolvePlannerNickname(sources: PipelineBindingSources): string {
  return resolvePipelineRoleBinding('planner', sources).nickname ?? PIPELINE_ROLE_LABELS.planner;
}
