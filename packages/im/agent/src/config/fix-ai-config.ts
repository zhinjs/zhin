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
  const hadPipeline = !!(legacy as AIConfig & { pipeline?: unknown }).pipeline
    && typeof (legacy as AIConfig & { pipeline?: unknown }).pipeline === 'object'
    && Object.keys((legacy as AIConfig & { pipeline?: Record<string, unknown> }).pipeline ?? {}).length > 0;
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

  const migratedAgent = migrateAgentDeferredSection(src.agent);
  if (migratedAgent.section) {
    next.agent = migratedAgent.section;
    fixes.push(...migratedAgent.fixes);
  }

  if (hadRoutes) {
    delete next.routes;
    fixes.push('merged ai.routes into ai.agents and removed ai.routes');
  }
  if (hadPipeline) {
    delete next.pipeline;
    fixes.push('merged ai.pipeline into ai.agents and removed ai.pipeline');
  }
  if (hadDefaultProvider) {
    delete next.defaultProvider;
    fixes.push('migrated ai.defaultProvider into ai.agents.zhin');
  }
  if (legacy.agent) {
    delete next.agent;
    if (hadLegacyAgent) fixes.push('migrated ai.agent.chatModel into ai.agents.zhin');
    if (migratedAgent.section) {
      next.agent = migratedAgent.section;
    }
  }

  for (const key of ['allowedTools', 'disabledTools', 'toolSearch'] as const) {
    if (key in next) {
      delete next[key];
      fixes.push(`removed deprecated ai.${key}`);
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

const DEPRECATED_ORCHESTRATOR_TOOLS = new Set([
  'tool_search',
  'run_deferred_task',
  'activate_skill',
  'orchestration_start',
  'orchestration_add_task',
  'orchestration_status',
  'orchestration_complete',
  'orchestration_retry_task',
  'orchestration_skip_task',
]);

function migrateAgentDeferredSection(
  agentSection: unknown,
): { section?: Record<string, unknown>; fixes: string[] } {
  const fixes: string[] = [];
  if (!agentSection || typeof agentSection !== 'object' || Array.isArray(agentSection)) {
    return { fixes };
  }
  const agentObj = { ...(agentSection as Record<string, unknown>) };
  let changed = false;
  const tools = agentObj.orchestratorTools;
  if (Array.isArray(tools)) {
    const migrated = tools
      .filter((t): t is string => typeof t === 'string')
      .map(t => (t === 'activate_skill' ? 'load_skill' : t))
      .filter(t => !DEPRECATED_ORCHESTRATOR_TOOLS.has(t));
    const unique = [...new Set(migrated)];
    if (unique.length !== tools.length || tools.some(t => t === 'activate_skill')) {
      delete agentObj.orchestratorTools;
      const dt = (agentObj.deferredTools && typeof agentObj.deferredTools === 'object'
        ? { ...(agentObj.deferredTools as Record<string, unknown>) }
        : {}) as Record<string, unknown>;
      if (!dt.alwaysLoadedTools) {
        dt.alwaysLoadedTools = unique;
      }
      agentObj.deferredTools = dt;
      fixes.push('migrated agent.orchestratorTools → agent.deferredTools.alwaysLoadedTools (ADR 0029)');
      changed = true;
    }
  }
  const allowed = agentObj.allowedTools;
  if (Array.isArray(allowed) && allowed.includes('activate_skill')) {
    agentObj.allowedTools = allowed.map(t => (t === 'activate_skill' ? 'load_skill' : t));
    fixes.push('replaced activate_skill with load_skill in agent.allowedTools');
    changed = true;
  }
  return changed ? { section: agentObj, fixes } : { fixes };
}
