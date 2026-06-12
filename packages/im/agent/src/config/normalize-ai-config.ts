import type { AIConfig, ProviderConfig } from '@zhin.js/ai';
import { driverToModelApi } from '@zhin.js/ai';
import type {
  AgentBindingConfig,
  ProviderInstanceConfig,
  RouteEntryConfig,
} from './types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';

const LEGACY_DRIVER_KEYS = new Set([
  'openai', 'anthropic', 'deepseek', 'moonshot', 'zhipu', 'google', 'gemini', 'ollama', 'cloudflare',
]);

function isNamedProviderShape(
  providers: AIConfig['providers'],
): providers is Record<string, ProviderInstanceConfig & { driver?: string }> {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return false;
  const first = Object.values(providers)[0] as (ProviderInstanceConfig & { driver?: string }) | undefined;
  if (!first || typeof first !== 'object') return false;
  return 'api' in first || 'driver' in first;
}

/** Normalize legacy `driver` → required `api` (ADR 0009 D1). */
export function normalizeProviderEntry(
  alias: string,
  cfg: ProviderInstanceConfig & { driver?: string },
): ProviderInstanceConfig {
  const legacyDriver = cfg.driver?.trim().toLowerCase();
  const api = cfg.api?.trim() || (legacyDriver ? driverToModelApi(legacyDriver) : driverToModelApi(alias));
  const { driver: _driver, ...rest } = cfg;
  return { ...rest, api };
}

function normalizeLegacyProviders(
  legacy: NonNullable<AIConfig['providers']>,
): Record<string, ProviderInstanceConfig> {
  const out: Record<string, ProviderInstanceConfig> = {};
  for (const [key, cfg] of Object.entries(legacy)) {
    if (key === 'custom' || !cfg || typeof cfg !== 'object') continue;
    if (LEGACY_DRIVER_KEYS.has(key)) {
      out[key] = normalizeProviderEntry(key, { ...(cfg as ProviderConfig), api: driverToModelApi(key) });
    }
  }
  return out;
}

function mergeLegacyRoutesIntoAgents(
  agents: Record<string, AgentBindingConfig>,
  routes: Record<string, RouteEntryConfig>,
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

export interface NormalizedAiRoutingConfig {
  providers: Record<string, ProviderInstanceConfig>;
  agents: Record<string, AgentBindingConfig>;
}

/**
 * 解析 ai.providers / agents；兼容旧版 providers.<driver> 与顶层 ai.routes。
 */
export function normalizeAiRoutingConfig(ai: AIConfig | undefined): NormalizedAiRoutingConfig {
  let providers: Record<string, ProviderInstanceConfig>;

  if (isNamedProviderShape(ai?.providers)) {
    providers = {};
    for (const [alias, cfg] of Object.entries(ai!.providers as Record<string, ProviderInstanceConfig & { driver?: string }>)) {
      providers[alias] = normalizeProviderEntry(alias, cfg);
    }
  } else {
    providers = normalizeLegacyProviders(ai?.providers ?? {});
  }

  const agents = { ...((ai as AIConfig & { agents?: Record<string, AgentBindingConfig> })?.agents ?? {}) };
  const legacyRoutes = (ai as AIConfig & { routes?: Record<string, RouteEntryConfig> })?.routes ?? {};
  mergeLegacyRoutesIntoAgents(agents, legacyRoutes);

  if (!agents[DEFAULT_ZHIN_AGENT_NAME] && (ai as AIConfig & { agent?: { chatModel?: string } })?.agent) {
    const legacy = ai as AIConfig & { defaultProvider?: string; agent?: { chatModel?: string } };
    const providerAlias = legacy.defaultProvider || Object.keys(providers)[0] || 'openai';
    const model = legacy.agent?.chatModel || '';
    agents[DEFAULT_ZHIN_AGENT_NAME] = {
      provider: providerAlias,
      model,
    };
  }

  return { providers, agents };
}
