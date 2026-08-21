/**
 * 子 Agent 工具集：角色限制 + 编排黑名单 + AgentMeta disallowedTools。
 */
import type { AgentTool } from '@zhin.js/ai';
import type { ZhinAgentConfig } from '../config/index.js';
import type { AgentRole } from './role-configs.js';
import type { AgentMeta } from '../discovery/agents.js';
import { DEFAULT_SUBAGENT_TOOL_NAMES } from './tool-selection.js';

/** 仅主编排使用的工具，子 Agent 不可直接调用 */
export const SUBAGENT_BLOCKED_TOOL_NAMES = new Set<string>([
  'discover',
  'install_skill',
  'spawn_task',
  'tool_search',
  'run_deferred_task',
]);

const BLOCKED = SUBAGENT_BLOCKED_TOOL_NAMES;

/** 子 Agent 可用来按需加载 schema 的元工具 */
const SUBAGENT_DEFER_META_TOOLS = ['load_tool', 'load_skill'] as const;

export interface ResolveSubagentToolsParams {
  allTools: AgentTool[];
  task: string;
  role: AgentRole;
  config: Required<ZhinAgentConfig>;
  agentMeta?: AgentMeta;
  requestedTools?: string[];
  parentSessionLoaded?: string[];
}

function stripBlocked(tools: AgentTool[]): AgentTool[] {
  return tools.filter(t => !BLOCKED.has(t.name));
}

function applyDisallowedTools(pool: AgentTool[], meta?: AgentMeta): AgentTool[] {
  if (!meta?.disallowedTools?.length) return pool;
  const blocked = new Set(meta.disallowedTools);
  return pool.filter(t => !blocked.has(t.name));
}

function applyExplicitCapabilityBoundary(
  pool: AgentTool[],
  config: Required<ZhinAgentConfig>,
  meta?: AgentMeta,
): AgentTool[] {
  const configured = new Set([
    ...DEFAULT_SUBAGENT_TOOL_NAMES,
    ...config.subagentTools,
    ...SUBAGENT_DEFER_META_TOOLS,
  ]);
  const definition = meta?.toolNames?.length ? new Set(meta.toolNames) : null;
  return pool.filter(tool => configured.has(tool.name) && (!definition || definition.has(tool.name)));
}

function applySpawnDeclaredTools(
  pool: AgentTool[],
  requestedTools: string[] | undefined,
  parentSessionLoaded: string[] | undefined,
): AgentTool[] {
  if (!requestedTools?.length) return pool;
  const byNamePool = new Map(pool.map(t => [t.name, t]));
  const parentLoaded = new Set(parentSessionLoaded ?? []);
  const picked: AgentTool[] = [];
  for (const metaName of SUBAGENT_DEFER_META_TOOLS) {
    const tool = byNamePool.get(metaName);
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
 * Resolve the explicit subagent capability set. A display role is not an
 * authority source; Agent Definition deny rules and parent-declared tools are.
 */
export function resolveSubagentAgentTools(params: ResolveSubagentToolsParams): AgentTool[] {
  let pool = stripBlocked(params.allTools);
  pool = applyExplicitCapabilityBoundary(pool, params.config, params.agentMeta);
  pool = applyDisallowedTools(pool, params.agentMeta);
  pool = applySpawnDeclaredTools(pool, params.requestedTools, params.parentSessionLoaded);
  return pool;
}
