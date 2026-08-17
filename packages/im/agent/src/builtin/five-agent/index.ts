/**
 * FiveAgentPromptRegistry — 内置五角色 system prompt SSOT（ADR 0024 #9）。
 *
 * 不走 discoverWorkspaceAgents()；用户无法用 workspace `agents/*.md` 覆盖。
 */
import { type FiveAgentRole, isFiveAgentRole } from './roles.js';
import { FIVE_AGENT_ROLE_LABELS } from '../../config/resolve-five-agent-binding.js';
import { renderFiveAgentPrompt } from './prompts.js';
export { FIVE_AGENT_PROMPTS, renderFiveAgentPrompt } from './prompts.js';
export {
  FIVE_AGENT_WORKFLOW_STRATEGY_NAME,
  createFiveAgentWorkflowStrategy,
} from './strategy.js';

export interface FiveAgentPromptInput {
  role: FiveAgentRole;
  /** 展示昵称（缺省回退英文 role label）。 */
  nickname?: string;
}

export class FiveAgentPromptRegistry {
  /** 渲染某角色的内置 system prompt。 */
  static render(input: FiveAgentPromptInput): string {
    const roleLabel = FIVE_AGENT_ROLE_LABELS[input.role];
    const nickname = input.nickname?.trim() || roleLabel;
    return renderFiveAgentPrompt(input.role, { nickname, roleLabel });
  }

  /** 角色是否由内置五角色矩阵管理。 */
  static has(role: string): role is FiveAgentRole {
    return isFiveAgentRole(role);
  }
}

export { FIVE_AGENT_ROLES, isFiveAgentRole } from './roles.js';
export type { FiveAgentRole } from './roles.js';
export {
  asFiveAgentRole,
  filterToolNamesForRole,
  filterToolsForRole,
  isToolAllowedForRole,
} from './role-capability-policy.js';
