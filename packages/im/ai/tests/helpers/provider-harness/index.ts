import type { ProviderFixtureConfig } from '../provider-fixture-config.js';
import { createProfileRuntime } from '../profile-runtime.js';
/**
 * Provider test harness: run the real zhin transport (fixed Profiles →
 * `streamText` → `@ai-sdk/*`) against a mocked HTTP endpoint.
 *
 * ```ts
 * const h = createProviderHarness({ sdk: 'openai' });
 * h.reply(openaiChat.reply({ text: 'hi', usage: { prompt: 10, completion: 2 } }));
 * const message = await h.complete('hello');
 * expect(h.requests[0].body.messages).toEqual([...]);
 * ```
 *
 * See README.md next to this file for the full API.
 */

import type { AssistantStreamEvent, StreamOptions } from '../../../src/llm/llm-api-runtime.js';
import { createUserMessage, type AgentMessage, type AssistantMessage } from '../../../src/llm/types/agent-message.js';
import type { Context } from '../../../src/llm/types/context.js';
import type {Model} from '../../../src/llm/types/model.js';
import type { LlmTool } from '../../../src/llm/types/tool.js';
import type { SdkId } from '../../../src/llm/sdk-registry.js';
import {
  createResilientCompletionPort,
  type ResilientCompletionOptions,
} from '../../../src/llm/provider-resilience.js';
import { fixedProfileClient } from '../fixed-profile-client.js';
import { openAiProvider, openAiCompatibleProvider, googleProvider, anthropicProvider } from '../../../src/providers/api-key.js';
import { createMockFetch, type MockFetch, type MockResponse, type RecordedRequest, type Responder } from './mock-fetch.js';
import { anthropicMessages, geminiGenerate, openaiChat } from './protocols.js';

export * from './mock-fetch.js';
export * from './protocols.js';

/** Fake key used by every default config. Tests can assert it never leaks into bodies. */
export const TEST_API_KEY = 'test-key';

/** Default model id and config per sdk; override with `model` / `config`. */
export const PROVIDER_DEFAULTS: Readonly<Record<SdkId, { model: string; config: Omit<ProviderFixtureConfig, 'sdk'> }>> = {
  openai: { model: 'gpt-5.4-mini', config: { apiKey: TEST_API_KEY } },
  anthropic: { model: 'claude-haiku-4-5-20251001', config: { apiKey: TEST_API_KEY } },
  google: { model: 'gemini-3.8-flash', config: { apiKey: TEST_API_KEY } },
  deepseek: { model: 'deepseek-v4-flash', config: { apiKey: TEST_API_KEY } },
  minimax: { model: 'minimax-m3', config: { apiKey: TEST_API_KEY } },
  ollama: { model: 'qwen3:8b', config: {} },
  'openai-compatible': { model: 'mock-model', config: { apiKey: TEST_API_KEY, baseUrl: 'https://gateway.test/v1' } },
};

/** Which wire protocol each sdk speaks (pick the matching builder from protocols.ts). */
export const PROVIDER_PROTOCOL: Readonly<Record<SdkId, 'openai-chat' | 'anthropic-messages' | 'gemini'>> = {
  openai: 'openai-chat',
  deepseek: 'openai-chat',
  ollama: 'openai-chat',
  'openai-compatible': 'openai-chat',
  anthropic: 'anthropic-messages',
  minimax: 'anthropic-messages',
  google: 'gemini',
};

export interface ProviderHarnessOptions {
  readonly sdk: SdkId;
  /** Model id. Defaults to {@link PROVIDER_DEFAULTS}. */
  readonly model?: string;
  /** Merged over the sdk default config (`sdk` is always `options.sdk`). */
  readonly config?: Partial<ProviderFixtureConfig>;
  /** Provider alias. Default `'mock'`. */
  readonly alias?: string;
  /** Initial response queue. More can be added with `reply()`. */
  readonly responses?: readonly Responder[];
}

/** Input accepted by `complete()` / `events()`: a user text, or a (partial) context. */
export type HarnessInput =
  | string
  | {
    readonly system?: string;
    readonly messages?: readonly AgentMessage[];
    /** Shorthand: appended as the last user message. */
    readonly user?: string;
    readonly tools?: readonly LlmTool[];
  };

export interface ProviderHarness {
  readonly sdk: SdkId;
  readonly alias: string;
  readonly modelId: string;
  readonly config: ProviderFixtureConfig;
  /** Transport model descriptor (`input`, `contextWindow`, `providerOptions`, ...). */
  readonly model: Model;
  readonly runtime: ReturnType<typeof createProfileRuntime>;
  readonly server: MockFetch;
  /** Shortcut for `server.requests`. */
  readonly requests: RecordedRequest[];
  /** The most recent request (throws if none). */
  lastRequest(): RecordedRequest;
  /** Queue responders (protocol replies, literal responses or functions). */
  reply(...responders: Responder[]): ProviderHarness;
  /** One completion through `InferenceClient.stream` (the agent path, streamed). */
  complete(input: HarnessInput, options?: StreamOptions): Promise<AssistantMessage>;
  /** Same request, collecting every stream event (`text_delta`, `toolcall_delta`, `done`, `error`, ...). */
  events(input: HarnessInput, options?: StreamOptions): Promise<AssistantStreamEvent[]>;
  /** The same runtime wrapped in the #724 resilience layer (retry / timeout / fallback). */
  resilient(options?: ResilientCompletionOptions): {
    complete(input: HarnessInput, options?: StreamOptions): Promise<AssistantMessage>;
  };
  /** Actual fixed-Profile Driver consumption and explicit discovery on the same synthetic fetch. */
  adapter(): ReturnType<typeof fixedProfileClient> & { readonly name: string; readonly models: string[]; listModels(): Promise<string[]> };
  /** Build the `Context` that `complete()` would send. */
  context(input: HarnessInput): Context;
  /**
   * Request-shape tests: answer one request with a protocol-correct 400, swallow the
   * error and return what the SDK sent. `options.maxRetries` defaults to 0.
   */
  capture(input: HarnessInput, options?: StreamOptions): Promise<RecordedRequest>;
}

/** A 400 in the wire format of `sdk`, used by `capture()`. */
function stopHereError(sdk: SdkId): MockResponse {
  const message = 'provider-harness: stop here';
  switch (PROVIDER_PROTOCOL[sdk]) {
    case 'anthropic-messages':
      return anthropicMessages.error(400, { type: 'invalid_request_error', message });
    case 'gemini':
      return geminiGenerate.error(400, { message, status: 'INVALID_ARGUMENT' });
    default:
      return openaiChat.error(400, { message, type: 'invalid_request_error' });
  }
}

export function createProviderHarness(options: ProviderHarnessOptions): ProviderHarness {
  const defaults = PROVIDER_DEFAULTS[options.sdk];
  const alias = options.alias ?? 'mock';
  const modelId = options.model ?? defaults.model;
  const config: ProviderFixtureConfig = { ...defaults.config, ...options.config, sdk: options.sdk };
  const server = createMockFetch(options.responses ?? []);
  const runtime = createProfileRuntime({ alias, config, models: [modelId], fetch: server.fetch });
  const model = runtime.model(alias, modelId);

  const context = (input: HarnessInput): Context => {
    if (typeof input === 'string') return { systemPrompt: '', messages: [createUserMessage(input)] };
    const messages = [...(input.messages ?? [])];
    if (input.user !== undefined) messages.push(createUserMessage(input.user));
    return { systemPrompt: input.system ?? '', messages, ...(input.tools ? { tools: [...input.tools] } : {}) };
  };

  const harness: ProviderHarness = {
    sdk: options.sdk,
    alias,
    modelId,
    config,
    model,
    runtime,
    server,
    requests: server.requests,
    lastRequest() {
      const last = server.requests.at(-1);
      if (!last) throw new Error('provider-harness: no request was sent');
      return last;
    },
    reply(...responders) {
      server.enqueue(...responders);
      return harness;
    },
    complete: (input, streamOptions) => runtime.complete(model, context(input), streamOptions),
    async events(input, streamOptions) {
      const events: AssistantStreamEvent[] = [];
      try {
        for await (const event of runtime.stream(model, context(input), streamOptions)) events.push(event);
      } catch {
        // The `error` event is already collected.
      }
      return events;
    },
    resilient(resilienceOptions) {
      const selected = [modelId];
      const fixed = createProfileRuntime({ alias, config, models: selected, fetch: server.fetch });
      const port = createResilientCompletionPort(fixed, resilienceOptions);
      return { complete: (input, streamOptions) => port.complete(model, context(input), streamOptions) };
    },
    adapter: () => {
      const client = fixedProfileClient({ ...config, models: [modelId] }, server.fetch);
      return { ...client, name: alias, models: [modelId], async listModels() {
        const definition = options.sdk === 'google' ? googleProvider : options.sdk === 'anthropic' ? anthropicProvider
          : options.sdk === 'openai-compatible' ? openAiCompatibleProvider : openAiProvider;
        const service = { id: 'service', rootId: 'root', ownerId: 'host', revision: 1, driver: { id: definition.id, owner: 'root', contractVersion: '1' },
          options: definition.serviceSchema.parse({ ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(config.headers ? { headers: config.headers } : {}),
            ...(config.authScheme !== undefined ? { authScheme: config.authScheme } : {}) }), models: {} };
        return (await definition.discover!({ service, credentials: { bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: TEST_API_KEY, headers: {}, revision: '1' }) }, fetch: server.fetch,
          signal: new AbortController().signal })).map(item => item.id);
      } };
    },
    context,
    async capture(input, streamOptions) {
      const before = server.requests.length;
      server.enqueue(stopHereError(options.sdk));
      await runtime.complete(model, context(input), { maxRetries: 0, ...streamOptions }).catch(() => undefined);
      if (server.requests.length !== before + 1) {
        throw new Error(`provider-harness: capture() expected 1 request, got ${server.requests.length - before}`);
      }
      return server.requests.at(-1)!;
    },
  };
  return harness;
}
