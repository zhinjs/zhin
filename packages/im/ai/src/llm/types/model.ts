/** LLM Model descriptor (ADR 0009 D1 / ADR 0018 transport). */

/** JSON protocol data, including omitted object fields; independent of one SDK's declarations. */
export type ProtocolJsonValue = null | string | number | boolean | ProtocolJsonValue[] | { [key: string]: ProtocolJsonValue | undefined };
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
  /**
   * ADR 0041: whether this endpoint accepts a system / developer message between conversation
   * turns (member join / leave / profile changes). `none` renders them as a `user_id:system` user
   * message instead. Default: `system` for OpenAI and remote OpenAI-compatible endpoints
   * (`developer` for o-series / gpt-5), `none` for local servers, Anthropic and Gemini.
   */
  midConversationSystem?: 'system' | 'developer' | 'none';
}

export interface Model {
  /** Selected Driver's non-secret execution controls from the validated Profile. */
  executionPolicy?: import('../../provider/driver.js').ProviderExecutionPolicy;
  id: string;
  name?: string;
  provider: string;
  api: ModelApi;
  sdk?: SdkId;
  /** Driver-derived prompt compatibility; never a user-authored SDK selector. */
  promptFamily?: string;
  nativeDeferredTools?: boolean;
  promptCacheRouting?: 'driver';
  midConversationSystem?: 'system' | 'developer' | 'none';
  baseUrl?: string;
  compat?: OpenAiCompatFlags;
  reasoning?: boolean;
  input: ModelInputModality[];
  contextWindow: number;
  maxTokens: number;
  cost?: ModelCostRates;
  /** Private transport options projected by the selected Driver. */
  providerOptions?: Record<string, Record<string, ProtocolJsonValue>>;
  /** Streaming stall timeouts from the provider config (AI SDK `timeout.firstChunkMs` / `chunkMs`). */
  streamTimeout?: ModelStreamTimeout;
  /** Reasoning level projected from the selected Profile. */
  thinkingLevel?: import('./agent-event.js').ThinkingLevel;
}

export interface ModelStreamTimeout {
  /** Abort when no first chunk arrives within this many ms (includes waiting for headers). */
  firstChunkMs?: number;
  /** Abort when the stream goes silent for this many ms between chunks. */
  chunkMs?: number;
}
