import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createInferenceRuntime, defineProvider, normalizeProviderGraph, createProfileReference, persistentProfileSelection } from '@zhin.js/ai/provider';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import { SubagentRuntime } from '../../src/subagent/subagent-runtime.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { assistant, context, graphFixture } from '../../../ai/tests/provider/fixtures.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const root = rootPluginId();
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    resources: new Map(), config: new Map(), capabilities: new Map(), projections: new Map() };
  const snapshots = new SnapshotStore(state); let disposed = 0;
  snapshots.commit(0, { snapshot: state, dispose: () => { disposed++; } });
  const original = graphFixture();
  let graph = normalizeProviderGraph({ ...original,
    accounts: { ...original.accounts, alice: { ...original.accounts.account, id: 'alice', ownerId: 'alice' } },
    profiles: { ...original.profiles, private: { ...original.profiles.text, id: 'private', accountId: 'alice', ownerId: 'alice' } },
    purposes: { ...original.purposes, agents: { worker: 'text' } } });
  const privateBinding = { graphRevision: 1, service: graph.services.service, account: graph.accounts.alice,
    profile: graph.profiles.private, model: graph.services.service.models.text };
  const caller = { ...context, ownerId: 'alice', sessionChat: persistentProfileSelection(createProfileReference({ binding: privateBinding, kind: 'language' })) };
  const requests: { revision: number; owner: string; account: string; profile: string }[] = [];
  const entered = deferred<void>(), finish = deferred<void>();
  const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
    authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: [] }), models: service => service.models,
    createExecution(options) { return { language: { generate: async ({ signal }) => {
      requests.push({ revision: options.binding.graphRevision, owner: options.context.ownerId,
        account: options.binding.account.id, profile: options.binding.profile.id }); entered.resolve();
      await Promise.race([finish.promise, new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })]);
      return assistant('child complete');
    }, stream: async () => (async function* () {})() } }; },
  });
  const runtime = new ModelRuntimeService({ rootId: 'root', hostOwnerId: context.hostOwnerId, context: () => caller,
    inferenceFactory: ({ lease }) => createInferenceRuntime({ generationIdentity: lease.value,
      repository: { readGraph: async () => graph },
      drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition, release: () => undefined }) },
      credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ headers: {}, revision: 'one' }) }),
      fetch: () => async () => { throw new Error('No HTTP'); } }) });
  const lease = snapshots.acquire();
  const parent = await runtime.acquireForContext({ lease, snapshots, context: caller });
  return { state, snapshots, runtime, parent, lease, requests, entered, finish,
    retired: () => disposed,
    change: () => { graph = normalizeProviderGraph({ ...graph, revision: 2 }); snapshots.commit(1, { snapshot: state, dispose: () => undefined }); } };
}
const origin = { message: {} as import('@zhin.js/core').Message };

it('retains the actual parent generation before metadata queueing and keeps the child independent of parent completion and HMR', async () => {
  const f = await fixture(), metadata = deferred<null>(), completed = deferred<void>();
  const manager = new SubagentRuntime({ workspace: '/fixture', createTools: () => [], maxIterations: 1,
    resolveAgentMeta: () => metadata.promise, registerSubagentTask: done => { void done.then(() => completed.resolve()); } });
  const spawning = runWithAgentTurnConfiguration({ models: f.parent }, () => manager.spawn({ task: 'test', agent: 'worker', origin }));
  await f.parent.release(); f.lease.release(); f.change(); await f.runtime.dispose();
  expect(f.retired()).toBe(0);
  metadata.resolve(null); await spawning; await f.entered.promise;
  expect(f.requests).toEqual([{ revision: 1, owner: 'alice', account: 'account', profile: 'text' }]);
  f.finish.resolve(); await completed.promise;
  await vi.waitFor(() => expect(f.retired()).toBe(1));
  await manager.dispose(); await f.snapshots.close();
});

it.each(['metadata-rejected', 'disposed-while-queued', 'running-cancelled'] as const)('releases the retained generation exactly once after %s', async outcome => {
  const f = await fixture(), metadata = deferred<null>(), done = deferred<void>();
  const manager = new SubagentRuntime({ workspace: '/fixture', createTools: () => [], maxIterations: 1,
    resolveAgentMeta: async () => { await metadata.promise; if (outcome === 'metadata-rejected') throw new Error('metadata failed'); return null; },
    registerSubagentTask: task => { void task.then(() => done.resolve()); } });
  const spawning = runWithAgentTurnConfiguration({ models: f.parent }, () => manager.spawn({ task: 'test', agent: 'worker', origin }));
  const settled = spawning.then(value => ({ value }), error => ({ error }));
  await f.parent.release(); f.lease.release(); f.change();
  if (outcome === 'disposed-while-queued') await manager.dispose();
  metadata.resolve(null);
  const result = await settled;
  if (outcome === 'running-cancelled') {
    if (!('value' in result)) throw result.error;
    await f.entered.promise;
    const id = result.value.match(/id: ([^)]+)/u)?.[1]; expect(id).toBeDefined(); expect(manager.cancel(id!)).toBe(true);
    await done.promise;
  } else expect('error' in result).toBe(true);
  await vi.waitFor(() => expect(f.retired()).toBe(1));
  if (outcome !== 'running-cancelled') expect(f.requests).toEqual([]);
  await manager.dispose(); await f.snapshots.close();
});


it('admits a later child from an active old parent after HMR, but rejects new root acquisitions and explicit parent stop', async () => {
  const f = await fixture(), completed = deferred<void>();
  const manager = new SubagentRuntime({ workspace: '/fixture', createTools: () => [], maxIterations: 1,
    registerSubagentTask: task => { void task.then(() => completed.resolve()); } });
  f.change(); await f.runtime.dispose();
  const latest = f.snapshots.acquire();
  await expect(f.runtime.acquireForContext({ lease: latest, snapshots: f.snapshots, context })).rejects.toThrow('not-prepared'); latest.release();
  await runWithAgentTurnConfiguration({ models: f.parent }, () => manager.spawn({ task: 'late child', agent: 'worker', origin }));
  await f.entered.promise;
  expect(f.requests).toEqual([{ revision: 1, owner: 'alice', account: 'account', profile: 'text' }]);
  f.finish.resolve(); await completed.promise;
  await f.parent.inference.close();
  expect(() => f.parent.retainDelegation()).toThrow('operation-closed');
  await f.parent.release(); f.lease.release();
  expect(() => f.parent.retainDelegation()).toThrow('not-prepared');
  await vi.waitFor(() => expect(f.retired()).toBe(1));
  await manager.dispose(); await f.snapshots.close();
});
