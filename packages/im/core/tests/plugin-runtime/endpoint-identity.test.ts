import { childPluginId, rootPluginId, capabilityId, createSnapshotView } from '@zhin.js/plugin-runtime';
import { adapterFeatureId, type AdapterIndex } from '@zhin.js/adapter';
import { resolveEndpointIdentity } from '../../src/plugin-runtime/im/endpoint-runtime.js';

it('public package alias never selects the first account when root and child have the same endpoint name', () => {
  const root = rootPluginId(); const child = childPluginId(root, 'same');
  const records = [root, child].map(owner => ({ owner, name: 'terminal', id: capabilityId(owner, adapterFeatureId, 'terminal') }));
  const index = { list: () => records, describe: () => records } as unknown as AdapterIndex;
  const snapshot = createSnapshotView(1, { root,
    tree: new Map([root, child].map(id => [id, { id, instanceKey: String(id), packageName: 'minimal-bot', packageRoot: '/fixture', children: [] }])),
    config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map(),
  });
  expect(resolveEndpointIdentity(snapshot, index, 'minimal-bot', 'terminal')).toBeUndefined();
  expect(resolveEndpointIdentity(snapshot, index, 'terminal', 'terminal')).toBeUndefined();
  expect(resolveEndpointIdentity(snapshot, index, String(root), 'terminal')).toBe(records[0]!.id);
  expect(resolveEndpointIdentity(snapshot, index, String(child), 'terminal')).toBe(records[1]!.id);
  expect(resolveEndpointIdentity(snapshot, index, 'minimal-bot', String(records[1]!.id))).toBe(records[1]!.id);
});

it('alias lookup remains pinned to the operation generation when package identities change', () => {
 const root = rootPluginId();
 const record = { owner: root, name: 'terminal', id: capabilityId(root, adapterFeatureId, 'terminal') };
 const index = { list: () => [record], describe: () => [record] } as unknown as AdapterIndex;
 const view = (generation: number, packageName: string) => createSnapshotView(generation, { root,
  tree: new Map([[root, { id: root, instanceKey: 'root', packageName, packageRoot: '/fixture', children: [] }]]),
  config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map(),
 });
 const old = view(1, 'old-bot'); const current = view(2, 'new-bot');
 expect(resolveEndpointIdentity(current, index, 'new-bot', 'terminal')).toBe(record.id);
 expect(resolveEndpointIdentity(current, index, 'old-bot', 'terminal')).toBeUndefined();
 expect(resolveEndpointIdentity(old, index, 'old-bot', 'terminal')).toBe(record.id);
 expect(resolveEndpointIdentity(old, index, 'new-bot', 'terminal')).toBeUndefined();
});
