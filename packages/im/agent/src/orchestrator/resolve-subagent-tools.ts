/**
 * 子 Agent 工具集：角色限制 + 编排黑名单 + AgentMeta disallowedTools。
 */
import type { AgentTool } from '@zhin.js/ai';
import type { ZhinAgentConfig } from '../config/index.js';
import type { AgentDispatcher, AgentRole } from './agent-dispatcher.js';
import type { AgentMeta } from '../discovery/agents.js';

/** 仅主编排使用的工具，子 Agent 不可直接调用 */
export const SUBAGENT_BLOCKED_TOOL_NAMES = new Set<string>([
  'discover',
  'install_skill',
  'spawn_task',
]);

const BLOCKED = SUBAGENT_BLOCKED_TOOL_NAMES;

/** 子 Agent 可用来按需加载 schema 的元工具 */
const SUBAGENT_DEFER_META_TOOLS = ['load_tool', 'load_skill'] as const;

export interface ResolveSubagentToolsParams {
  allTools: AgentTool[];
  task: string;
  role: AgentRole;
  config: Required<ZhinAgentConfig>;
  agentDispatcher: AgentDispatcher | null;
  agentMeta?: AgentMeta;
  requestedTools?: string[];
  parentSessionLoaded?: string[];
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

function applySpawnDeclaredTools(
  allTools: AgentTool[],
  pool: AgentTool[],
  requestedTools: string[] | undefined,
  parentSessionLoaded: string[] | undefined,
): AgentTool[] {
  if (!requestedTools?.length) return pool;
  const stripped = stripBlocked(allTools);
  const byNameAll = new Map(stripped.map(t => [t.name, t]));
  const byNamePool = new Map(pool.map(t => [t.name, t]));
  const parentLoaded = new Set(parentSessionLoaded ?? []);
  const picked: AgentTool[] = [];
  for (const metaName of SUBAGENT_DEFER_META_TOOLS) {
    const tool = byNameAll.get(metaName);
    if (tool) picked.push(tool);
  }
  for (const name of requestedTools) {
    if (!parentLoaded.has(name)) continue;
    const tool = byNamePool.get(name);
    if (tool) picked.push(tool);
  }
  return picked;
}

/**
 * 解析子 Agent 本轮可用工具（角色 ACL + disallowedTools 黑名单过滤）。
 */
export function resolveSubagentAgentTools(params: ResolveSubagentToolsParams): AgentTool[] {
  let pool = stripBlocked(params.allTools);
  pool = applyRoleFilter(pool, params.role, params.agentDispatcher);
  pool = applyDisallowedTools(pool, params.agentMeta);
  pool = applySpawnDeclaredTools(params.allTools, pool, params.requestedTools, params.parentSessionLoaded);
  return pool;
}
