/**
 * Deferred 工具目录统计（D1 prompt 用）
 */
import type { AgentTool } from '@zhin.js/ai';
import { TOOL_SEARCH_EXCLUDED_TOOLS } from './config.js';

const EXCLUDED_FROM_TOOL_SEARCH = new Set<string>(TOOL_SEARCH_EXCLUDED_TOOLS);

/** toolSearch 分区前去掉仅用于经典路径的技能工具 */
export function filterToolsForToolSearchCatalog(allTools: AgentTool[]): AgentTool[] {
  return allTools.filter(t => !EXCLUDED_FROM_TOOL_SEARCH.has(t.name));
}

function domainForToolName(name: string): string {
  if (name.startsWith('mcp_')) return 'mcp';
  if (name.startsWith('github_')) return 'github';
  if (name.startsWith('cron_')) return 'cron';
  return 'other';
}

export function summarizeDeferredDomains(deferred: AgentTool[]): string {
  const counts = new Map<string, number>();
  for (const tool of deferred) {
    const domain = domainForToolName(tool.name);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => `${domain}(${count})`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

export interface ToolSearchPartition {
  orchestrator: AgentTool[];
  deferred: AgentTool[];
  domainStats: string;
}

/** 按常驻名拆分；未在 orchestrator 列表中的工具归入 deferred */
export function partitionToolsForToolSearch(
  allTools: AgentTool[],
  orchestratorNames: readonly string[],
): ToolSearchPartition {
  const orchSet = new Set(orchestratorNames.map(n => n.toLowerCase()));
  const orchestrator: AgentTool[] = [];
  const deferred: AgentTool[] = [];
  const seenOrch = new Set<string>();

  for (const tool of allTools) {
    const key = tool.name.toLowerCase();
    if (orchSet.has(key)) {
      if (!seenOrch.has(key)) {
        orchestrator.push(tool);
        seenOrch.add(key);
      }
    } else if (!EXCLUDED_FROM_TOOL_SEARCH.has(tool.name)) {
      deferred.push(tool);
    }
  }

  // 常驻工具若未出现在 allTools 中，由调用方补注册
  return {
    orchestrator,
    deferred,
    domainStats: summarizeDeferredDomains(deferred),
  };
}
