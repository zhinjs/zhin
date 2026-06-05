/**
 * 子 Agent 工具集：TF-IDF 载入 + 角色限制 + 编排黑名单。
 */
import type { AgentTool } from '@zhin.js/ai';
import { selectDeferredToolsForWorker } from '../deferred-worker-tool-load.js';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import { filterToolsForToolSearchCatalog } from '../zhin-agent/tool-catalog.js';
import { TOOL_SEARCH_EXCLUDED_TOOLS } from '../zhin-agent/config.js';
import type { AgentDispatcher, AgentRole } from './agent-dispatcher.js';

/** 仅主编排使用的工具，子 Agent 不可直接调用 */
export const SUBAGENT_BLOCKED_TOOL_NAMES = new Set<string>([
  ...TOOL_SEARCH_EXCLUDED_TOOLS,
  'tool_search',
  'run_deferred_task',
  'spawn_task',
]);

const BLOCKED = SUBAGENT_BLOCKED_TOOL_NAMES;

/** 文生图任务：即使 TF-IDF 未命中也优先载入 generate_image（须在 allTools 中已注册） */
const IMAGE_GENERATION_TASK_RE =
  /generate_image|文生图|生图|画图|画一|画张|绘制|text-to-image|\bdraw\b/i;

export interface ResolveSubagentToolsParams {
  allTools: AgentTool[];
  task: string;
  role: AgentRole;
  config: Required<ZhinAgentConfig>;
  agentDispatcher: AgentDispatcher | null;
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

/**
 * 解析子 Agent 本轮可用工具（始终 toolSearch：worker 基础 + TF-IDF 匹配 deferred 目录）。
 */
export function resolveSubagentAgentTools(params: ResolveSubagentToolsParams): AgentTool[] {
  let pool = stripBlocked(params.allTools);
  pool = applyRoleFilter(pool, params.role, params.agentDispatcher);

  const catalog = filterToolsForToolSearchCatalog(pool);
  const max = params.config.deferredToolMaxResults;
  const query = params.task.trim() || 'task';
  const loaded = selectDeferredToolsForWorker(query, query, catalog, max);
  const byName = new Map(pool.map(t => [t.name, t]));
  const out: AgentTool[] = [];
  const seen = new Set<string>();
  const add = (tool: AgentTool | undefined) => {
    if (!tool || seen.has(tool.name) || BLOCKED.has(tool.name)) return;
    out.push(tool);
    seen.add(tool.name);
  };
  for (const name of params.config.workerBaseTools) {
    add(byName.get(name));
  }
  for (const tool of loaded) add(tool);
  if (IMAGE_GENERATION_TASK_RE.test(query)) {
    add(byName.get('generate_image'));
  }
  return out;
}
