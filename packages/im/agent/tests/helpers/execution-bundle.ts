import type { LlmCompletionPort, Model } from '@zhin.js/ai';
import type { ProviderExecution } from '@zhin.js/ai/provider';
import type { ModelExecutionBundle, ModelExecutionCandidate } from '../../src/model-runtime/types.js';
export function executionCandidate(bundle: ModelExecutionBundle): ModelExecutionCandidate {
  return { binding: bundle.binding, resolve: async () => bundle };
}
/** Test a consuming boundary with a real completion port and canonical model metadata. */
export function executionBundle(input: Readonly<{ model: Model; completion: LlmCompletionPort; profile?: string }>): ModelExecutionBundle {
  const rootId = 'root';
  const accountId = input.model.provider;
  const ownerId = 'host';
  const revision = 1;
  return { model: { ...input.model, promptFamily: input.model.promptFamily ?? input.model.sdk,
    nativeDeferredTools: input.model.nativeDeferredTools ?? input.model.sdk === 'anthropic' }, completion: input.completion, binding: {
    graphRevision: 1,
    service: { id: accountId, rootId, ownerId, revision, driver: { id: 'fixture', owner: 'root/provider', contractVersion: '1' },
      options: {}, models: { [input.model.id]: { id: input.model.id, protocol: input.model.sdk ?? 'fixture', kinds: ['language'], toolCalling: true,
        input: input.model.input, ...(input.model.contextWindow > 0 ? { contextWindow: input.model.contextWindow } : {}), ...(input.model.maxTokens > 0 ? { maxOutputTokens: input.model.maxTokens } : {}) } } },
    account: { id: accountId, rootId, ownerId, revision, serviceId: accountId, incarnation: 'one', authentication: { method: 'none' } },
    profile: { id: input.profile ?? accountId, rootId, ownerId, revision, accountId, model: input.model.id, parameters: {} },
    model: { id: input.model.id, protocol: input.model.sdk ?? 'fixture', kinds: ['language'], toolCalling: true, input: input.model.input,
      ...(input.model.contextWindow > 0 ? { contextWindow: input.model.contextWindow } : {}), ...(input.model.maxTokens > 0 ? { maxOutputTokens: input.model.maxTokens } : {}) },
  } };
}

export async function executionScope(input: Readonly<{
  chat: ModelExecutionBundle;
  summary?: ModelExecutionBundle;
}>): Promise<import('../../src/model-runtime/types.js').ModelExecutionScope> {
  const { createInferenceRuntime, normalizeProviderGraph } = await import('@zhin.js/ai/provider');
  const bundles = [input.chat, ...(input.summary ? [input.summary] : [])];
  const graph = normalizeProviderGraph({ rootId: 'root', revision: 1,
    services: Object.fromEntries(bundles.map(item => [item.binding.service.id, item.binding.service])),
    accounts: Object.fromEntries(bundles.map(item => [item.binding.account.id, item.binding.account])),
    profiles: Object.fromEntries(bundles.map(item => [item.binding.profile.id, item.binding.profile])),
    purposes: { defaults: { chat: input.chat.binding.profile.id,
      ...(input.summary ? { summary: input.summary.binding.profile.id } : {}) } },
  });
  const context = { rootId: 'root', ownerId: 'host', hostOwnerId: 'host', operationId: 'fixture', sessionKey: 'fixture' };
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition: {
      id: 'fixture', contractVersion: '1', authentication: { methods: ['none'] }, serviceSchema: { parse: value => value },
      targets: () => ({ authentication: [], inference: [] }), models: value => value.models,
      createExecution: ({ binding }) => {
        const generate: NonNullable<ProviderExecution['language']>['generate'] = async ({ request, signal }) => {
          const bundle = bundles.find(item => item.binding.profile.id === binding.profile.id)!;
          return bundle.completion.complete(bundle.model, request.context, { ...request.options, signal });
        };
        return { language: { generate, stream: async input => (async function* () {
          yield { type: 'done' as const, message: await generate(input) };
        })() } };
      },
    }, release: () => undefined }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ revision: '1', headers: {} }) }),
    fetch: () => async () => { throw new Error('No network'); },
  });
  const scope = await runtime.openScope({ context });
  return { chat: input.chat, ...(input.summary ? { summary: executionCandidate(input.summary) } : {}), graph, context, inference: scope.client, inferenceSnapshot: scope.snapshot, resolve: scope.resolve,
    policyRevision: 1, summarySource: input.summary ? 'runtime' : 'deployment-chat',
    // Consumer-boundary tests have no plugin generation. Snapshot retention itself is
    // covered by ModelRuntimeService + SubagentRuntime integration, not this fixture.
    retainDelegation: () => {
      const children: ReturnType<typeof executionScope>[] = [];
      let closed: Promise<void> | undefined;
      const release = (): Promise<void> => closed ??= (async () => {
        await Promise.allSettled(children.map(async child => (await child).release()));
      })();
      return { acquire: async () => {
        if (closed) throw new Error('Fixture delegation already released');
        const child = executionScope(input); children.push(child); return child;
      }, release };
    },
    release: async () => { await scope.close(); runtime.retire(); } };
}
