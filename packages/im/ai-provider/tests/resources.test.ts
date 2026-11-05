import { Scope, SnapshotStore, rootPluginId, childPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { defineProvider } from '@zhin.js/ai/provider';
import { aiProviderDefinitionsToken, provideAiProviders, createSnapshotProviderResolver, describeSnapshotAiProvider, listSnapshotAiProviders } from '../src/index.js';

const root = rootPluginId(), owner = childPluginId(root, 'providers');
function definition(id: string) {
  return defineProvider({ id, contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
    authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: [] }),
    models: service => service.models, createExecution: () => ({}) });
}
function snapshot(scope: Scope): SnapshotState {
  scope.seal();
  return { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'root', packageRoot: '/', children: [owner] }],
    [owner, { id: owner, parent: root, instanceKey: 'providers', packageName: 'providers', packageRoot: '/', children: [] }]]),
    config: new Map(), resources: new Map([[owner, scope.snapshot()]]), capabilities: new Map(), projections: new Map() };
}

it('publishes multiple same-owner Drivers in one immutable setup declaration without a second registry', () => {
  const scope = new Scope(owner);
  const first = definition('first'), second = definition('second');
  provideAiProviders(scope, [first, second]);
  expect(scope.use(aiProviderDefinitionsToken).map(entry => entry.definition.id)).toEqual(['first', 'second']);
  expect(Object.isFrozen(scope.use(aiProviderDefinitionsToken))).toBe(true);
  scope.seal();
  expect(() => provideAiProviders(scope, [definition('third')])).toThrow('sealed');
  const duplicate = new Scope(owner);
  expect(() => provideAiProviders(duplicate, [first, first])).toThrow('Duplicate');
  expect(duplicate.has(aiProviderDefinitionsToken)).toBe(false);
});

it('retains the exact generation Driver after replacement and does not treat retirement as cancellation', async () => {
  const first = definition('first');
  const scope = new Scope(owner); provideAiProviders(scope, [first]);
  const store = new SnapshotStore(snapshot(scope));
  const held = store.acquire();
  const resolver = createSnapshotProviderResolver({ snapshots: store, lease: held });
  const service = { id: 'service', rootId: 'root', ownerId: 'host:test', revision: 1, options: {}, models: {},
    driver: { id: 'first', owner, contractVersion: '1' } };
  const oldLease = await resolver.acquire({ service, signal: new AbortController().signal });
  const next = new Scope(owner); const replacement = definition('first'); provideAiProviders(next, [replacement]);
  store.commit(0, { snapshot: snapshot(next), dispose() {} });
  expect(held.retirementSignal.aborted).toBe(true);
  expect(held.stopSignal.aborted).toBe(false);
  const late = await resolver.acquire({ service, signal: new AbortController().signal });
  expect(oldLease.definition).toBe(first); expect(late.definition).toBe(first);
  expect(describeSnapshotAiProvider({ snapshot: store.current, id: 'first' }).definition).toBe(replacement);
  expect(listSnapshotAiProviders(store.current)).toHaveLength(1);
  await oldLease.release(); await oldLease.release(); await late.release(); held.release();
  await store.close();
});
