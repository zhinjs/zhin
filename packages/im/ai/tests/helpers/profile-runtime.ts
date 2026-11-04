import type { ProviderFixtureConfig } from './provider-fixture-config.js';
/** Synthetic transport fixture using real product Drivers and explicit fixed Profiles.
 * Metadata here declares what each test intends to exercise, not verified provider capabilities. */
import { openAiProvider, anthropicProvider, googleProvider, deepSeekProvider, miniMaxProvider, ollamaProvider, openAiCompatibleProvider } from '../../src/providers/api-key.js';
import { createInferenceRuntime } from '../../src/provider/runtime.js';
import { normalizeProviderGraph } from '../../src/provider/graph.js';
import { providerStateScope } from '../../src/provider/state.js';
import { createProfileReference, resolveProviderProfile } from '../../src/provider/selection.js';
import { DEFAULT_MAX_OUTPUT_TOKENS, type LlmCompletionPort, type StreamOptions, type AssistantStreamEvent } from '../../src/llm/llm-api-runtime.js';
import type {Model} from '../../src/llm/types/model.js';
import type { Context } from '../../src/llm/types/context.js';

export function profileModel(alias: string, config: ProviderFixtureConfig, id: string): Model {
  return { id, provider: alias, api: 'provider', sdk: config.sdk,
    input: [...config.input ?? (config.sdk === 'google' ? ['text', 'image', 'audio', 'video', 'file'] : config.sdk === 'anthropic' || config.sdk === 'openai' ? ['text', 'image'] : ['text'])],
    reasoning: true, contextWindow: config.contextWindow ?? 0, maxTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(config.firstChunkTimeoutMs || config.chunkTimeoutMs ? { streamTimeout: { firstChunkMs: config.firstChunkTimeoutMs, chunkMs: config.chunkTimeoutMs } } : {}) };
}
export function createProfileRuntime(input: { alias: string; config: ProviderFixtureConfig; models: readonly string[]; fetch: typeof globalThis.fetch }) {
  const { alias, config } = input;
  const definition = config.sdk === 'google' ? googleProvider : config.sdk === 'anthropic' ? anthropicProvider : config.sdk === 'deepseek' ? deepSeekProvider
    : config.sdk === 'minimax' ? miniMaxProvider : config.sdk === 'ollama' ? ollamaProvider : config.sdk === 'openai-compatible' ? openAiCompatibleProvider : openAiProvider;
  const protocol = config.sdk === 'google' ? 'google-generate-content' : config.sdk === 'anthropic' || config.sdk === 'minimax' ? 'anthropic-messages' : 'openai-chat';
  const base = { rootId: 'fixture', ownerId: 'fixture', revision: 1 };
  const google = config.providerOptions?.google;
  const thinking = google && typeof google === 'object' && !Array.isArray(google) ? google.thinkingConfig : undefined;
  const level = thinking && typeof thinking === 'object' && !Array.isArray(thinking) ? thinking.thinkingLevel : undefined;
  const safety = google && typeof google === 'object' && !Array.isArray(google) ? google.safetySettings : undefined;
  const selectedLevel = config.thinkingLevel ?? (typeof level === 'string' ? level : undefined);
  const parameters = { ...(config.maxOutputTokens !== undefined ? { maxOutputTokens: config.maxOutputTokens } : {}),
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}), ...(config.timeout !== undefined ? { requestTimeoutMs: config.timeout } : {}),
    ...(config.firstChunkTimeoutMs !== undefined ? { firstChunkTimeoutMs: config.firstChunkTimeoutMs } : {}), ...(config.chunkTimeoutMs !== undefined ? { chunkTimeoutMs: config.chunkTimeoutMs } : {}),
    ...(selectedLevel !== undefined ? { thinkingLevel: selectedLevel } : {}), ...(safety !== undefined ? { safetySettings: safety } : {}) };
  const graph = normalizeProviderGraph({ rootId: 'fixture', revision: 1,
    services: { service: { ...base, id: 'service', driver: { id: definition.id, owner: 'fixture', contractVersion: '1' },
      options: { ...(config.baseUrl || config.host ? { baseUrl: config.baseUrl ?? `${config.host!.replace(/\/$/, '')}/v1` } : {}), ...(config.headers ? { headers: config.headers } : {}), ...(config.authScheme !== undefined ? { authScheme: config.authScheme } : {}),
        ...(config.compat ? { compat: config.compat } : {}), ...(config.contextCache ? { contextCache: config.contextCache } : {}) },
      models: Object.fromEntries(input.models.map(id => { const value = profileModel(alias, config, id); return [id, { id, kinds: ['language'], protocol, input: value.input, ...(value.contextWindow > 0 ? { contextWindow: value.contextWindow } : {}), maxOutputTokens: value.maxTokens, toolCalling: true, thinking: true, streaming: true }]; })) } },
    accounts: { account: { ...base, id: 'account', serviceId: 'service', incarnation: 'fixture', authentication: { method: config.sdk === 'ollama' && !config.apiKey ? 'none' : 'api-key' } } },
    profiles: Object.fromEntries(input.models.map(id => [id, { ...base, id, accountId: 'account', model: id, parameters }])), purposes: { defaults: { chat: input.models[0] } } });
  const context = { rootId: 'fixture', ownerId: 'fixture', hostOwnerId: 'fixture', operationId: 'fixture', sessionKey: 'fixture' };
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph }, drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition, release() {} }) },
    credentials: () => ({ bindRequest: ({ request }) => request, authorize: async () => ({ token: config.apiKey, headers: {}, revision: 'fixture' }) }), fetch: () => input.fetch });
  const opened = runtime.openOperation({ context });
  const binding = (model: Model) => {
    if (model.provider !== alias || !input.models.includes(model.id)) throw new Error('Model is outside this fixed test Profile directory');
    const selected = resolveProviderProfile({ graph, context: { ...context, sessionChat: { id: model.id, rootId: 'fixture', accountId: 'account', accountIncarnation: 'fixture', kind: 'language' } }, kind: 'language', purpose: 'chat' });
    return selected;
  };
  const reference = (model: Model) => createProfileReference({ binding: binding(model), kind: 'language' });
  // Transport tests historically consume SSE. Explicitly exercise the formal stream API,
  // collecting its terminal result rather than constructing a second SDK runtime.
  async function* stream(model: Model, prompt: Context, options: StreamOptions = {}): AsyncGenerator<AssistantStreamEvent> {
    const { signal, ...settings } = options, run = await (await opened).stream({ profile: reference(model), request: { context: prompt, options: settings }, signal });
    try { yield* run; } finally { await run.close(); }
  }
  const complete: LlmCompletionPort['complete'] = async (model, prompt, options) => {
    for await (const event of stream(model, prompt, options)) {
      if (event.type === 'error') throw event.error;
      if (event.type === 'done' && event.message) return event.message;
    }
    throw new Error('Expected a terminal fixture result');
  };
  const generate: LlmCompletionPort['complete'] = async (model, prompt, options = {}) => { const { signal, ...settings } = options; return (await opened).generate({ profile: reference(model), request: { context: prompt, options: settings }, signal }); };
  return { complete, completeSimple: complete, generate, stream, streamSimple: stream, stateScope: (model: Model) => providerStateScope({ binding: binding(model), context }),
    model: (requestedAlias: string, id: string) => { if (requestedAlias !== alias || !input.models.includes(id)) throw new Error('Unknown fixture Profile'); return profileModel(alias, config, id); },
    async dispose() { try { await (await opened).close(); } finally { runtime.retire(); } } };
}
