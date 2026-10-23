/** LLM Model descriptor (ADR 0009 D1 / ADR 0018 transport). */

import type { JSONValue } from 'ai';
import type { SdkId } from '../sdk-registry.js';

/**
 * 传输 API 标识。新传输恒为 'ai-sdk'；string 分支只为读取存量持久化消息
 * （历史 api id 如 openai-completions / anthropic-messages 等），新代码不得产出。
 */
export type ModelApi = 'ai-sdk' | (string & {});

export type ModelInputModality = 'text' | 'image' | 'audio' | 'video' | 'file';

export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface OpenAiCompatFlags {
  /**
   * `sdk: openai`: set false for an OpenAI-protocol endpoint that rejects the
   * `developer` role. Reasoning models (o-series, gpt-5) then send their
   * instructions as `system` (`providerOptions.openai.systemMessageMode`).
   */
  supportsDeveloperRole?: boolean;
  /**
   * @deprecated No effect. Reasoning replay is decided per model by the transport
   * (DeepSeek / MiniMax thinking models, `reasoning_content` on openai-compatible).
   */
  supportsReasoningContent?: boolean;
  /** @deprecated No effect; assistant tool calls are always sent in the assistant message. */
  toolCallsInAssistant?: boolean;
  /**
   * `sdk: openai-compatible` / `ollama`: request the streamed usage chunk
   * (`stream_options.include_usage`). Default true; set false for a server that
   * rejects `stream_options`.
   */
  includeUsage?: boolean;
  /**
   * `sdk: openai-compatible`: whether `/v1` is appended to `baseUrl`. Unset: appended
   * only when the path names no API version (`/v3`, `/v1beta`, ...) and does not end
   * in `/openai`. `true`: always (pre-1.x behaviour). `false`: use `baseUrl` as written.
   */
  appendV1?: boolean;
  /**
   * How a requested JSON Schema reply is obtained. `native`: the provider's structured output /
   * JSON mode. `prompt`: the schema is written into the system prompt and the reply text decoded
   * leniently, for models whose JSON mode returns empty answers. Default: `prompt` for
   * `sdk: deepseek`, `native` otherwise.
   */
  structuredOutput?: 'native' | 'prompt';
  /**
   * `sdk: openai-compatible`: send OpenAI's `prompt_cache_key` (and
   * `prompt_cache_retention`) for gateways that route prompt caches by key. Default
   * false, because strict servers reject unknown body fields.
   */
  promptCacheKey?: boolean;
}

export interface Model {
  id: string;
  name?: string;
  provider: string;
  api: ModelApi;
  sdk?: SdkId;
  baseUrl?: string;
  compat?: OpenAiCompatFlags;
  reasoning?: boolean;
  input: ModelInputModality[];
  contextWindow: number;
  maxTokens: number;
  cost?: ModelCostRates;
  /** Copied from {@link ProviderInstanceConfig.providerOptions}. */
  providerOptions?: Record<string, Record<string, JSONValue>>;
  /** Streaming stall timeouts from the provider config (AI SDK `timeout.firstChunkMs` / `chunkMs`). */
  streamTimeout?: ModelStreamTimeout;
  /** Default reasoning level, from {@link ProviderInstanceConfig.thinkingLevel}. */
  thinkingLevel?: import('./agent-event.js').ThinkingLevel;
}

export interface ModelStreamTimeout {
  /** Abort when no first chunk arrives within this many ms (includes waiting for headers). */
  firstChunkMs?: number;
  /** Abort when the stream goes silent for this many ms between chunks. */
  chunkMs?: number;
}

export interface ProviderInstanceConfig {
  sdk: SdkId;
  apiKey?: string;
  authScheme?: string;
  baseUrl?: string;
  compat?: OpenAiCompatFlags;
  headers?: Record<string, string>;
  /**
   * Per-request timeout in ms for this provider; overrides
   * `ai.providerResilience.requestTimeoutMs` (a model-harness `requestTimeoutMs`
   * still wins). 0 disables.
   */
  timeout?: number;
  /** Retries per model for this provider; overrides `ai.providerResilience.maxRetries`. */
  maxRetries?: number;
  /**
   * Abort a streamed request when the first chunk takes longer than this (ms).
   * Default off. Stalls are classified as timeouts and retried / failed over.
   */
  firstChunkTimeoutMs?: number;
  /** Abort a streamed request when it goes silent between chunks for this long (ms). Default off. */
  chunkTimeoutMs?: number;
  /** Explicit model input modalities. Absence is text-only (fail closed), except Gemini chat models on `sdk: google` (see `defaultModelInput`). */
  input?: readonly ModelInputModality[];
  /** Cloudflare Workers AI */
  accountId?: string;
  /** Ollama */
  host?: string;
  /** Explicit model allowlist (yaml); overrides sdk preset */
  models?: string[];
  /** Default / preferred model; prepended to models list when absent */
  defaultModel?: string;
  /** Context window override */
  contextWindow?: number;
  /**
   * Output token cap per request. Default 8192. Gemini and Claude count thinking
   * tokens against it, so raise it with a high `thinkingLevel`.
   */
  maxOutputTokens?: number;
  /**
   * Reasoning level for every request: `off` | `low` | `medium` | `high`. Sent as the
   * AI SDK `reasoning` option, which each SDK maps to its own setting (Gemini
   * thinkingLevel/thinkingBudget, Claude thinking budget/effort, OpenAI and
   * DeepSeek reasoning effort). Unset leaves the provider default. A thinking
   * setting in `providerOptions` wins. MiniMax keeps its adaptive thinking.
   */
  thinkingLevel?: import('./agent-event.js').ThinkingLevel;
  /**
   * Extra AI SDK `providerOptions`, merged into every request of this provider,
   * keyed by SDK provider id. For Gemini: `{ google: { safetySettings: [...],
   * thinkingConfig: { thinkingLevel: 'low' } } }`. See ai.google.dev safety settings.
   */
  providerOptions?: Record<string, Record<string, JSONValue>>;
  /**
   * Gemini (`sdk: google`) context caching. Default implicit (no code path). `explicit`
   * creates `cachedContents` for the stable system + tools prefix; see gemini-context-cache.ts.
   */
  contextCache?: import('../gemini-context-cache.js').GeminiContextCacheConfig;
  /** Inherited from ProviderConfig — image defaults */
  imageGeneration?: import('../../image-generation.js').ImageGenerationDefaults;
}
