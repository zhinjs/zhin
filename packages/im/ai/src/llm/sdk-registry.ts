/**
 * AI SDK provider factory — optional peer @ai-sdk/* (ADR 0019).
 */

import { createRequire } from 'node:module';
import type { ImageModel, LanguageModel } from 'ai';
import type { ProviderInstanceConfig } from './types/model.js';
import { createGeminiCachingFetch } from './gemini-context-cache.js';

const requirePeer = createRequire(import.meta.url);

function loadPeer<T>(id: string): T {
  try {
    return requirePeer(id) as T;
  } catch (error) {
    throw new Error(
      `Missing peer dependency "${id}". Install it in your project: pnpm add ${id}`,
      { cause: error },
    );
  }
}

export const SDK_IDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'minimax',
  'ollama',
  'openai-compatible',
] as const;

export type SdkId = (typeof SDK_IDS)[number];

export function isSdkId(value: string): value is SdkId {
  return (SDK_IDS as readonly string[]).includes(value);
}

function trimUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeAnthropicBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = trimUrl(baseUrl);
  if (!url) return undefined;
  const withoutTrailing = trimTrailingSlashes(url);
  if (withoutTrailing.endsWith('/v1')) return withoutTrailing;
  return `${withoutTrailing}/v1`;
}

/** @ai-sdk/google 默认 base 以 /v1beta 结尾；代理根路径须补此后缀 */
export function normalizeGoogleBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = trimUrl(baseUrl);
  if (!url) return undefined;
  const withoutTrailing = trimTrailingSlashes(url);
  if (withoutTrailing.endsWith('/v1beta')) return withoutTrailing;
  return `${withoutTrailing}/v1beta`;
}

/** A path segment that already names an API version: `v1`, `v3`, `v1beta`, `v2alpha1`. */
const API_VERSION_SEGMENT = /^v\d+(?:[a-z]+\d*)?$/i;

/**
 * OpenAI-compatible base URL. A bare host or a path without an API version gets
 * `/v1` (the historical behaviour: `https://gw.example` → `https://gw.example/v1`).
 * A base that already names a version anywhere in its path (`/api/v3`,
 * `/api/paas/v4`, `/v1beta/openai`, `/client/v4/.../ai/v1`) or ends in `/openai`
 * is used as written. `compat.appendV1` forces either behaviour.
 */
export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string, appendV1?: boolean): string {
  const url = trimTrailingSlashes(baseUrl.trim());
  if (appendV1 === false) return url;
  if (appendV1 === true) return url.endsWith('/v1') ? url : `${url}/v1`;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; inspect it as a path.
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => API_VERSION_SEGMENT.test(segment))) return url;
  if (segments.at(-1)?.toLowerCase() === 'openai') return url;
  return `${url}/v1`;
}

/** Resolve the openai-compatible base URL from `baseUrl` or a Cloudflare `accountId`. */
export function resolveOpenAiCompatibleBaseUrl(config: ProviderInstanceConfig): string | undefined {
  const explicit = trimUrl(config.baseUrl);
  if (explicit) return normalizeOpenAiCompatibleBaseUrl(explicit, config.compat?.appendV1);
  return config.accountId ? resolveCloudflareBaseUrl(config) : undefined;
}

/**
 * OpenAI base URL. Unset keeps the SDK default (`https://api.openai.com/v1`). A
 * proxy root gets `/v1` like the other OpenAI-style providers; a base that already
 * names a version or ends in `/openai` (Azure-style, Gemini OpenAI-compat) is kept.
 */
export function normalizeOpenAiBaseUrl(
  baseUrl: string | undefined,
  appendV1?: boolean,
): string | undefined {
  const url = trimUrl(baseUrl);
  return url ? normalizeOpenAiCompatibleBaseUrl(url, appendV1) : undefined;
}

/**
 * MiniMax (Anthropic protocol). The SDK posts to `${baseURL}/messages`, so a base
 * ending in `/anthropic` gets `/v1`, and a bare host gets `/anthropic/v1`
 * (`https://api.minimaxi.com` → `https://api.minimaxi.com/anthropic/v1`).
 */
export function normalizeMiniMaxBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = trimUrl(baseUrl);
  if (!url) return undefined;
  const withoutTrailing = trimTrailingSlashes(url);
  if (withoutTrailing.endsWith('/anthropic')) return `${withoutTrailing}/v1`;
  try {
    const { pathname } = new URL(withoutTrailing);
    if (pathname === '' || pathname === '/') return `${withoutTrailing}/anthropic/v1`;
  } catch {
    // Not an absolute URL; use as written.
  }
  return withoutTrailing;
}

/**
 * `Authorization` value for a provider `authScheme`: `''` sends the raw key,
 * `'Bearer'` / `'Bearer '` / `'Token'` send `<scheme> <key>`. Undefined means the
 * SDK default, so this returns undefined.
 */
export function formatAuthorizationHeader(
  authScheme: string | undefined,
  apiKey: string | undefined,
): string | undefined {
  const key = apiKey?.trim();
  if (authScheme === undefined || !key) return undefined;
  const scheme = authScheme.trim();
  return scheme ? `${scheme} ${key}` : key;
}

function resolveOllamaBaseUrl(config: ProviderInstanceConfig): string {
  const host = config.host?.trim() || 'http://127.0.0.1:11434';
  const normalized = trimTrailingSlashes(host);
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

function resolveCloudflareBaseUrl(config: ProviderInstanceConfig): string {
  if (config.baseUrl?.trim()) return trimTrailingSlashes(config.baseUrl.trim());
  const accountId = config.accountId?.trim();
  if (!accountId) {
    throw new Error('cloudflare sdk requires accountId or baseUrl');
  }
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

function buildHeaders(config: ProviderInstanceConfig): Record<string, string> | undefined {
  const headers = { ...config.headers };
  const authorization = formatAuthorizationHeader(config.authScheme, config.apiKey);
  if (authorization) headers.Authorization = authorization;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Bound the wait for response headers with the provider's `firstChunkTimeoutMs`.
 * The AI SDK starts its own first-chunk timer only after headers arrive, so a server
 * that never answers would otherwise hang until the request timeout. Aborts with a
 * `TimeoutError`, which the resilience layer classifies as a retryable timeout.
 */
export function withResponseHeaderTimeout(
  fetchFn: typeof globalThis.fetch | undefined,
  timeoutMs: number | undefined,
): typeof globalThis.fetch | undefined {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchFn;
  const ms = Math.floor(timeoutMs);
  return (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException(`No response headers within ${ms}ms`, 'TimeoutError'));
    }, ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    try {
      return await (fetchFn ?? globalThis.fetch)(input, { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof globalThis.fetch;
}

function sdkTransportExtras(fetchFn?: typeof globalThis.fetch): { fetch?: typeof globalThis.fetch } {
  return fetchFn ? { fetch: fetchFn } : {};
}

function createOpenAiCompatibleProvider(
  config: ProviderInstanceConfig,
  baseURL: string,
  name: string,
  fetchFn?: typeof globalThis.fetch,
) {
  const { createOpenAICompatible } = loadPeer<typeof import('@ai-sdk/openai-compatible')>(
    '@ai-sdk/openai-compatible',
  );
  return createOpenAICompatible({
    name,
    baseURL,
    apiKey: config.apiKey?.trim() ?? '',
    headers: buildHeaders(config),
    // Ask for the final usage chunk (`stream_options.include_usage`); without it
    // OpenAI-style servers stream no usage at all. `compat.includeUsage: false` opts out.
    includeUsage: config.compat?.includeUsage !== false,
    ...sdkTransportExtras(fetchFn),
  });
}

export function createLanguageModel(
  sdk: SdkId,
  config: ProviderInstanceConfig,
  modelId: string,
  transportFetch?: typeof globalThis.fetch,
): LanguageModel {
  const fetchFn = withResponseHeaderTimeout(transportFetch, config.firstChunkTimeoutMs);
  const headers = buildHeaders(config);
  const transport = sdkTransportExtras(fetchFn);

  switch (sdk) {
    case 'openai': {
      const { createOpenAI } = loadPeer<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
      const openai = createOpenAI({
        apiKey: config.apiKey?.trim(),
        baseURL: normalizeOpenAiBaseUrl(config.baseUrl, config.compat?.appendV1),
        headers,
        ...transport,
      });
      return openai.chat(modelId);
    }
    case 'anthropic': {
      const { createAnthropic } = loadPeer<typeof import('@ai-sdk/anthropic')>('@ai-sdk/anthropic');
      const anthropic = createAnthropic({
        apiKey: config.apiKey?.trim(),
        baseURL: normalizeAnthropicBaseUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return anthropic(modelId);
    }
    case 'google': {
      const { createGoogleGenerativeAI } = loadPeer<typeof import('@ai-sdk/google')>('@ai-sdk/google');
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey?.trim(),
        baseURL: normalizeGoogleBaseUrl(config.baseUrl),
        headers,
        ...(config.contextCache?.mode === 'explicit'
          ? { fetch: createGeminiCachingFetch(config.contextCache, fetchFn) }
          : transport),
      });
      return google(modelId);
    }
    case 'deepseek': {
      const { createDeepSeek } = loadPeer<typeof import('@ai-sdk/deepseek')>('@ai-sdk/deepseek');
      const deepseek = createDeepSeek({
        apiKey: config.apiKey?.trim(),
        baseURL: trimUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return deepseek(modelId);
    }
    case 'minimax': {
      const { createMiniMax } = loadPeer<typeof import('@ai-sdk/minimax')>('@ai-sdk/minimax');
      const minimax = createMiniMax({
        apiKey: config.apiKey?.trim(),
        baseURL: normalizeMiniMaxBaseUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return minimax(modelId);
    }
    case 'ollama': {
      const compat = createOpenAiCompatibleProvider(
        config,
        resolveOllamaBaseUrl(config),
        'ollama',
        fetchFn,
      );
      return compat(modelId);
    }
    case 'openai-compatible': {
      const baseURL = resolveOpenAiCompatibleBaseUrl(config);
      if (!baseURL) {
        throw new Error('openai-compatible sdk requires baseUrl (or accountId for Cloudflare Workers AI)');
      }
      const compat = createOpenAiCompatibleProvider(
        config,
        baseURL,
        'openai-compatible',
        fetchFn,
      );
      return compat(modelId);
    }
    default: {
      const _exhaustive: never = sdk;
      throw new Error(`Unsupported sdk: ${String(_exhaustive)}`);
    }
  }
}

export function createImageModel(
  sdk: SdkId,
  config: ProviderInstanceConfig,
  modelId: string,
  fetchFn?: typeof globalThis.fetch,
): ImageModel | null {
  const headers = buildHeaders(config);
  const transport = sdkTransportExtras(fetchFn);

  switch (sdk) {
    case 'openai': {
      const { createOpenAI } = loadPeer<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
      const openai = createOpenAI({
        apiKey: config.apiKey?.trim(),
        baseURL: normalizeOpenAiBaseUrl(config.baseUrl, config.compat?.appendV1),
        headers,
        ...transport,
      });
      return openai.image(modelId);
    }
    case 'google': {
      const { createGoogleGenerativeAI } = loadPeer<typeof import('@ai-sdk/google')>('@ai-sdk/google');
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey?.trim(),
        baseURL: normalizeGoogleBaseUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return google.image(modelId);
    }
    case 'openai-compatible': {
      // Same base URL as chat, so `/images/generations` lands next to `/chat/completions`.
      const baseURL = resolveOpenAiCompatibleBaseUrl(config);
      if (!baseURL) return null;
      const compat = createOpenAiCompatibleProvider(
        config,
        baseURL,
        'openai-compatible',
        fetchFn,
      );
      return compat.imageModel(modelId);
    }
    default:
      return null;
  }
}

export function sdkSupportsImageGeneration(sdk: SdkId): boolean {
  return sdk === 'openai' || sdk === 'google' || sdk === 'openai-compatible' || sdk === 'minimax';
}
