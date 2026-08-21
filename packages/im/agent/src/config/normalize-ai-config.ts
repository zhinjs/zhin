import { type AIConfig, applyProviderGatewayPreset, isSdkId, validateProviderGatewayConfig } from '@zhin.js/ai';
import { getLogger } from '@zhin.js/logger';
import type {
  AgentBindingConfig,
  ProviderInstanceConfig,
} from './types.js';

const logger = getLogger('AIConfig');

/** 统一的新写法提示（硬报错文案共用）。 */
const PROVIDER_FORM_HINT =
  '命名 providers + 显式 sdk，例: providers: { my-openai: { sdk: openai, apiKey: sk-... } }';

/** Normalize provider entry to required `sdk` (ADR 0018). Rejects api/preset/spec/driver. */
export function normalizeProviderEntry(
  alias: string,
  cfg: ProviderInstanceConfig & { driver?: string; api?: string; preset?: string; spec?: string },
): ProviderInstanceConfig {
  if (cfg.api?.trim() || cfg.preset?.trim() || cfg.spec?.trim()) {
    throw new Error(
      `ai.providers.${alias}: "api", "preset", and "spec" are removed; use "sdk" instead (ADR 0018)`,
    );
  }
  if (cfg.driver?.trim()) {
    throw new Error(
      `ai.providers.${alias}: "driver" is removed; use "sdk" instead (ADR 0018) — ${PROVIDER_FORM_HINT}`,
    );
  }

  const rest = { ...cfg } as Record<string, unknown>;
  delete rest.driver;
  delete rest.api;
  delete rest.preset;
  delete rest.spec;
  const normalized = { ...(rest as unknown as ProviderInstanceConfig) };
  if (typeof normalized.apiKey === 'string') normalized.apiKey = normalized.apiKey.trim();
  if (typeof normalized.baseUrl === 'string') normalized.baseUrl = normalized.baseUrl.trim();
  if (typeof normalized.host === 'string') normalized.host = normalized.host.trim();
  // 网关预设（opencode / zhipu 等已知别名）可补齐或纠正 sdk；其余必须显式声明
  const withGateway = applyProviderGatewayPreset(alias, normalized);
  const sdkRaw = withGateway.sdk?.trim().toLowerCase();

  if (!sdkRaw || !isSdkId(sdkRaw)) {
    throw new Error(
      `ai.providers.${alias}: sdk is required (openai | anthropic | google | deepseek | ollama | openai-compatible) — ${PROVIDER_FORM_HINT}`,
    );
  }

  const result = { ...withGateway, sdk: sdkRaw as ProviderInstanceConfig['sdk'] };
  const warnings = validateProviderGatewayConfig(alias, result);
  if (warnings.length > 0 && process.env.ZHIN_PROVIDER_GATEWAY_WARN !== '0') {
    for (const w of warnings) {
      logger.warn(`[ai.providers] ${w}`);
    }
  }
  return result;
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
  if (raw.workrooms !== undefined) {
    throw new Error('ai.workrooms removed; manage the persistent Workroom Catalog through Console or its repository API');
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
  mcpServerNames: readonly string[];
}

/**
 * 解析 ai.providers / agents（拒绝已删除的 routes / pipeline / defaultProvider /
 * driver 字段与旧平铺 providers 写法——后者因缺少显式 sdk 在此硬报错）。
 */
export function normalizeAiRoutingConfig(ai: AIConfig | undefined): NormalizedAiRoutingConfig {
  rejectRemovedAiConfigFields(ai);

  const providers: Record<string, ProviderInstanceConfig> = {};
  const rawProviders = ai?.providers;
  if (rawProviders && typeof rawProviders === 'object' && !Array.isArray(rawProviders)) {
    for (const [alias, cfg] of Object.entries(rawProviders)) {
      if (!cfg || typeof cfg !== 'object') continue;
      providers[alias] = normalizeProviderEntry(
        alias,
        cfg as ProviderInstanceConfig & { driver?: string; api?: string; preset?: string; spec?: string },
      );
    }
  }

  const agents = { ...((ai as AIConfig & { agents?: Record<string, AgentBindingConfig> })?.agents ?? {}) };

  const mcpServerNames = (ai?.mcpServers ?? [])
    .map((server) => typeof server?.name === 'string' ? server.name.trim() : '')
    .filter(Boolean);
  return { providers, agents, mcpServerNames };
}
