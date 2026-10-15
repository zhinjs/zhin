/**
 * Provider test harness: run the real zhin transport (`LlmApiRuntime` →
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
import { createLlmApiRuntime } from '../../../src/llm/llm-runtime-factory.js';
import type { AssistantStreamEvent, LlmApiRuntime, StreamOptions } from '../../../src/llm/llm-api-runtime.js';
import { createUserMessage, type AgentMessage, type AssistantMessage } from '../../../src/llm/types/agent-message.js';
import type { Context } from '../../../src/llm/types/context.js';
import type { Model, ProviderInstanceConfig } from '../../../src/llm/types/model.js';
import type { LlmTool } from '../../../src/llm/types/tool.js';
import type { SdkId } from '../../../src/llm/sdk-registry.js';
import {
  createResilientCompletionPort,
  type ResilientCompletionOptions,
} from '../../../src/llm/provider-resilience.js';
import { AiHttpTransport } from '../../../src/llm/http-transport.js';
import { SdkProviderAdapter } from '../../../src/sdk-provider-adapter.js';
import { createMockFetch, type MockFetch, type RecordedRequest, type Responder } from './mock-fetch.js';

export * from './mock-fetch.js';
export * from './protocols.js';

/** Fake key used by every default config. Tests can assert it never leaks into bodies. */
export const TEST_API_KEY = 'test-key';

/** Default model id and config per sdk; override with `model` / `config`. */
export const PROVIDER_DEFAULTS: Readonly<Record<SdkId, { model: string; config: Omit<ProviderInstanceConfig, 'sdk'> }>> = {
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
  readonly config?: Partial<ProviderInstanceConfig>;
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
  readonly config: ProviderInstanceConfig;
  /** Transport model descriptor (`input`, `contextWindow`, `providerOptions`, ...). */
  readonly model: Model;
  readonly runtime: LlmApiRuntime;
  readonly server: MockFetch;
  /** Shortcut for `server.requests`. */
  readonly requests: RecordedRequest[];
  /** The most recent request (throws if none). */
  lastRequest(): RecordedRequest;
  /** Queue responders (protocol replies, literal responses or functions). */
  reply(...responders: Responder[]): ProviderHarness;
  /** One completion through `LlmApiRuntime.complete` (the agent path, streamed). */
  complete(input: HarnessInput, options?: StreamOptions): Promise<AssistantMessage>;
  /** Same request, collecting every stream event (`text_delta`, `toolcall_delta`, `done`, `error`, ...). */
  events(input: HarnessInput, options?: StreamOptions): Promise<AssistantStreamEvent[]>;
  /** The same runtime wrapped in the #724 resilience layer (retry / timeout / fallback). */
  resilient(options?: ResilientCompletionOptions): {
    complete(input: HarnessInput, options?: StreamOptions): Promise<AssistantMessage>;
  };
  /** An `SdkProviderAdapter` on the same mocked fetch (`completeText`, `listModels`, non-streamed). */
  adapter(): SdkProviderAdapter;
  /** Build the `Context` that `complete()` would send. */
  context(input: HarnessInput): Context;
}

export function createProviderHarness(options: ProviderHarnessOptions): ProviderHarness {
  const defaults = PROVIDER_DEFAULTS[options.sdk];
  const alias = options.alias ?? 'mock';
  const modelId = options.model ?? defaults.model;
  const config: ProviderInstanceConfig = { ...defaults.config, ...options.config, sdk: options.sdk };
  const server = createMockFetch(options.responses ?? []);
  const runtime = createLlmApiRuntime([{ alias, config, models: [modelId], fetch: server.fetch }], () => [modelId]);
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
      const port = createResilientCompletionPort(runtime, resilienceOptions);
      return { complete: (input, streamOptions) => port.complete(model, context(input), streamOptions) };
    },
    adapter: () => new SdkProviderAdapter(alias, options.sdk, config, [modelId], new AiHttpTransport({ fetch: server.fetch })),
    context,
  };
  return harness;
}
