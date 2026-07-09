import { type AIConfig, type ProviderConfig, applyProviderGatewayPreset, isSdkId, validateProviderGatewayConfig } from '@zhin.js/ai';
import type {
  AgentBindingConfig,
  ProviderInstanceConfig,
} from './types.js';
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
  const entries = Object.entries(providers);
  if (entries.length === 0) return false;
  // Legacy flat shape: keys are driver ids (openai, anthropic, …)
  if (entries.every(([key]) => LEGACY_DRIVER_KEYS.has(key))) return false;
  return true;
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
  const sdkForPreset = (
    cfg.sdk?.trim().toLowerCase() as ProviderInstanceConfig['sdk'] | undefined
  )
    || (legacyDriver ? DRIVER_TO_SDK[legacyDriver] : undefined)
    || inferSdkFromAlias(alias)
    || 'openai-compatible';
  const presetHint = applyProviderGatewayPreset(alias, {
    sdk: sdkForPreset,
    baseUrl: cfg.baseUrl?.trim(),
    host: cfg.host?.trim(),
    apiKey: cfg.apiKey,
    contextWindow: cfg.contextWindow,
  });
  const sdkRaw = cfg.sdk?.trim().toLowerCase()
    || (legacyDriver ? DRIVER_TO_SDK[legacyDriver] : undefined)
    || inferSdkFromAlias(alias)
    || presetHint.sdk?.trim().toLowerCase();

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
  const withGateway = applyProviderGatewayPreset(alias, normalized);
  const warnings = validateProviderGatewayConfig(alias, normalized);
  if (warnings.length > 0 && process.env.ZHIN_PROVIDER_GATEWAY_WARN !== '0') {
    for (const w of warnings) {
      console.warn(`[ai.providers] ${w}`);
    }
  }
  return withGateway;
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

function rejectRemovedAiConfigFields(ai: AIConfig | undefined): void {
  const raw = ai as Record<string, unknown> | undefined;
  if (!raw) return;
  if (raw.routes && typeof raw.routes === 'object' && Object.keys(raw.routes as object).length > 0) {
    throw new Error('ai.routes removed; set ai.agents.<name>.priority and ai.agents.<name>.match');
  }
  if (raw.pipeline && typeof raw.pipeline === 'object' && Object.keys(raw.pipeline as object).length > 0) {
    throw new Error('ai.pipeline removed; use ai.agents.<role>');
  }
  if (typeof raw.defaultProvider === 'string' && raw.defaultProvider.trim()) {
    throw new Error('ai.defaultProvider removed; use ai.agents.zhin.provider');
  }
  const agent = raw.agent;
  if (agent && typeof agent === 'object' && !Array.isArray(agent)) {
    const legacyAgent = agent as Record<string, unknown>;
    if (typeof legacyAgent.chatModel === 'string' || typeof legacyAgent.visionModel === 'string') {
      throw new Error('ai.agent.chatModel/visionModel removed; use ai.agents.zhin.model');
    }
  }
}

export interface NormalizedAiRoutingConfig {
  providers: Record<string, ProviderInstanceConfig>;
  agents: Record<string, AgentBindingConfig>;
}

/**
 * 解析 ai.providers / agents（拒绝已删除的 routes / pipeline / defaultProvider）。
 */
export function normalizeAiRoutingConfig(ai: AIConfig | undefined): NormalizedAiRoutingConfig {
  rejectRemovedAiConfigFields(ai);

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

  return { providers, agents };
}
