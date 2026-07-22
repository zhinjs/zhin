import type { Context } from './types/context.js';
import type { Model, ModelApi, ProviderInstanceConfig } from './types/model.js';
import type { ThinkingLevel } from './types/agent-event.js';
import type { AssistantMessage } from './types/agent-message.js';
import { inferModelReasoning, resolveTransportContextWindow } from './provider-gateway-presets.js';

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
  onResponse?: (response: unknown) => void;
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
}

const apiProviders = new Map<ModelApi, ApiProviderRegistration>();
const providerConfigs = new Map<string, RegisteredProvider>();

let liveModelsResolver: ((alias: string) => string[]) | undefined;

/** @internal wired by register-api-layer */
export function setLiveModelsResolver(
  resolver: ((alias: string) => string[]) | undefined,
): void {
  liveModelsResolver = resolver;
}

export function getLiveModelsResolver(): typeof liveModelsResolver {
  return liveModelsResolver;
}

export function registerApiProvider(registration: ApiProviderRegistration): void {
  apiProviders.set(registration.api, registration);
}

export function registerProviderInstance(
  alias: string,
  config: ProviderInstanceConfig,
  models: string[] = [],
): void {
  providerConfigs.set(alias, { config, models });
}

export function getApiProvider(api: ModelApi): ApiProviderRegistration | undefined {
  return apiProviders.get(api);
}

export function getProviderConfig(alias: string): RegisteredProvider | undefined {
  return providerConfigs.get(alias);
}

export function getLlmTransportModel(providerAlias: string, modelId: string): Model {
  const entry = providerConfigs.get(providerAlias);
  if (!entry) {
    throw new Error(`Unknown provider alias: ${providerAlias}`);
  }
  const { config, models: registered } = entry;
  const live = liveModelsResolver?.(providerAlias) ?? [];
  const allowlist = registered.length > 0 ? registered : live;
  if (allowlist.length > 0 && !allowlist.includes(modelId)) {
    throw new Error(`Model ${modelId} not registered for provider ${providerAlias}`);
  }
  return {
    id: modelId,
    provider: providerAlias,
    api: 'ai-sdk',
    sdk: config.sdk,
    baseUrl: config.baseUrl,
    compat: config.compat,
    reasoning: inferModelReasoning(modelId),
    input: ['text'],
    contextWindow: resolveTransportContextWindow(config, modelId),
    maxTokens: 8_192,
  };
}

export function clearApiRegistryForTests(): void {
  apiProviders.clear();
  providerConfigs.clear();
  liveModelsResolver = undefined;
}

export async function complete(
  model: Model,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  const eventStream = stream(model, context, options);
  let lastMessage: AssistantMessage | undefined;
  for await (const event of eventStream) {
    if (event.type === 'done' && event.message) {
      lastMessage = event.message;
    }
    if (event.type === 'error') {
      throw event.error ?? new Error('Stream failed');
    }
  }
  if (!lastMessage) {
    throw new Error('Stream ended without assistant message');
  }
  return lastMessage;
}

export function stream(
  model: Model,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const registration = apiProviders.get(model.api);
  if (!registration) {
    throw new Error(`No ApiProvider registered for api: ${model.api}`);
  }
  return registration.stream(model, context, options);
}

export function streamSimple(
  model: Model,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const registration = apiProviders.get(model.api);
  if (!registration) {
    throw new Error(`No ApiProvider registered for api: ${model.api}`);
  }
  const fn = registration.streamSimple ?? registration.stream;
  return fn(model, context, options);
}

export async function completeSimple(
  model: Model,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  const eventStream = streamSimple(model, context, options);
  let lastMessage: AssistantMessage | undefined;
  for await (const event of eventStream) {
    if (event.type === 'done' && event.message) {
      lastMessage = event.message;
    }
    if (event.type === 'error') {
      throw event.error ?? new Error('Stream failed');
    }
  }
  if (!lastMessage) {
    throw new Error('Stream ended without assistant message');
  }
  return lastMessage;
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
