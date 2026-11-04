import type { Context } from './types/context.js';
import type { Model, ModelApi, ModelStreamTimeout } from './types/model.js';
import type { ThinkingLevel } from './types/agent-event.js';
import type { AssistantMessage } from './types/agent-message.js';
import type { ProviderResilienceConfig } from './provider-resilience.js';

/** Final semantic input to the SDK, not an HTTP request or proof of upstream receipt. */
export interface LlmRequestInput {
  readonly system?: unknown;
  readonly messages: readonly unknown[];
  readonly tools: readonly Readonly<{ name: string; description?: string; inputSchema?: unknown }>[];
  readonly output_schema?: unknown;
}

export type LlmRequestObservation =
  | Readonly<{ status: 'captured'; input: LlmRequestInput }>
  | Readonly<{ status: 'capture_failed' }>;

export interface StreamOptions {
  /** Whole-request execution timeout, not a vendor sampling parameter. Zero disables.
   * A resilience wrapper consumes it and passes zero downstream with its own signal. */
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  sessionId?: string;
  thinkingLevel?: ThinkingLevel;
  /** Provider prompt cache（默认启用；仅显式 false 禁用） */
  promptCache?: boolean;
  /** OpenAI routing hint；同 key 提高前缀命中率 */
  promptCacheKey?: string;
  promptCacheRetention?: import('./prompt-cache.js').PromptCacheRetention;
  /**
   * 结构化输出 JSON Schema（AI SDK `Output.object`）。
   * 存在时约束模型文本回复为该 schema 的 JSON；tool-call 中间步自动回退原文本。
   */
  outputSchema?: Record<string, unknown>;
  onPayload?: (payload: unknown) => void;
  /** Optional semantic-input observer; the SDK can repeat it for same-input retries. Failures are isolated. */
  onRequest?: (request: LlmRequestObservation) => void;
  onResponse?: (response: unknown) => void;
  /** Functional text consumer before completion resolves; throwing aborts this provider request. */
  onTextDelta?: (text: string) => void;
  /** A completion owner may prohibit regeneration after publishing partial output. */
  retryAllowed?: () => boolean;
  /** Override the AI SDK's built-in retry count (SDK default 2). The resilient port sets 0. */
  maxRetries?: number;
}

export type StreamFn = (
  model: Model,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream;

export type StreamSimpleFn = StreamFn;

export interface ApiProviderRegistration {
  api: ModelApi;
  stream: StreamFn;
  streamSimple?: StreamSimpleFn;
}

export interface AssistantStreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'toolcall_delta' | 'done' | 'error';
  text?: string;
  thinking?: string;
  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
  message?: AssistantMessage;
  error?: Error;
}

/** Async iterable + push subscription for assistant stream events. */
export interface AssistantMessageEventStream extends AsyncIterable<AssistantStreamEvent> {
  subscribe(listener: (event: AssistantStreamEvent) => void): () => void;
}

/** Output token cap when the provider config sets no `maxOutputTokens`. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/** Existing generic SDK budget: explicit Profile cap, declared model cap, then
 * the framework's established default. Does not materialize a Profile setting. */
export function resolveEffectiveOutputTokens(input: Readonly<{ configured?: number; declared?: number }>): number {
  return input.configured ?? input.declared ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

function positiveMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/**
 * The provider-config layer of the resilience settings: `timeout` → `requestTimeoutMs`,
 * `maxRetries` → `maxRetries`. Apply it between `ai.providerResilience` and the
 * model-harness quirks (`resolveProviderResilienceConfig(global, thisLayer, harness)`).
 */
export function resolveProviderConfigResilience(
  config: Readonly<{ timeout?: number; maxRetries?: number }> | undefined,
): ProviderResilienceConfig | undefined {
  if (!config) return undefined;
  const layer: ProviderResilienceConfig = {};
  if (typeof config.timeout === 'number' && Number.isFinite(config.timeout) && config.timeout >= 0) {
    layer.requestTimeoutMs = Math.floor(config.timeout);
  }
  if (typeof config.maxRetries === 'number' && Number.isFinite(config.maxRetries) && config.maxRetries >= 0) {
    layer.maxRetries = Math.floor(config.maxRetries);
  }
  return Object.keys(layer).length > 0 ? layer : undefined;
}

/** Stream stall timeouts from the provider config; undefined when neither is set. */
export function resolveModelStreamTimeout(config: Readonly<{ firstChunkTimeoutMs?: number; chunkTimeoutMs?: number }>): ModelStreamTimeout | undefined {
  const firstChunkMs = positiveMs(config.firstChunkTimeoutMs);
  const chunkMs = positiveMs(config.chunkTimeoutMs);
  if (firstChunkMs === undefined && chunkMs === undefined) return undefined;
  return {
    ...(firstChunkMs !== undefined ? { firstChunkMs } : {}),
    ...(chunkMs !== undefined ? { chunkMs } : {}),
  };
}

export interface LlmCompletionPort {
  complete(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
  completeSimple(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

/** Build a push-based event stream from an async producer. */
export function createAssistantMessageEventStream(
  producer: (push: (event: AssistantStreamEvent) => void) => Promise<AssistantMessage>,
): AssistantMessageEventStream {
  const listeners = new Set<(event: AssistantStreamEvent) => void>();
  let done = false;
  let error: Error | undefined;
  let finalMessage: AssistantMessage | undefined;
  const queue: AssistantStreamEvent[] = [];
  let notify: (() => void) | undefined;

  const MAX_QUEUE_SIZE = 10_000;

  const push = (event: AssistantStreamEvent) => {
    if (queue.length < MAX_QUEUE_SIZE) {
      queue.push(event);
    }
    for (const listener of listeners) {
      listener(event);
    }
    notify?.();
  };

  const promise = producer(push)
    .then((message) => {
      finalMessage = message;
      push({ type: 'done', message });
      done = true;
      return message;
    })
    .catch((err: unknown) => {
      error = err instanceof Error ? err : new Error(String(err));
      push({ type: 'error', error });
      done = true;
    });

  void promise;

  return {
    subscribe(listener) {
      listeners.add(listener);
      for (const event of queue) {
        listener(event);
      }
      return () => listeners.delete(listener);
    },
    async *[Symbol.asyncIterator]() {
      let index = 0;
      while (true) {
        while (index < queue.length) {
          yield queue[index++]!;
        }
        if (done) {
          if (error) throw error;
          return;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = undefined;
      }
    },
  };
}

export type { AssistantMessage };
