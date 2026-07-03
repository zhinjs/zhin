import type { AIConfig, ProviderConfig } from '@zhin.js/ai';
import { isSdkId } from '@zhin.js/ai';
import type {
  AgentBindingConfig,
  PipelineRoleConfig,
  ProviderInstanceConfig,
  RouteEntryConfig,
} from './types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';
import { PIPELINE_ROLES } from '../collaboration/types.js';

const LEGACY_DRIVER_KEYS = new Set([
  'openai', 'anthropic', 'deepseek', 'moonshot', 'zhipu', 'google', 'gemini', 'ollama', 'cloudflare',
]);

/** Map legacy driver names to sdk ids (hard break: api/preset/spec are rejected). */
const DRIVER_TO_SDK: Record<string, ProviderInstanceConfig['sdk']> = {
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

function isNamedProviderShape(
  providers: AIConfig['providers'],
): providers is Record<string, ProviderInstanceConfig & { driver?: string; api?: string; preset?: string; spec?: string }> {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return false;
  const first = Object.values(providers)[0] as ProviderInstanceConfig | undefined;
  if (!first || typeof first !== 'object') return false;
  return 'sdk' in first || 'driver' in first || 'api' in first || 'preset' in first;
}

function inferSdkFromAlias(alias: string): ProviderInstanceConfig['sdk'] | undefined {
  const lower = alias.trim().toLowerCase();
  if (DRIVER_TO_SDK[lower]) return DRIVER_TO_SDK[lower];
  const head = lower.split(/[-_/]/)[0];
  if (head && DRIVER_TO_SDK[head]) return DRIVER_TO_SDK[head];
  return undefined;
}

/** Normalize provider entry to required `sdk` (ADR 0018). Rejects api/preset/spec. */
export function normalizeProviderEntry(
  alias: string,
  cfg: ProviderInstanceConfig & { driver?: string; api?: string; preset?: string; spec?: string },
): ProviderInstanceConfig {
  if (cfg.api?.trim() || cfg.preset?.trim() || cfg.spec?.trim()) {
    throw new Error(
      `ai.providers.${alias}: "api", "preset", and "spec" are removed; use "sdk" instead (ADR 0018)`,
    );
  }

  const legacyDriver = cfg.driver?.trim().toLowerCase();
  const sdkRaw = cfg.sdk?.trim().toLowerCase()
    || (legacyDriver ? DRIVER_TO_SDK[legacyDriver] : undefined)
    || inferSdkFromAlias(alias);

  if (!sdkRaw || !isSdkId(sdkRaw)) {
    throw new Error(
      `ai.providers.${alias}: sdk is required (openai | anthropic | google | deepseek | ollama | openai-compatible)`,
    );
  }

  const rest = { ...cfg } as Record<string, unknown>;
  delete rest.driver;
  delete rest.api;
  delete rest.preset;
  delete rest.spec;
  const normalized = { ...(rest as unknown as ProviderInstanceConfig), sdk: sdkRaw };
  if (typeof normalized.apiKey === 'string') normalized.apiKey = normalized.apiKey.trim();
  if (typeof normalized.baseUrl === 'string') normalized.baseUrl = normalized.baseUrl.trim();
  if (typeof normalized.host === 'string') normalized.host = normalized.host.trim();
  return normalized;
}

function normalizeLegacyProviders(
  legacy: NonNullable<AIConfig['providers']>,
): Record<string, ProviderInstanceConfig> {
  const out: Record<string, ProviderInstanceConfig> = {};
  for (const [key, cfg] of Object.entries(legacy)) {
    if (key === 'custom' || !cfg || typeof cfg !== 'object') continue;
    if (LEGACY_DRIVER_KEYS.has(key)) {
      out[key] = normalizeProviderEntry(key, {
        ...(cfg as ProviderConfig),
        sdk: DRIVER_TO_SDK[key]!,
      });
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
  pipeline: Record<string, PipelineRoleConfig>;
}

function normalizePipelineConfig(raw: unknown): Record<string, PipelineRoleConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, PipelineRoleConfig> = {};
  for (const role of PIPELINE_ROLES) {
    const entry = src[role];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const cfg: PipelineRoleConfig = {};
    if (typeof e.nickname === 'string') cfg.nickname = e.nickname;
    if (typeof e.provider === 'string') cfg.provider = e.provider;
    if (typeof e.model === 'string') cfg.model = e.model;
    if (Array.isArray(e.mcpServers)) cfg.mcpServers = e.mcpServers.filter((s): s is string => typeof s === 'string');
    out[role] = cfg;
  }
  return out;
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

  const pipeline = normalizePipelineConfig((ai as AIConfig & { pipeline?: unknown })?.pipeline);

  return { providers, agents, pipeline };
}
