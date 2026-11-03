/** Synthetic transport fixture inputs only; not an application configuration or selection authority. */
import type { JSONValue } from 'ai';
import type { SdkId } from '../../src/llm/sdk-registry.js';
import type { OpenAiCompatFlags, ModelInputModality } from '../../src/llm/types/model.js';
export interface ProviderFixtureConfig {
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
  /** Legacy input metadata for explicit offline conversion. Runtime capabilities come from ModelDefinition. */
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
  thinkingLevel?: import('../../src/llm/types/agent-event.js').ThinkingLevel;
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
  contextCache?: import('../../src/llm/gemini-context-cache.js').GeminiContextCacheConfig;
  /** Inherited from ProviderConfig — image defaults */
  imageGeneration?: import('../../src/image-generation.js').ImageGenerationDefaults;
}
