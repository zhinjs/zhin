import type { SdkId } from './sdk-registry.js';

export type PromptCacheRetention = 'in_memory' | '24h';

const PROMPT_CACHE_SDKS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'openai-compatible',
]);

export function supportsPromptCacheSdk(sdk?: string): sdk is SdkId {
  return !!sdk && PROMPT_CACHE_SDKS.has(sdk);
}

/** Stable routing key for OpenAI `prompt_cache_key` (not per-session). */
export function buildPromptCacheKey(parts: {
  label: string;
  provider: string;
  modelId: string;
  prefix?: string;
}): string {
  const base = parts.prefix?.trim() || 'zhin';
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe(base)}:${safe(parts.label)}:${safe(parts.provider)}:${safe(parts.modelId)}`;
}

/** Stream 层默认启用 prompt cache；仅显式 `promptCache: false` 关闭。 */
export function isStreamPromptCacheEnabled(promptCache?: boolean): boolean {
  return promptCache !== false;
}
