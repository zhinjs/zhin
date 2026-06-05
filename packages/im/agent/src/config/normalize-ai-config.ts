import type { AIConfig, ProviderConfig } from '@zhin.js/core';
import type {
  AgentBindingConfig,
  ProviderInstanceConfig,
  RouteEntryConfig,
} from './types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';

const LEGACY_DRIVER_KEYS = new Set([
  'openai', 'anthropic', 'deepseek', 'moonshot', 'zhipu', 'google', 'gemini', 'ollama', 'cloudflare',
]);

function isNewProviderShape(
  providers: AIConfig['providers'],
): providers is Record<string, ProviderInstanceConfig> {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return false;
  const first = Object.values(providers)[0] as ProviderInstanceConfig | undefined;
  return Boolean(first && typeof first === 'object' && 'driver' in first);
}

function normalizeLegacyProviders(
  legacy: NonNullable<AIConfig['providers']>,
): Record<string, ProviderInstanceConfig> {
  const out: Record<string, ProviderInstanceConfig> = {};
  for (const [key, cfg] of Object.entries(legacy)) {
    if (key === 'custom' || !cfg || typeof cfg !== 'object') continue;
    if (LEGACY_DRIVER_KEYS.has(key)) {
      out[key] = { driver: key, ...(cfg as ProviderConfig) };
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
  const providers = isNewProviderShape(ai?.providers)
    ? (ai!.providers as Record<string, ProviderInstanceConfig>)
    : normalizeLegacyProviders(ai?.providers ?? {});

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
