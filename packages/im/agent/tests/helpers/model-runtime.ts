import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createInferenceRuntime, normalizeProviderGraph, ProviderBindingResourceOwner,
  type ProviderGraph, type ProviderCallContext, type ProviderExecution } from '@zhin.js/ai/provider';
import { graphFixture, context, assistant } from '../../../ai/tests/provider/fixtures.js';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import type { ModelRuntimeServiceOptions } from '../../src/model-runtime/types.js';

export function modelRuntimeFixture(options: Readonly<{
  graph?: ProviderGraph;
  execution?: ProviderExecution;
  authorize?: Parameters<typeof createInferenceRuntime>[0]['canUseProfile'];
}> = {}) {
  const root = rootPluginId();
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    resources: new Map(), config: new Map(), capabilities: new Map(), projections: new Map() };
  const snapshots = new SnapshotStore(state), resources = new ProviderBindingResourceOwner(() => undefined);
  let graph = options.graph ?? graphFixture(), error: unknown;
  const calls = { reads: 0, requests: [] as string[], releases: 0, factories: 0 };
  const definition = { id: 'fixture', contractVersion: '1', authentication: { methods: ['none'] as const },
    targets: () => ({ authentication: [], inference: [] }), serviceSchema: { parse: (value: unknown) => value },
    models: (service: ProviderGraph['services'][string]) => service.models,
    createExecution: () => { calls.factories++; return options.execution ?? { language: { generate: async ({ request }: { request: unknown }) => {
      calls.requests.push(JSON.stringify(request)); return assistant();
    }, stream: async () => (async function* () { yield { type: 'done' as const, message: assistant() }; })() } }; },
  };
  const runtimeOptions: ModelRuntimeServiceOptions = { rootId: 'root', hostOwnerId: context.hostOwnerId,
    context: ({ request }) => ({ ...context, operationId: request.identity.turnId, sessionKey: request.session.key }),
    inferenceFactory: ({ lease }) => createInferenceRuntime({ repository: { readGraph: async () => { calls.reads++; if (error) throw error; return graph; } },
      drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition, release: () => { calls.releases++; } }) },
      credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ headers: {}, revision: '1' }) }),
      fetch: () => async () => { throw new Error('Network prohibited'); }, canUseProfile: options.authorize, resources, generationIdentity: lease.value }),
  };
  const runtime = new ModelRuntimeService(runtimeOptions);
  const acquire = async (patch: Partial<ProviderCallContext> = {}, bindingName?: string) => {
    const lease = snapshots.acquire();
    try { const scope = await runtime.acquireForContext({ lease, snapshots, context: { ...context, ...patch }, bindingName });
      return { ...scope, release: async () => { try { await scope.release(); } finally { lease.release(); } } };
    } catch (failure) { lease.release(); throw failure; }
  };
  return { runtime, runtimeOptions, snapshots, calls, acquire, get graph() { return graph; },
    update: (next: unknown) => { graph = normalizeProviderGraph(next); }, failRead: (failure: unknown) => { error = failure; } };
}
