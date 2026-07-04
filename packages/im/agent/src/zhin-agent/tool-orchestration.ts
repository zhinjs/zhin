import type { AgentTool, LlmTool } from '@zhin.js/ai';
import { agentToolToLlmTool } from '../tool-bridge.js';
import {
  getLoadedToolNamesFromSnapshot,
  addSkillToSnapshot,
  touchToolsInSnapshot,
  type DeferredToolSessionSnapshot,
} from '@zhin.js/ai';
import type { Message } from '../orchestrator/types.js';
import {
  buildDeferredStats,
  buildToolCatalog,
  resolveDeferredApiTools,
} from '../tool-catalog/tool-catalog.js';
import type { ToolCatalogItem } from '../tool-catalog/types.js';
import { resolveDeferredToolsConfig } from '../tool-catalog/resolve-config.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

export interface ResolvedToolsForTurn {
  tools: AgentTool[];
  catalog: ToolCatalogItem[];
  deferred: true;
  deferredStats?: string;
  sessionSnapshot: DeferredToolSessionSnapshot;
}

function buildMcpServerMap(tools: AgentTool[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tool of tools) {
    const src = tool.source ?? '';
    const mcpMatch = /^mcp:([^:]+)/.exec(src);
    if (mcpMatch) {
      map.set(tool.name, mcpMatch[1]!);
      continue;
    }
    const prefixMatch = /^mcp_([^_]+)_/.exec(tool.name);
    if (prefixMatch) {
      map.set(tool.name, prefixMatch[1]!);
    }
  }
  return map;
}

export async function resolveAgentToolsForTurn(
  agent: ZhinAgentPrivate,
  allTools: AgentTool[],
  sessionId: string,
  _commMessage?: Message,
): Promise<ResolvedToolsForTurn> {
  const deferredCfg = resolveDeferredToolsConfig(agent.config);
  const alwaysLoaded = new Set(deferredCfg.alwaysLoadedTools);
  const mcpServerByTool = buildMcpServerMap(allTools);

  const catalog = buildToolCatalog({
    tools: allTools,
    mcpServerByTool,
    alwaysLoaded,
  });

  let sessionSnapshot = await agent.contextRepository.getDeferredToolSnapshot(sessionId);
  if (agent.skillRegistry?.getAlwaysSkills) {
    let touched = false;
    for (const skill of agent.skillRegistry.getAlwaysSkills()) {
      sessionSnapshot = addSkillToSnapshot(sessionSnapshot, skill.name);
      sessionSnapshot = touchToolsInSnapshot(
        sessionSnapshot,
        skill.tools.map(t => t.name),
        deferredCfg.maxLoadedPerSession,
      );
      touched = true;
    }
    if (touched) {
      await persistDeferredToolSnapshot(agent, sessionId, sessionSnapshot);
    }
  }
  const sessionLoaded = getLoadedToolNamesFromSnapshot(sessionSnapshot);
  const apiTools = resolveDeferredApiTools(catalog, alwaysLoaded, sessionLoaded);
  const deferredStats = buildDeferredStats(catalog, apiTools);

  agent.deferredCatalog = catalog.map(c => c.fullTool);

  return {
    tools: apiTools,
    catalog,
    deferred: true,
    deferredStats,
    sessionSnapshot,
  };
}

export async function persistDeferredToolSnapshot(
  agent: ZhinAgentPrivate,
  sessionId: string,
  snapshot: DeferredToolSessionSnapshot,
): Promise<void> {
  await agent.contextRepository.setDeferredToolSnapshot(sessionId, snapshot);
}

export function buildLlmToolsForProvider(
  sdk: string | undefined,
  catalog: ToolCatalogItem[],
  apiTools: AgentTool[],
  alwaysLoaded: Set<string>,
  sessionLoadedNames: string[],
): LlmTool[] {
  const loaded = new Set([...alwaysLoaded, ...sessionLoadedNames]);
  if (sdk === 'anthropic') {
    return catalog
      .filter(item => item.source !== 'meta')
      .map(item => ({
        ...agentToolToLlmTool(item.fullTool),
        deferLoading: !loaded.has(item.name),
      }));
  }
  return apiTools.map(t => agentToolToLlmTool(t));
}
