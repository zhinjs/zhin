/**
 * toolSearch 模式下组装主编排 Agent 工具集
 */
import type { AgentTool } from '@zhin.js/ai';
import { createRunDeferredTaskTool } from '../builtin/run-deferred-task-tool.js';
import { createSpawnTaskTool } from '../builtin/spawn-task-tool.js';
import { createToolSearchTool } from '../builtin/tool-search-tool.js';
import { normalizeTool } from '../orchestrator/tool-selection.js';
import type { SubagentManager } from '../subagent.js';
import type { ToolContext } from '../orchestrator/types.js';
import type { ZhinAgentConfig } from './config.js';
import { resolveDeferredTaskToolTimeout } from './config.js';
import { filterToolsForToolSearchCatalog, partitionToolsForToolSearch } from './tool-catalog.js';

/** toolSearch 主编排：压缩 activate_skill 回执，避免长工具列表占满主会话 */
export function wrapActivateSkillForToolSearch(tool: AgentTool): AgentTool {
  const inner = tool.execute;
  if (!inner) return tool;
  return {
    ...tool,
    description:
      `${tool.description}（toolSearch：仅返回技能要点与建议 tool_query；执行须 run_deferred_task。）`,
    execute: async (args: Record<string, unknown>) => {
      const raw = await inner(args);
      const text = typeof raw === 'string' ? raw : String(raw);
      if (text.startsWith('Error:') || text.includes('not found')) return text;
      return compactActivateSkillResultForToolSearch(text);
    },
  };
}

const ORCHESTRATOR_SKILL_HINTS: Record<string, { toolQuery: string; note: string }> = {
  icqq: {
    toolQuery: 'mcp_icqq_icqq_invoke icqq_send_user_like friend_like',
    note: 'QQ/icqq：优先 mcp_icqq_icqq_invoke(action=friend_like) 或 icqq_send_user_like；勿用 filesystem MCP。',
  },
};

export function compactActivateSkillResultForToolSearch(full: string): string {
  const nameMatch = full.match(/Skill '([^']+)'/);
  const name = nameMatch?.[1] ?? 'skill';
  const toolsBlock = full.match(/tools:\s*\n((?:\s+-\s+.+\n?)+)/);
  const toolNames = toolsBlock
    ? [...toolsBlock[1].matchAll(/^\s+-\s+(\S+)/gm)].map(m => m[1])
    : [];
  const skillHint = ORCHESTRATOR_SKILL_HINTS[name];
  const lines = [
    `Skill '${name}' (orchestrator). Deferred tools run only via run_deferred_task.`,
  ];
  if (skillHint) {
    lines.push(skillHint.note);
    lines.push(`Suggested tool_query: ${skillHint.toolQuery}.`);
  } else if (toolNames.length > 0) {
    const hint = toolNames.slice(0, 8).join(', ');
    lines.push(`Suggested tool_query: ${hint}${toolNames.length > 8 ? ', …' : ''}.`);
  }
  const rules = full.match(/## (?:执行规则|快速操作|Quick\s*Actions)[\s\S]*?(?=\n## [^\s]|$)/i);
  if (rules) {
    const chunk = rules[0].trim();
    lines.push(chunk.length > 400 ? `${chunk.slice(0, 400)}\n…` : chunk);
  }
  lines.push('Next: run_deferred_task(goal=user request, tool_query as above). Do not call activate_skill again.');
  return lines.join('\n\n');
}

export interface BuildOrchestratorToolsParams {
  allTools: AgentTool[];
  config: Required<ZhinAgentConfig>;
  context: ToolContext;
  getDeferredCatalog: () => AgentTool[];
  runWorker: (goal: string, toolQuery?: string) => Promise<string>;
  /** 注入常驻 `spawn_task`；未初始化 SubagentManager 时跳过 */
  subagentManager?: SubagentManager | null;
}

export interface BuildOrchestratorToolsResult {
  orchestratorTools: AgentTool[];
  deferred: AgentTool[];
  domainStats: string;
}

export function buildOrchestratorAgentTools(params: BuildOrchestratorToolsParams): BuildOrchestratorToolsResult {
  const { allTools, config, context, getDeferredCatalog, runWorker } = params;
  const catalog = filterToolsForToolSearchCatalog(allTools);
  const part = partitionToolsForToolSearch(catalog, config.orchestratorTools);
  const byName = new Map<string, AgentTool>();

  for (const tool of part.orchestrator) {
    byName.set(tool.name, normalizeTool(tool, context));
  }

  byName.set(
    'tool_search',
    normalizeTool(
      createToolSearchTool({
        getDeferredCatalog,
        maxResults: config.deferredToolMaxResults,
      }),
      context,
    ),
  );
  const runDeferred = normalizeTool(
    createRunDeferredTaskTool({
      runWorker,
      timeoutMs: resolveDeferredTaskToolTimeout(config),
    }),
    context,
  );
  byName.set('run_deferred_task', runDeferred);

  if (
    params.subagentManager
    && params.config.orchestratorTools.includes('spawn_task')
  ) {
    byName.set(
      'spawn_task',
      normalizeTool(createSpawnTaskTool(context, params.subagentManager), context),
    );
  }

  const orchestratorTools: AgentTool[] = [];
  for (const name of config.orchestratorTools) {
    let tool = byName.get(name);
    if (!tool) continue;
    if (name === 'activate_skill') {
      tool = wrapActivateSkillForToolSearch(tool);
    }
    orchestratorTools.push(tool);
  }

  return {
    orchestratorTools,
    deferred: part.deferred,
    domainStats: part.domainStats,
  };
}
