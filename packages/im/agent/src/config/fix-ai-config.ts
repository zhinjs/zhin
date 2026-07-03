import type { AIConfig } from '@zhin.js/ai';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';
import { normalizeAiRoutingConfig } from './normalize-ai-config.js';

/**
 * 将旧版 ai 段归一化为当前 schema，并返回已应用的修复说明。
 */
export function applyAiConfigFixes(
  ai: AIConfig | Record<string, unknown> | undefined,
): { ai: Record<string, unknown> | undefined; fixes: string[] } {
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) {
    return { ai: ai as Record<string, unknown> | undefined, fixes: [] };
  }

  const fixes: string[] = [];
  const src = { ...ai } as AIConfig & Record<string, unknown>;
  const legacy = src as AIConfig & {
    routes?: Record<string, unknown>;
    defaultProvider?: string;
    agent?: Record<string, unknown>;
  };

  const hadRoutes = !!legacy.routes && Object.keys(legacy.routes).length > 0;
  const hadDefaultProvider = !!legacy.defaultProvider;
  const hadLegacyAgent = !!(legacy.agent?.chatModel || legacy.agent?.visionModel);
  const providers = src.providers;
  const hadDriver = providers && typeof providers === 'object' && !Array.isArray(providers)
    && Object.values(providers).some((p) => p && typeof p === 'object' && 'driver' in (p as object));

  const normalized = normalizeAiRoutingConfig(src);
  const agents = { ...normalized.agents };
  const zhin = agents[DEFAULT_ZHIN_AGENT_NAME];
  if (zhin && (zhin.priority != null || zhin.match)) {
    const { priority: _p, match: _m, ...rest } = zhin;
    agents[DEFAULT_ZHIN_AGENT_NAME] = rest;
    fixes.push(`removed ai.agents.${DEFAULT_ZHIN_AGENT_NAME}.priority/match`);
  }

  const next: Record<string, unknown> = {
    ...src,
    providers: normalized.providers,
    agents,
  };

  if (hadRoutes) {
    delete next.routes;
    fixes.push('merged ai.routes into ai.agents and removed ai.routes');
  }
  if (hadDefaultProvider) {
    delete next.defaultProvider;
    fixes.push('migrated ai.defaultProvider into ai.agents.zhin');
  }
  if (legacy.agent) {
    delete next.agent;
    if (hadLegacyAgent) fixes.push('migrated ai.agent.chatModel into ai.agents.zhin');
  }

  for (const key of ['allowedTools', 'disabledTools', 'toolSearch'] as const) {
    if (key in next) {
      delete next[key];
      fixes.push(`removed deprecated ai.${key}`);
    }
  }

  // ADR 0024：剥离 agent.orchestratorTools 中已废弃的主编排/Missions 工具
  const DEPRECATED_ORCHESTRATOR_TOOLS = new Set([
    'tool_search',
    'run_deferred_task',
    'orchestration_start',
    'orchestration_add_task',
    'orchestration_status',
    'orchestration_complete',
    'orchestration_retry_task',
    'orchestration_skip_task',
    'orchestration_patch_state',
  ]);
  const agentSection = next.agent;
  if (agentSection && typeof agentSection === 'object' && !Array.isArray(agentSection)) {
    const agentObj = { ...(agentSection as Record<string, unknown>) };
    const tools = agentObj.orchestratorTools;
    if (Array.isArray(tools)) {
      const kept = tools.filter((t) => typeof t === 'string' && !DEPRECATED_ORCHESTRATOR_TOOLS.has(t));
      if (kept.length !== tools.length) {
        agentObj.orchestratorTools = kept;
        next.agent = agentObj;
        fixes.push('removed deprecated orchestratorTools (toolSearch/Missions) per ADR 0024');
      }
    }
  }

  if ('memoryMcp' in next) {
    delete next.memoryMcp;
    fixes.push('removed deprecated ai.memoryMcp');
  }

  if (hadDriver) fixes.push('migrated ai.providers.*.driver to sdk');

  const context = next.context;
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    const ctx = { ...(context as Record<string, unknown>) };
    if (ctx.maxMessagesBeforeSummary != null && ctx.summaryThreshold == null) {
      ctx.summaryThreshold = ctx.maxMessagesBeforeSummary;
      delete ctx.maxMessagesBeforeSummary;
      next.context = ctx;
      fixes.push('renamed ai.context.maxMessagesBeforeSummary to summaryThreshold');
    }
  }

  return { ai: next, fixes };
}
