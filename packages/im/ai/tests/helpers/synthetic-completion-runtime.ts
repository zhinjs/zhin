import type { ProviderFixtureConfig } from './provider-fixture-config.js';
/** Callback-only fixture for engine tests and scripted evals. It never creates an SDK,
 * reads a credential, discovers a model or performs network I/O. */
import type { LanguageModel } from 'ai';
import type {Model, ModelApi} from '../../src/llm/types/model.js';
import type { Context } from '../../src/llm/types/context.js';
import { DEFAULT_MAX_OUTPUT_TOKENS, type ApiProviderRegistration, type LlmCompletionPort,
  type AssistantStreamEvent, type AssistantMessageEventStream, type StreamOptions, type AssistantMessage } from '../../src/llm/llm-api-runtime.js';

interface RegisteredProvider { config: ProviderFixtureConfig; models: string[]; fetch?: typeof globalThis.fetch }
function languageModelKey(alias: string, id: string): string { return JSON.stringify([alias, id]); }
function syntheticModel(provider: string, config: ProviderFixtureConfig, id: string): Model {
  return { id, provider, api: 'ai-sdk', sdk: config.sdk, input: [...config.input ?? ['text']],
    contextWindow: config.contextWindow ?? 0, maxTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS };
}

export class SyntheticCompletionRuntime implements LlmCompletionPort {
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
    config: ProviderFixtureConfig,
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
  providerConfig(providerAlias: string): Readonly<ProviderFixtureConfig> | undefined {
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
    return syntheticModel(providerAlias, entry.config, modelId);
  }

  registerLanguageModel(alias: string, modelId: string, model: LanguageModel): this {
    this.#languageModels.set(languageModelKey(alias, modelId), model);
    return this;
  }

  resolveLanguageModel(alias: string, modelId: string): LanguageModel | undefined {
    const key = languageModelKey(alias, modelId);
    const existing = this.#languageModels.get(key);
    if (existing) return existing;
    return undefined;
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
    return this.consumeCompletion(resolved => this.stream(model, context, resolved), options);
  }

  async completeSimple(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): Promise<AssistantMessage> {
    return this.consumeCompletion(resolved => this.streamSimple(model, context, resolved), options);
  }

  private consumeCompletion(open: (options?: StreamOptions) => AssistantMessageEventStream, options?: StreamOptions): Promise<AssistantMessage> {
    const cancellation = options?.onTextDelta ? new AbortController() : undefined;
    const resolved = cancellation ? { ...options,
      signal: options?.signal ? AbortSignal.any([options.signal, cancellation.signal]) : cancellation.signal,
    } : options;
    return this.consume(open(resolved), resolved, cancellation);
  }

  private async consume(eventStream: AssistantMessageEventStream, options?: StreamOptions, cancellation?: AbortController): Promise<AssistantMessage> {
    let lastMessage: AssistantMessage | undefined;
    for await (const event of eventStream) {
      if (event.type === 'text_delta' && event.text) {
        try { options?.onTextDelta?.(event.text); }
        catch (error) { cancellation?.abort(error); throw error; }
      }
      if (event.type === 'done' && event.message) lastMessage = event.message;
      if (event.type === 'error') throw event.error ?? new Error('Stream failed');
    }
    if (!lastMessage) throw new Error('Stream ended without assistant message');
    return lastMessage;
  }
}
