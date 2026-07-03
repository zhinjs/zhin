/**
 * 子 Agent 工具集：角色限制 + 编排黑名单 + AgentMeta disallowedTools。
 */
import type { AgentTool } from '@zhin.js/ai';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import type { AgentDispatcher, AgentRole } from './agent-dispatcher.js';
import type { AgentMeta } from '../discovery/agents.js';

/** 仅主编排使用的工具，子 Agent 不可直接调用 */
export const SUBAGENT_BLOCKED_TOOL_NAMES = new Set<string>([
  'activate_skill',
  'install_skill',
  'spawn_task',
]);

const BLOCKED = SUBAGENT_BLOCKED_TOOL_NAMES;

export interface ResolveSubagentToolsParams {
  allTools: AgentTool[];
  task: string;
  role: AgentRole;
  config: Required<ZhinAgentConfig>;
  agentDispatcher: AgentDispatcher | null;
  agentMeta?: AgentMeta;
}

function stripBlocked(tools: AgentTool[]): AgentTool[] {
  return tools.filter(t => !BLOCKED.has(t.name));
}

function applyRoleFilter(
  pool: AgentTool[],
  role: AgentRole,
  agentDispatcher: AgentDispatcher | null,
): AgentTool[] {
  if (agentDispatcher) {
    return agentDispatcher.filterToolsByRole(pool, role);
  }
  return pool;
}

function applyDisallowedTools(pool: AgentTool[], meta?: AgentMeta): AgentTool[] {
  if (!meta?.disallowedTools?.length) return pool;
  const blocked = new Set(meta.disallowedTools);
  return pool.filter(t => !blocked.has(t.name));
}

/**
 * 解析子 Agent 本轮可用工具（角色 ACL + disallowedTools 黑名单过滤）。
 */
export function resolveSubagentAgentTools(params: ResolveSubagentToolsParams): AgentTool[] {
  let pool = stripBlocked(params.allTools);
  pool = applyRoleFilter(pool, params.role, params.agentDispatcher);
  pool = applyDisallowedTools(pool, params.agentMeta);
  return pool;
}
