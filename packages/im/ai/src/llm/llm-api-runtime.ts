import type { Context } from './types/context.js';
import type { Model, ModelApi, ModelInputModality, ModelStreamTimeout, ProviderInstanceConfig } from './types/model.js';
import type { ThinkingLevel } from './types/agent-event.js';
import type { AssistantMessage } from './types/agent-message.js';
import { inferModelReasoning, resolveTransportContextWindow } from './provider-gateway-presets.js';
import { groqDefaultModelInput, isGroqGateway } from './groq.js';
import type { LanguageModel } from 'ai';
import { createLanguageModel } from './sdk-registry.js';
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
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  sessionId?: string;
  thinkingLevel?: ThinkingLevel;
  /** Provider prompt cache（默认启用；仅显式 false 禁用） */
  promptCache?: boolean;
  /** OpenAI routing hint；同 key 提高前缀命中率 */
  promptCacheKey?: string;
  promptCacheRetention?: import('./bridge/ai-sdk-prompt-cache.js').PromptCacheRetention;
  /**
   * 结构化输出 JSON Schema（AI SDK `Output.object`）。
   * 存在时约束模型文本回复为该 schema 的 JSON；tool-call 中间步自动回退原文本。
   */
  outputSchema?: Record<string, unknown>;
  onPayload?: (payload: unknown) => void;
  /** Optional semantic-input observer; the SDK can repeat it for same-input retries. Failures are isolated. */
  onRequest?: (request: LlmRequestObservation) => void;
  onResponse?: (response: unknown) => void;
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

export interface RegisteredProvider {
  config: ProviderInstanceConfig;
  models: string[];
  fetch?: typeof globalThis.fetch;
}

/** Output token cap when the provider config sets no `maxOutputTokens`. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

function languageModelKey(alias: string, modelId: string): string {
  return `${alias}::${modelId}`;
}

/** OpenAI chat models that take image input (GPT-4o / 4.1 / 4.5 / 5.x, o1, o3, o4-mini). */
const OPENAI_VISION = /^(?:chatgpt-4o|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o1(?!-mini|-preview)|o3(?!-mini)|o4-mini)/i;
/** Variants of those lines that are not chat-with-images models. */
const OPENAI_NOT_VISION = /(?:audio|realtime|tts|transcribe|embedding|image|moderation|search)/i;

/**
 * Input modalities when the provider config does not list `input`.
 *
 * - Gemini models are natively multimodal (image, audio, video, PDF), so the Google
 *   SDK defaults to all of them; without this, images in group messages were
 *   silently replaced by text placeholders.
 * - OpenAI GPT-4o and later and the o-series reasoning models, and every Claude 3+
 *   model, take images, so they default to text + image. PDFs and other files stay
 *   opt-in through `input`, because the `file` modality is not filtered by MIME type.
 * - Everything else (DeepSeek, MiniMax, Ollama, gateways) stays text-only unless
 *   configured, because their model lines are mixed. An explicit `input` always wins.
 *   Groq is the exception with a known line-up: Llama 4 Scout / Maverick take images,
 *   GPT-OSS and the rest stay text-only (`groqDefaultModelInput`).
 */
export function defaultModelInput(sdk: string | undefined, modelId: string): readonly ModelInputModality[] {
  if (sdk === 'google' && /gemini/i.test(modelId) && !/(?:tts|embedding|image|live|transcribe)/i.test(modelId)) {
    return ['text', 'image', 'audio', 'video', 'file'];
  }
  if (sdk === 'openai' && OPENAI_VISION.test(modelId) && !OPENAI_NOT_VISION.test(modelId)) {
    return ['text', 'image'];
  }
  if (sdk === 'anthropic' && /^claude-(?!2|instant)/i.test(modelId)) {
    return ['text', 'image'];
  }
  return ['text'];
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
  config: Pick<ProviderInstanceConfig, 'timeout' | 'maxRetries'> | undefined,
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
export function resolveModelStreamTimeout(config: ProviderInstanceConfig): ModelStreamTimeout | undefined {
  const firstChunkMs = positiveMs(config.firstChunkTimeoutMs);
  const chunkMs = positiveMs(config.chunkTimeoutMs);
  if (firstChunkMs === undefined && chunkMs === undefined) return undefined;
  return {
    ...(firstChunkMs !== undefined ? { firstChunkMs } : {}),
    ...(chunkMs !== undefined ? { chunkMs } : {}),
  };
}

export function createLlmTransportModel(
  providerAlias: string,
  config: ProviderInstanceConfig,
  modelId: string,
): Model {
  const streamTimeout = resolveModelStreamTimeout(config);
  return {
    id: modelId,
    provider: providerAlias,
    api: 'ai-sdk',
    sdk: config.sdk,
    baseUrl: config.baseUrl,
    compat: config.compat,
    reasoning: inferModelReasoning(modelId),
    input: config.input?.length
      ? [...config.input]
      : [...(isGroqGateway(providerAlias, config.baseUrl) ? groqDefaultModelInput(modelId) : defaultModelInput(config.sdk, modelId))],
    contextWindow: resolveTransportContextWindow(config, modelId),
    maxTokens: config.maxOutputTokens && config.maxOutputTokens > 0 ? config.maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS,
    ...(config.providerOptions ? { providerOptions: config.providerOptions } : {}),
    ...(config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : {}),
    ...(streamTimeout ? { streamTimeout } : {}),
  };
}

export interface LlmCompletionPort {
  complete(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
  completeSimple(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

/** Owns one independent provider directory, model cache, and transport set. */
export class LlmApiRuntime implements LlmCompletionPort {
  readonly #apiProviders = new Map<ModelApi, ApiProviderRegistration>();
  readonly #providers = new Map<string, RegisteredProvider>();
  readonly #languageModels = new Map<string, LanguageModel>();
  readonly #resolveLiveModels?: (alias: string) => string[];
  readonly #validateRequest?: (model: Model, context: Context) => void;

  constructor(resolveLiveModels?: (alias: string) => string[], validateRequest?: (model: Model, context: Context) => void) {
    this.#resolveLiveModels = resolveLiveModels;
    this.#validateRequest = validateRequest;
  }

  registerApiProvider(registration: ApiProviderRegistration): this {
    this.#apiProviders.set(registration.api, registration);
    return this;
  }

  registerProvider(
    alias: string,
    config: ProviderInstanceConfig,
    models: string[] = [],
    fetchFn?: typeof globalThis.fetch,
  ): this {
    const keyPrefix = `${alias}::`;
    for (const key of this.#languageModels.keys()) {
      if (key.startsWith(keyPrefix)) this.#languageModels.delete(key);
    }
    this.#providers.set(alias, { config, models: [...models], fetch: fetchFn });
    return this;
  }

  /** The registered config of a provider alias (read-only view), or undefined. */
  providerConfig(providerAlias: string): Readonly<ProviderInstanceConfig> | undefined {
    return this.#providers.get(providerAlias)?.config;
  }

  model(providerAlias: string, modelId: string): Model {
    const entry = this.#providers.get(providerAlias);
    if (!entry) throw new Error(`Unknown provider alias: ${providerAlias}`);
    const live = this.#resolveLiveModels?.(providerAlias) ?? [];
    const allowlist = entry.models.length > 0 ? entry.models : live;
    if (allowlist.length > 0 && !allowlist.includes(modelId)) {
      throw new Error(`Model ${modelId} not registered for provider ${providerAlias}`);
    }
    return createLlmTransportModel(providerAlias, entry.config, modelId);
  }

  registerLanguageModel(alias: string, modelId: string, model: LanguageModel): this {
    this.#languageModels.set(languageModelKey(alias, modelId), model);
    return this;
  }

  resolveLanguageModel(alias: string, modelId: string): LanguageModel | undefined {
    const key = languageModelKey(alias, modelId);
    const existing = this.#languageModels.get(key);
    if (existing) return existing;
    const entry = this.#providers.get(alias);
    if (!entry) return undefined;
    const model = createLanguageModel(entry.config.sdk, entry.config, modelId, entry.fetch, alias);
    this.#languageModels.set(key, model);
    return model;
  }

  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    this.#validateRequest?.(model, context);
    const registration = this.#apiProviders.get(model.api);
    if (!registration) throw new Error(`No ApiProvider registered for api: ${model.api}`);
    return registration.stream(model, context, options);
  }

  streamSimple(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    this.#validateRequest?.(model, context);
    const registration = this.#apiProviders.get(model.api);
    if (!registration) throw new Error(`No ApiProvider registered for api: ${model.api}`);
    return (registration.streamSimple ?? registration.stream)(model, context, options);
  }

  async complete(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): Promise<AssistantMessage> {
    return this.consume(this.stream(model, context, options));
  }

  async completeSimple(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): Promise<AssistantMessage> {
    return this.consume(this.streamSimple(model, context, options));
  }

  private async consume(eventStream: AssistantMessageEventStream): Promise<AssistantMessage> {
    let lastMessage: AssistantMessage | undefined;
    for await (const event of eventStream) {
      if (event.type === 'done' && event.message) lastMessage = event.message;
      if (event.type === 'error') throw event.error ?? new Error('Stream failed');
    }
    if (!lastMessage) throw new Error('Stream ended without assistant message');
    return lastMessage;
  }
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
