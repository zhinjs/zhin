/** Standalone real-model probe over formal fixed Profiles. No Host directory is installed or mutated.
 * Candidate capabilities are probe inputs, not upstream-verified discovery observations. */
import { type LlmCompletionPort, type Model } from '@zhin.js/ai';
import { createInferenceRuntime, normalizeProviderGraph, resolveProviderProfile } from '@zhin.js/ai/provider';
import { googleProvider, miniMaxProvider } from '@zhin.js/ai/providers';
import { createInvocationCompletion, invocationModel } from '../../src/model-runtime/completion.js';
import type { NightlyProvider } from './providers.js';

export async function createNightlyInference(input: {
  readonly provider: NightlyProvider;
  readonly modelIds: readonly string[];
  readonly fetch?: typeof globalThis.fetch;
}) {
  const { provider } = input, definition = provider.id === 'gemini' ? googleProvider : miniMaxProvider;
  const resources = { rootId: 'nightly', ownerId: 'nightly', revision: 1 };
  const protocol = provider.id === 'gemini' ? 'google-generate-content' : 'anthropic-messages';
  const models = Object.fromEntries(input.modelIds.map(id => [id, { id, kinds: ['language'] as const, protocol,
    input: provider.id === 'gemini' ? ['text', 'image', 'audio', 'video', 'file'] as const : ['text'] as const,
    streaming: true, toolCalling: true, thinking: provider.id === 'gemini',
    // Unknown context capacity remains unknown; probe ids never imply a native limit.
    ...(provider.config.contextWindow ? { contextWindow: provider.config.contextWindow } : {}) }]));
  const thinking = provider.config.providerOptions?.google;
  const configuredThinking = thinking && typeof thinking === 'object' && !Array.isArray(thinking) ? thinking.thinkingConfig : undefined;
  const level = configuredThinking && typeof configuredThinking === 'object' && !Array.isArray(configuredThinking) ? configuredThinking.thinkingLevel : undefined;
  const graph = normalizeProviderGraph({ rootId: 'nightly', revision: 1,
    services: { service: { ...resources, id: 'service', driver: { id: definition.id, owner: 'nightly', contractVersion: definition.contractVersion },
      options: provider.config.baseUrl ? { baseUrl: provider.config.baseUrl } : {}, models } },
    accounts: { account: { ...resources, id: 'account', serviceId: 'service', incarnation: 'nightly-run', authentication: { method: 'api-key' } } },
    profiles: Object.fromEntries(input.modelIds.map(id => [id, { ...resources, id, accountId: 'account', model: id,
      parameters: { maxRetries: 0, ...(typeof level === 'string' ? { thinkingLevel: level } : {}) } }])),
    purposes: { defaults: { chat: input.modelIds[0] } } });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition, release() {} }) },
    credentials: () => ({ bindRequest: ({ request }) => request, authorize: async () => {
      if (!provider.config.apiKey) throw new Error('Nightly credential is not configured');
      return { token: provider.config.apiKey, headers: {}, revision: 'nightly-run' };
    } }), fetch: () => input.fetch ?? globalThis.fetch });
  const context = { rootId: 'nightly', ownerId: 'nightly', hostOwnerId: 'nightly', operationId: 'nightly-run', sessionKey: 'nightly-run' };
  const client = await runtime.openOperation({ context });
  const completions = new Map<string, LlmCompletionPort>();
  const descriptors: Model[] = [];
  for (const id of input.modelIds) {
    const binding = resolveProviderProfile({ graph, context: { ...context, sessionChat: { id, rootId: 'nightly', accountId: 'account', accountIncarnation: 'nightly-run', kind: 'language' } }, kind: 'language', purpose: 'chat' });
    descriptors.push(invocationModel(binding));
    completions.set(id, createInvocationCompletion({ binding, client, purpose: 'chat' }));
  }
  const complete: LlmCompletionPort['complete'] = (model, context, options) => {
    const port = completions.get(model.id);
    if (!port) throw new Error('Model is outside the fixed nightly Profile directory');
    return port.complete(model, context, options);
  };
  return { models: descriptors, port: { complete, completeSimple: complete },
    async close() { try { await client.close(); } finally { runtime.retire(); } } };
}
