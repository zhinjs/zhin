import type { AIConfig, ProviderConfig } from '@zhin.js/ai';
import { type AgentBindingConfig, DEFAULT_ZHIN_AGENT_NAME } from './types.js';
import { normalizeAiRoutingConfig } from './normalize-ai-config.js';
type LegacyRouteEntry = { priority: number; match: AgentBindingConfig['match'] };

/**
 * 旧 driver 名 → sdk 的迁移映射（一次性升级专用；运行时 normalize 不再识别
 * driver，直接硬报错）。
 */
const LEGACY_DRIVER_TO_SDK: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  moonshot: 'openai-compatible',
  zhipu: 'openai-compatible',
  google: 'google',
  gemini: 'google',
  ollama: 'ollama',
  cloudflare: 'openai-compatible',
};

/** providers 段的 driver 字段 / 旧平铺写法（key 即 driver、无 sdk）→ 显式 sdk。 */
function migrateLegacyProviderDrivers(
  providers: unknown,
): { providers: Record<string, unknown>; migrated: boolean } {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    return { providers: providers as Record<string, unknown>, migrated: false };
  }
  const out: Record<string, unknown> = {};
  let migrated = false;
  for (const [alias, entry] of Object.entries(providers as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') {
      out[alias] = entry;
      continue;
    }
    const record = { ...(entry as Record<string, unknown>) };
    const driver = typeof record.driver === 'string' ? record.driver.trim().toLowerCase() : '';
    if (driver) {
      delete record.driver;
      if (typeof record.sdk !== 'string' || !record.sdk.trim()) {
        record.sdk = LEGACY_DRIVER_TO_SDK[driver] ?? driver;
      }
      migrated = true;
    } else if (
      (typeof record.sdk !== 'string' || !record.sdk.trim())
      && LEGACY_DRIVER_TO_SDK[alias.trim().toLowerCase()]
    ) {
      // 旧平铺写法：providers: { openai: { apiKey } }（key 即 driver）
      record.sdk = LEGACY_DRIVER_TO_SDK[alias.trim().toLowerCase()];
      migrated = true;
    }
    out[alias] = record;
  }
  return { providers: out, migrated };
}

function mergeLegacyRoutesIntoAgents(
  agents: Record<string, AgentBindingConfig>,
  routes: Record<string, LegacyRouteEntry>,
): void {
  for (const [name, route] of Object.entries(routes)) {
    const existing = agents[name];
    if (!existing) continue;
    agents[name] = {
      ...existing,
      priority: existing.priority ?? route.priority,
      match: existing.match ?? route.match,
    };
  }
}

/**
 * 将旧版 ai 段归一化为当前 schema，并返回已应用的修复说明。
 * 仅用于 `zhin setup` 一次性升级；运行时 `normalizeAiRoutingConfig` 拒绝未迁移字段。
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
    routes?: Record<string, LegacyRouteEntry>;
    defaultProvider?: string;
    agent?: Record<string, unknown>;
  };

  const hadRoutes = !!legacy.routes && Object.keys(legacy.routes).length > 0;
  const hadDefaultProvider = !!legacy.defaultProvider;
  const hadLegacyAgent = !!(legacy.agent?.chatModel || legacy.agent?.visionModel);
  // driver 字段 / 旧平铺 providers 真正重写为显式 sdk（运行时 normalize 硬拒绝旧形态）
  const driverMigration = migrateLegacyProviderDrivers(src.providers);
  if (driverMigration.migrated) {
    src.providers = driverMigration.providers as AIConfig['providers'];
  }
  const providers = src.providers;

  const agents = {
    ...((src as AIConfig & { agents?: Record<string, AgentBindingConfig> }).agents ?? {}),
  } as Record<string, AgentBindingConfig>;

  if (hadRoutes) {
    mergeLegacyRoutesIntoAgents(agents, legacy.routes!);
    fixes.push('merged ai.routes into ai.agents and removed ai.routes');
  }
  // Synthesize the canonical zhin binding from legacy provider fields.
  if (hadDefaultProvider || hadLegacyAgent) {
    const providerAlias = legacy.defaultProvider
      || agents[DEFAULT_ZHIN_AGENT_NAME]?.provider
      || Object.keys((providers ?? {}) as Record<string, ProviderConfig>)[0]
      || 'openai';
    const model = (typeof legacy.agent?.chatModel === 'string' ? legacy.agent.chatModel : undefined)
      || agents[DEFAULT_ZHIN_AGENT_NAME]?.model
      || '';
    agents[DEFAULT_ZHIN_AGENT_NAME] = {
      ...agents[DEFAULT_ZHIN_AGENT_NAME],
      provider: agents[DEFAULT_ZHIN_AGENT_NAME]?.provider ?? providerAlias,
      model: agents[DEFAULT_ZHIN_AGENT_NAME]?.model || model,
    };
    if (hadDefaultProvider) fixes.push('migrated ai.defaultProvider into ai.agents.zhin');
    if (hadLegacyAgent) fixes.push('migrated ai.agent.chatModel into ai.agents.zhin');
  }
  const preNormalized = {
    ...src,
    agents,
  } as AIConfig;
  delete (preNormalized as Record<string, unknown>).routes;
  delete (preNormalized as Record<string, unknown>).defaultProvider;
  if (preNormalized.agent && typeof preNormalized.agent === 'object') {
    const agentSection = { ...(preNormalized.agent as Record<string, unknown>) };
    delete agentSection.chatModel;
    delete agentSection.visionModel;
    if (Object.keys(agentSection).length > 0) {
      preNormalized.agent = agentSection as AIConfig['agent'];
    } else {
      delete preNormalized.agent;
    }
  }

  const normalized = normalizeAiRoutingConfig(preNormalized);
  const nextAgents = { ...normalized.agents };
  const zhin = nextAgents[DEFAULT_ZHIN_AGENT_NAME];
  if (zhin && (zhin.priority != null || zhin.match)) {
    const { priority: _p, match: _m, ...rest } = zhin;
    nextAgents[DEFAULT_ZHIN_AGENT_NAME] = rest;
    fixes.push(`removed ai.agents.${DEFAULT_ZHIN_AGENT_NAME}.priority/match`);
  }

  const next: Record<string, unknown> = {
    ...preNormalized,
    providers: normalized.providers,
    agents: nextAgents,
  };

  const migratedAgent = migrateAgentDeferredSection(src.agent);
  if (migratedAgent.section) {
    next.agent = migratedAgent.section;
    fixes.push(...migratedAgent.fixes);
  }

  if (legacy.agent) {
    delete next.agent;
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

  if (driverMigration.migrated) fixes.push('migrated ai.providers.*.driver to sdk');

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
