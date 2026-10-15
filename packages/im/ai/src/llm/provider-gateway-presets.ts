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
  if (config.sdk === 'ollama' && !(config.contextWindow != null && config.contextWindow > 0)) {
    warnings.push(
      `${alias}: ollama contextWindow not set; assuming OLLAMA_CONTEXT_LENGTH or ${OLLAMA_DEFAULT_CONTEXT_WINDOW} tokens. `
      + 'Set contextWindow to the num_ctx your Ollama server allocates (see `ollama ps`), or Ollama silently truncates long prompts',
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

/**
 * Ollama's smallest server default `num_ctx` (4k below 24 GiB VRAM; 32k / 256k on
 * bigger GPUs, or `OLLAMA_CONTEXT_LENGTH`). Ollama's OpenAI-compatible API cannot
 * raise it per request and silently drops the head of a longer prompt, so zhin
 * assumes the smallest value unless told otherwise.
 */
export const OLLAMA_DEFAULT_CONTEXT_WINDOW = 4_096;

function positiveInt(value: string | undefined): number | undefined {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Context window the transport plans for: explicit `contextWindow` > gateway preset
 * > model-id hint > 128k. For `sdk: ollama`: explicit `contextWindow` >
 * `OLLAMA_CONTEXT_LENGTH` (when zhin and Ollama share the environment) >
 * {@link OLLAMA_DEFAULT_CONTEXT_WINDOW}.
 */
export function resolveTransportContextWindow(
  config: ProviderInstanceConfig,
  modelId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  if (config.contextWindow != null && config.contextWindow > 0) {
    return config.contextWindow;
  }
  if (config.sdk === 'ollama') {
    return positiveInt(env.OLLAMA_CONTEXT_LENGTH) ?? OLLAMA_DEFAULT_CONTEXT_WINDOW;
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
