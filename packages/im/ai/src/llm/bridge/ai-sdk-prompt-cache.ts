import type { SystemModelMessage, ToolSet } from 'ai';
import type { SdkId } from '../sdk-registry.js';

export type PromptCacheProviderOptions = {
  openai?: Record<string, string>;
  anthropic?: Record<string, string | string[]>;
};

export type PromptCacheRetention = 'in_memory' | '24h';

const PROMPT_CACHE_SDKS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'openai-compatible',
]);

const ANTHROPIC_EPHEMERAL_CACHE = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
};

export interface PromptCacheApplyInput {
  enabled: boolean;
  sdk?: SdkId | string;
  cacheKey?: string;
  retention?: PromptCacheRetention;
}

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

function normalizeInput(input: PromptCacheApplyInput | boolean): PromptCacheApplyInput {
  return typeof input === 'boolean' ? { enabled: input } : input;
}

export function wrapSystemForPromptCache(
  system: string | undefined,
  input: PromptCacheApplyInput | boolean,
): string | SystemModelMessage | undefined {
  const ctx = normalizeInput(input);
  if (!system?.trim()) return undefined;
  if (!ctx.enabled || ctx.sdk !== 'anthropic') return system;
  return {
    role: 'system',
    content: system,
    providerOptions: ANTHROPIC_EPHEMERAL_CACHE,
  };
}

export function applyPromptCacheToTools(
  tools: ToolSet | undefined,
  input: PromptCacheApplyInput | boolean,
): ToolSet | undefined {
  const ctx = normalizeInput(input);
  if (!tools || !ctx.enabled || ctx.sdk !== 'anthropic') return tools;
  const names = Object.keys(tools);
  if (names.length === 0) return tools;
  const lastName = names[names.length - 1];
  const last = tools[lastName];
  if (!last) return tools;
  return {
    ...tools,
    [lastName]: {
      ...last,
      providerOptions: ANTHROPIC_EPHEMERAL_CACHE,
    },
  };
}

/** OpenAI / compatible：`prompt_cache_key` + optional retention（自动前缀缓存，无需 cache_control）。 */
export function buildPromptCacheProviderOptions(
  input: PromptCacheApplyInput,
): PromptCacheProviderOptions | undefined {
  if (!input.enabled || !input.cacheKey?.trim()) return undefined;
  if (input.sdk !== 'openai' && input.sdk !== 'openai-compatible') return undefined;
  const openaiOpts: Record<string, string> = {
    promptCacheKey: input.cacheKey.trim(),
  };
  if (input.retention) {
    openaiOpts.promptCacheRetention = input.retention;
  }
  return { openai: openaiOpts };
}

export function resolvePromptCacheApplyInput(
  enabled: boolean,
  sdk: string | undefined,
  options?: Pick<StreamPromptCacheOptions, 'promptCacheKey' | 'promptCacheRetention'>,
): PromptCacheApplyInput {
  return {
    enabled,
    sdk,
    cacheKey: options?.promptCacheKey,
    retention: options?.promptCacheRetention,
  };
}

/** Stream 层默认启用 prompt cache；仅显式 `promptCache: false` 关闭。 */
export function isStreamPromptCacheEnabled(promptCache?: boolean): boolean {
  return promptCache !== false;
}

export interface StreamPromptCacheOptions {
  promptCache?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: PromptCacheRetention;
}
