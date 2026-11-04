/** Synthetic model transport installed through the same operation/domain contracts as Host inference.
 * This is deterministic eval evidence; it does not authenticate or contact a provider. */
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createInferenceRuntime, defineProvider, normalizeProviderGraph, type ModelDefinition } from '@zhin.js/ai/provider';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import type { EvalCase } from './fixture.js';
import { PERCEPTION_MODEL_ID, PERCEPTION_PROVIDER_ALIAS, type ScriptedModel } from './scripted-model.js';

export function createEvalInference(model: ScriptedModel, definition: EvalCase) {
  const root = rootPluginId(), ownerId = 'eval-host';
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@zhin.js/agent-evals', packageRoot: '/', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]), capabilities: new Map(), projections: new Map() };
  const snapshots = new SnapshotStore(state);
  const aliases = [model.providerAlias, ...(definition.perception ? [PERCEPTION_PROVIDER_ALIAS] : [])];
  const resources = { rootId: 'root', ownerId, revision: 1 };
  const id = (alias: string, native: string) => JSON.stringify([alias, native]);
  const graph = normalizeProviderGraph({ rootId: 'root', revision: 1,
    services: Object.fromEntries(aliases.map(alias => {
      const ids = alias === model.providerAlias ? model.modelIds : [PERCEPTION_MODEL_ID];
      const models = Object.fromEntries(ids.map(native => {
        const actual = model.runtime.model(alias, native);
        const value: ModelDefinition = { id: native, kinds: ['language'], protocol: 'eval-scripted',
          input: actual.input, streaming: true, toolCalling: true, thinking: true,
          ...(actual.contextWindow ? { contextWindow: actual.contextWindow } : {}), maxOutputTokens: actual.maxTokens };
        return [native, value];
      }));
      return [alias, { ...resources, id: alias, driver: { id: 'eval-scripted', owner: 'root', contractVersion: '1' }, options: {}, models }];
    })),
    accounts: Object.fromEntries(aliases.map(alias => [alias, { ...resources, id: alias, serviceId: alias, incarnation: 'eval-account', authentication: { method: 'none' } }])),
    profiles: Object.fromEntries(aliases.flatMap(alias => (alias === model.providerAlias ? model.modelIds : [PERCEPTION_MODEL_ID])
      .map(native => [id(alias, native), { ...resources, id: id(alias, native), accountId: alias, model: native, parameters: {} }]))),
    purposes: { defaults: { chat: id(model.providerAlias, model.modelId),
      ...(definition.perception ? { perception: { profile: id(PERCEPTION_PROVIDER_ALIAS, PERCEPTION_MODEL_ID),
        fallbacks: (definition.perception.fallbacks ?? []).map(native => id(model.providerAlias, native)) } } : {}) } },
  });
  const driver = defineProvider({ id: 'eval-scripted', contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
    authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: [] }), models: service => service.models,
    describeModel: input => {
      const actual = model.runtime.model(input.service.id, input.model.id);
      return { promptFamily: actual.promptFamily ?? actual.sdk, nativeDeferredTools: actual.nativeDeferredTools ?? actual.sdk === 'anthropic' };
    },
    createExecution: input => {
      const actual = model.runtime.model(input.binding.service.id, input.binding.model.id);
      return { language: {
        generate: ({ request, signal }) => model.runtime.complete(actual, request.context, { ...request.options, signal }),
        stream: async ({ request, signal }) => model.runtime.stream(actual, request.context, { ...request.options, signal }),
      } };
    },
  });
  const runtime = new ModelRuntimeService({ rootId: 'root', hostOwnerId: ownerId,
    context: ({ request }) => ({ rootId: 'root', ownerId, hostOwnerId: ownerId, operationId: request.identity.turnId, sessionKey: request.session.key }),
    inferenceFactory: ({ lease }) => createInferenceRuntime({ repository: { readGraph: async () => graph }, generationIdentity: lease.value,
      drivers: { acquire: async ({ service }) => {
        if (!lease.active || !snapshots.owns(lease)) throw new Error('Eval generation lease expired');
        const retained = snapshots.retain(lease);
        return { definition: driver, reference: service.driver, release: () => retained.release() };
      } },
      credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => { throw new Error('Eval transport cannot read credentials'); } }),
      fetch: () => async () => { throw new Error('Eval transport cannot contact a provider'); },
    }) });
  return { runtime, snapshots, ownerId };
}
