import type { FixtureTextOptions } from './text-provider-fixture.js';
import type { ProviderFixtureConfig } from './provider-fixture-config.js';
import { createInferenceRuntime } from '../../src/provider/runtime.js';
import { normalizeProviderGraph } from '../../src/provider/graph.js';
import { openAiProvider, googleProvider, anthropicProvider, openAiCompatibleProvider } from '../../src/providers/api-key.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import { assistantAnswerText } from '../../src/llm/convert/openai-bridge.js';
import { createResilientCompletionPort, resolveProviderResilienceConfig } from '../../src/llm/provider-resilience.js';
import type {Model} from '../../src/llm/types/model.js';
import type { LlmCompletionPort, StreamOptions } from '../../src/llm/llm-api-runtime.js';
import type {TextCompleteResult} from '../../src/types.js';

/** Consumer test fixture: every completion uses a real Driver and a fixed formal graph. */
export function fixedProfileClient(config: ProviderFixtureConfig, fetch: typeof globalThis.fetch = globalThis.fetch) {
  const definition = config.sdk === 'google' ? googleProvider : config.sdk === 'anthropic' ? anthropicProvider
    : config.sdk === 'openai-compatible' ? openAiCompatibleProvider : openAiProvider;
  const modelId = config.defaultModel ?? config.models?.[0] ?? 'primary';
  const protocol = config.sdk === 'google' ? 'google-generate-content' : config.sdk === 'anthropic' ? 'anthropic-messages' : 'openai-chat';
  const base = { rootId: 'root', ownerId: 'host', revision: 1 };
  const service = { ...base, id: 'service', driver: { id: definition.id, owner: 'root', contractVersion: '1' },
    options: { ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(config.headers ? { headers: config.headers } : {}),
      ...(config.authScheme !== undefined ? { authScheme: config.authScheme } : {}), ...(config.compat ? { compat: config.compat } : {}),
      ...(config.contextCache ? { contextCache: config.contextCache } : {}) },
    models: { [modelId]: { id: modelId, kinds: ['language'] as const, protocol, input: ['text'] as const, toolCalling: true, streaming: true } } };
  const graph = normalizeProviderGraph({ rootId: 'root', revision: 1, services: { service },
    accounts: { account: { ...base, id: 'account', serviceId: 'service', incarnation: 'first', authentication: { method: 'api-key' } } },
    profiles: { selected: { ...base, id: 'selected', accountId: 'account', model: modelId, parameters: {} } }, purposes: { defaults: { chat: 'selected' } } });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async () => ({ reference: service.driver, definition, release() {} }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: config.apiKey ?? 'synthetic-key', headers: {}, revision: '1' }) }), fetch: () => fetch });
  const context = { rootId: 'root', ownerId: 'host', hostOwnerId: 'host', operationId: 'fixture', sessionKey: 'fixture' };
  const opened = runtime.openOperation({ context });
  const model: Model = { id: modelId, provider: 'service', api: 'fixture', input: ['text'], contextWindow: 128000, maxTokens: 8192 };
  const complete: LlmCompletionPort['complete'] = async (_model, context, options) => {
    const { signal, ...settings } = options ?? {};
    return (await opened).generate({ request: { context, options: settings }, signal });
  };
  const completion: LlmCompletionPort = { complete, completeSimple: complete };
  async function completeTextResult(system: string, user: string, options: FixtureTextOptions = {}): Promise<TextCompleteResult> {
    if (options.model && options.model !== modelId) throw new Error('Fixed Profile cannot switch models');
    const resilient = createResilientCompletionPort(completion, { config: resolveProviderResilienceConfig(options.resilience, { requestTimeoutMs: options.timeoutMs }) });
    const response = await resilient.complete(model, { systemPrompt: system, messages: [createUserMessage(user)] }, options as StreamOptions);
    return { text: assistantAnswerText(response), model: modelId, usage: response.usage };
  }
  return { runtime, model, completion, completeTextResult,
    completeText: async (system: string, user: string, options?: FixtureTextOptions) => (await completeTextResult(system, user, options)).text,
    async dispose() { await (await opened).close(); runtime.retire(); } };
}
