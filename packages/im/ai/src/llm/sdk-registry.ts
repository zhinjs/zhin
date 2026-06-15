/**
 * AI SDK provider factory — closed sdk table (ADR 0018).
 * @ai-sdk/* is an internal transport dependency; do not re-export from @zhin.js/ai.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ImageModel, LanguageModel } from 'ai';
import type { ProviderInstanceConfig } from './types/model.js';
import { resolveProxyFetch } from './proxy-fetch.js';

export const SDK_IDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
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

/** @ai-sdk/anthropic uses `{baseURL}/messages`; baseURL must include `/v1` (unlike official SDK which appends `/v1/messages`). */
function normalizeAnthropicBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = trimUrl(baseUrl);
  if (!url) return undefined;
  const withoutTrailing = url.replace(/\/+$/, '');
  if (withoutTrailing.endsWith('/v1')) return withoutTrailing;
  return `${withoutTrailing}/v1`;
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, '');
  if (url.endsWith('/v1')) return url;
  return `${url}/v1`;
}

function resolveOllamaBaseUrl(config: ProviderInstanceConfig): string {
  const host = config.host?.trim() || 'http://127.0.0.1:11434';
  const normalized = host.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

function resolveCloudflareBaseUrl(config: ProviderInstanceConfig): string {
  if (config.baseUrl?.trim()) return config.baseUrl.trim().replace(/\/+$/, '');
  const accountId = config.accountId?.trim();
  if (!accountId) {
    throw new Error('cloudflare sdk requires accountId or baseUrl');
  }
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

function buildHeaders(config: ProviderInstanceConfig): Record<string, string> | undefined {
  const headers = { ...config.headers };
  if (config.authScheme === '' && config.apiKey) {
    headers.Authorization = config.apiKey;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function sdkTransportExtras(): { fetch?: ReturnType<typeof resolveProxyFetch> } {
  const fetch = resolveProxyFetch();
  return fetch ? { fetch } : {};
}

function createOpenAiCompatibleProvider(
  config: ProviderInstanceConfig,
  baseURL: string,
  name: string,
) {
  return createOpenAICompatible({
    name,
    baseURL,
    apiKey: config.apiKey ?? '',
    headers: buildHeaders(config),
    ...sdkTransportExtras(),
  });
}

/** Create an AI SDK LanguageModel for the given sdk + model id. */
export function createLanguageModel(
  sdk: SdkId,
  config: ProviderInstanceConfig,
  modelId: string,
): LanguageModel {
  const headers = buildHeaders(config);
  const transport = sdkTransportExtras();

  switch (sdk) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.apiKey?.trim(),
        baseURL: trimUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return openai(modelId);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: config.apiKey?.trim(),
        baseURL: normalizeAnthropicBaseUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return anthropic(modelId);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey?.trim(),
        baseURL: trimUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return google(modelId);
    }
    case 'deepseek': {
      const deepseek = createDeepSeek({
        apiKey: config.apiKey?.trim(),
        baseURL: trimUrl(config.baseUrl),
        headers,
        ...transport,
      });
      return deepseek(modelId);
    }
    case 'ollama': {
      const compat = createOpenAiCompatibleProvider(
        config,
        resolveOllamaBaseUrl(config),
        'ollama',
      );
      return compat(modelId);
    }
    case 'openai-compatible': {
      const raw = trimUrl(config.baseUrl)
        || (config.accountId ? resolveCloudflareBaseUrl(config) : undefined);
      if (!raw) {
        throw new Error('openai-compatible sdk requires baseUrl (or accountId for Cloudflare Workers AI)');
      }
      const baseURL = config.accountId && !trimUrl(config.baseUrl)
        ? raw
        : normalizeOpenAiCompatibleBaseUrl(raw);
      const compat = createOpenAiCompatibleProvider(config, baseURL, 'openai-compatible');
      return compat(modelId);
    }
    default: {
      const _exhaustive: never = sdk;
      throw new Error(`Unsupported sdk: ${String(_exhaustive)}`);
    }
  }
}

/** Create an AI SDK ImageModel when the sdk supports image generation. */
export function createImageModel(
  sdk: SdkId,
  config: ProviderInstanceConfig,
  modelId: string,
): ImageModel | null {
  const headers = buildHeaders(config);
  const transport = sdkTransportExtras();

  switch (sdk) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        headers,
        ...transport,
      });
      return openai.image(modelId);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        headers,
        ...transport,
      });
      return google.image(modelId);
    }
    case 'openai-compatible': {
      const baseURL = config.baseUrl?.trim()
        || (config.accountId ? resolveCloudflareBaseUrl(config) : undefined);
      if (!baseURL) return null;
      const compat = createOpenAiCompatibleProvider(config, baseURL, 'openai-compatible');
      return compat.imageModel(modelId);
    }
    default:
      return null;
  }
}

/** Whether this sdk supports AI SDK image generation in Phase 1. */
export function sdkSupportsImageGeneration(sdk: SdkId): boolean {
  return sdk === 'openai' || sdk === 'google' || sdk === 'openai-compatible';
}
