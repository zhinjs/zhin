/**
 * Known LLM gateway presets — sdk / contextWindow defaults for common proxies.
 * Applied during ai.providers normalization (agent) and transport model resolution.
 */
import type { SdkId } from './sdk-registry.js';
import type { ProviderInstanceConfig } from './types/model.js';

export interface ProviderGatewayPreset {
  /** Provider alias (exact, case-insensitive) */
  aliases?: readonly string[];
  /** baseUrl must include one of these substrings (case-insensitive) */
  baseUrlIncludes?: readonly string[];
  sdk?: SdkId;
  contextWindow?: number;
  /** When true, preset sdk overrides yaml sdk when baseUrl matches */
  coerceSdk?: boolean;
}

/** Curated gateways; extend when adding first-class proxy docs. */
export const PROVIDER_GATEWAY_PRESETS: readonly ProviderGatewayPreset[] = [
  {
    aliases: ['opencode', 'opencode-zen', 'opencode_go'],
    baseUrlIncludes: ['opencode.ai/zen'],
    sdk: 'openai-compatible',
    contextWindow: 32_768,
    coerceSdk: true,
  },
  {
    aliases: ['openrouter'],
    baseUrlIncludes: ['openrouter.ai'],
    sdk: 'openai-compatible',
    contextWindow: 128_000,
  },
  {
    aliases: ['nvidia', 'nvidia-nim'],
    baseUrlIncludes: ['integrate.api.nvidia.com'],
    sdk: 'openai-compatible',
    contextWindow: 128_000,
    coerceSdk: true,
  },
];

function matchesPreset(
  alias: string,
  baseUrl: string | undefined,
  preset: ProviderGatewayPreset,
): boolean {
  const aliasLower = alias.trim().toLowerCase();
  if (preset.aliases?.some((a) => a.toLowerCase() === aliasLower)) return true;
  const url = baseUrl?.trim().toLowerCase() ?? '';
  if (url && preset.baseUrlIncludes?.some((part) => url.includes(part.toLowerCase()))) {
    return true;
  }
  return false;
}

function resolvePreset(alias: string, baseUrl?: string): ProviderGatewayPreset | undefined {
  return PROVIDER_GATEWAY_PRESETS.find((preset) => matchesPreset(alias, baseUrl, preset));
}

/** Apply gateway defaults; yaml explicit fields win except coerceSdk gateways. */
export function applyProviderGatewayPreset(
  alias: string,
  config: ProviderInstanceConfig,
): ProviderInstanceConfig {
  const preset = resolvePreset(alias, config.baseUrl);
  if (!preset) return config;

  const out = { ...config };
  if (preset.coerceSdk && preset.sdk) {
    out.sdk = preset.sdk;
  } else if (!out.sdk && preset.sdk) {
    out.sdk = preset.sdk;
  }
  if (out.contextWindow == null && preset.contextWindow != null) {
    out.contextWindow = preset.contextWindow;
  }
  if (preset.sdk === 'openai-compatible' && !out.compat) {
    out.compat = { supportsReasoningContent: true };
  } else if (preset.sdk === 'openai-compatible' && out.compat && out.compat.supportsReasoningContent == null) {
    out.compat = { ...out.compat, supportsReasoningContent: true };
  }
  return out;
}

/** Detect sdk/baseUrl mismatches that break chat/completions vs /responses routing. */
export function validateProviderGatewayConfig(
  alias: string,
  config: ProviderInstanceConfig,
): string[] {
  const warnings: string[] = [];
  const baseUrl = config.baseUrl?.trim().toLowerCase() ?? '';

  if (baseUrl.includes('opencode.ai/zen') && config.sdk === 'openai') {
    warnings.push(
      `${alias}: sdk "openai" routes to /v1/responses; OpenCode Zen chat models need sdk "openai-compatible"`,
    );
  }
  const preset = resolvePreset(alias, config.baseUrl);
  if (preset?.coerceSdk && preset.sdk && config.sdk && config.sdk !== preset.sdk) {
    warnings.push(
      `${alias}: sdk "${config.sdk}" will be coerced to "${preset.sdk}" for this gateway`,
    );
  }
  return warnings;
}

const REASONING_MODEL_RE =
  /(?:^|[:\-_/])(mimo|reasoner|thinking|qwq|r1|o[134])(?:[:\-_/]|$)|-flash-free$|reasoning/i;

/** Heuristic: model emits reasoning before answer (MiMo, DeepSeek-R, etc.). */
export function inferModelReasoning(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  if (/no-?think|non-?reasoning|instruct/.test(id)) return false;
  return REASONING_MODEL_RE.test(id);
}

export function resolveTransportContextWindow(
  config: ProviderInstanceConfig,
  modelId: string,
): number {
  if (config.contextWindow != null && config.contextWindow > 0) {
    return config.contextWindow;
  }
  const preset = resolvePreset('', config.baseUrl);
  if (preset?.contextWindow) return preset.contextWindow;
  const id = modelId.toLowerCase();
  if (id.includes('8k')) return 8_192;
  if (id.includes('32k')) return 32_768;
  if (id.includes('128k')) return 128_000;
  if (/-free$/.test(id)) return 32_768;
  return 128_000;
}
