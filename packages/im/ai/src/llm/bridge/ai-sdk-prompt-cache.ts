import type { ModelMessage, SystemModelMessage, ToolSet } from 'ai';
import type { SdkId } from '../sdk-registry.js';

export type PromptCacheProviderOptions = {
  openai?: Record<string, string>;
  anthropic?: Record<string, string | string[]>;
  /** @ai-sdk/openai-compatible passes unknown keys through as raw body fields. */
  openaiCompatible?: Record<string, string>;
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
  /** `compat.promptCacheKey` for `sdk: openai-compatible`. */
  compatPromptCacheKey?: boolean;
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

/**
 * OpenAI：`prompt_cache_key` + optional retention（自动前缀缓存，无需 cache_control）。
 * openai-compatible：仅在 `compat.promptCacheKey: true` 时以原始 body 字段发送
 * （@ai-sdk/openai-compatible 不读 `providerOptions.openai`，严格网关会拒绝未知字段）。
 */
export function buildPromptCacheProviderOptions(
  input: PromptCacheApplyInput,
): PromptCacheProviderOptions | undefined {
  if (!input.enabled || !input.cacheKey?.trim()) return undefined;
  const key = input.cacheKey.trim();
  if (input.sdk === 'openai') {
    const openaiOpts: Record<string, string> = { promptCacheKey: key };
    if (input.retention) openaiOpts.promptCacheRetention = input.retention;
    return { openai: openaiOpts };
  }
  if (input.sdk === 'openai-compatible' && input.compatPromptCacheKey === true) {
    const body: Record<string, string> = { prompt_cache_key: key };
    if (input.retention) body.prompt_cache_retention = input.retention;
    return { openaiCompatible: body };
  }
  return undefined;
}

export function resolvePromptCacheApplyInput(
  enabled: boolean,
  sdk: string | undefined,
  options?: Pick<StreamPromptCacheOptions, 'promptCacheKey' | 'promptCacheRetention'>,
  compat?: { promptCacheKey?: boolean },
): PromptCacheApplyInput {
  return {
    enabled,
    sdk,
    cacheKey: options?.promptCacheKey,
    retention: options?.promptCacheRetention,
    ...(compat?.promptCacheKey === true ? { compatPromptCacheKey: true } : {}),
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

/** Extend the existing Anthropic cache to the immutable conversation prefix.
 * This adds one breakpoint (system + tools + history = at most three here),
 * retaining the existing opt-out and ephemeral lifetime. Never mark thinking.
 */
export function applyPromptCacheToMessages(
  messages: ModelMessage[],
  input: PromptCacheApplyInput,
): ModelMessage[] {
  if (!input.enabled || input.sdk !== 'anthropic') return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const content = message.content;
    const last = Array.isArray(content) ? content.at(-1) : undefined;
    const cacheable = typeof content === 'string' ? content.trim().length > 0
      : last && last.type !== 'reasoning' && (last.type !== 'text' || last.text.trim().length > 0);
    if (!cacheable) continue;
    const out = [...messages];
    out[index] = {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        anthropic: { ...message.providerOptions?.anthropic, cacheControl: { type: 'ephemeral' } },
      },
    };
    return out;
  }
  return messages;
}
