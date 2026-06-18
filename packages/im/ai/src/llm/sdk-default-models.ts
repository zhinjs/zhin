/**
 * Per-sdk default model allowlists (ADR 0018).
 * Used when ai.providers.<alias>.models is omitted; yaml models always override.
 *
 * Curated from vendor docs (2026-06): Anthropic models overview, OpenAI API models,
 * Google Gemini API models, DeepSeek pricing.
 */

import type { SdkId } from './sdk-registry.js';
import type { ProviderInstanceConfig } from './types/model.js';

/** Official / common model ids per sdk (static fallback). */
export const SDK_DEFAULT_MODELS: Readonly<Record<SdkId, readonly string[]>> = {
  openai: [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
  ],
  anthropic: [
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-5-20251101',
  ],
  google: [
    'gemini-3.5-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  /** Static fallback; runtime discovery via GET /v1beta/models when yaml models omitted */
  deepseek: [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    // Deprecated 2026-07-24; aliases for v4-flash non-thinking / thinking modes
    'deepseek-chat',
    'deepseek-reasoner',
  ],
  /** Discovery via GET /v1/models or Ollama /api/tags */
  ollama: [],
  /** Discovery via GET /v1/models when gateway supports it */
  'openai-compatible': [],
};

/**
 * AnyRouter（anyrouter.top）Messages API 模型目录（来自控制台 /v1/models）。
 * 无 `[1m]` 后缀；gpt/gemini 项须走 openai-compatible，不能配在 sdk: anthropic 下。
 * 实测 2026-06：仅 claude-haiku-4-5-20251001 可稳定调用，Sonnet/Opus 仍报 1m 上下文 400。
 */
export const ANYROUTER_ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-20250514',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-5-20251101',
  'claude-fable-5',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
] as const;

/** Sdks that may discover models via OpenAI-compatible GET /v1/models */
export const SDK_SUPPORTS_OPENAI_MODEL_DISCOVERY: ReadonlySet<SdkId> = new Set([
  'openai',
  'deepseek',
  'ollama',
  'openai-compatible',
]);

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const key = id.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Resolve runtime model list: explicit yaml `models` > sdk preset > empty (discovery).
 * `defaultModel` is prepended when not already present.
 */
export function resolveSdkProviderModels(
  sdk: SdkId,
  config: { models?: string[]; defaultModel?: string },
): string[] {
  const explicit = (config.models ?? []).map((m) => m.trim()).filter(Boolean);
  const base = explicit.length > 0 ? explicit : [...SDK_DEFAULT_MODELS[sdk]];
  const defaultModel = config.defaultModel?.trim();
  if (defaultModel && !base.includes(defaultModel)) {
    return dedupe([defaultModel, ...base]);
  }
  return dedupe(base);
}

/** Whether this sdk has a non-empty static preset (vs discovery-only). */
export function sdkHasStaticModelPreset(sdk: SdkId): boolean {
  return SDK_DEFAULT_MODELS[sdk].length > 0;
}
