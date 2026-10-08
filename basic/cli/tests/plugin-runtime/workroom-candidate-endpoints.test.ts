import { adapterFeatureId } from '@zhin.js/adapter';
import { childPluginId, createSnapshotView, rootPluginId } from '@zhin.js/plugin-runtime';
import { readConfiguredEndpointKeys } from '../../src/plugin-runtime/start-command.js';

it('validates root-local endpoints from the exact projected candidate without reading mutable config', async () => {
  const root = rootPluginId();
  const rows = [{ owner: root, name: 'terminal' }];
  const snapshot = createSnapshotView(2, {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'minimal-bot', packageRoot: '/fixture', children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map(),
    projections: new Map([[adapterFeatureId, { $projection: 'zhin.adapter-index/1', describe: () => rows }]]),
  });
  const config = { read: vi.fn(() => { throw new Error('must not read another configuration generation'); }), prepare: vi.fn() };
  const first = await readConfiguredEndpointKeys(config as never, snapshot);
  expect(first).toEqual(new Set(['root:terminal', 'minimal-bot:terminal']));
  rows[0] = { owner: root, name: 'replacement' };
  const second = await readConfiguredEndpointKeys(config as never, snapshot);
  expect(second.has('minimal-bot:terminal')).toBe(false);
  expect(second.has('minimal-bot:replacement')).toBe(true);
  expect(first.has('minimal-bot:terminal')).toBe(true);
  expect(config.read).not.toHaveBeenCalled();
});

it('does not authorize ambiguous package aliases from distinct owners', async () => {
  const root = rootPluginId(); const child = childPluginId(root, 'second');
  const snapshot = createSnapshotView(1, {
    root, tree: new Map([root, child].map(id => [id, { id, instanceKey: String(id), packageName: 'minimal-bot', packageRoot: '/fixture', children: [] }])),
    config: new Map(), resources: new Map(), capabilities: new Map(),
    projections: new Map([[adapterFeatureId, { $projection: 'zhin.adapter-index/1', describe: () => [{ owner: root, name: 'terminal' }, { owner: child, name: 'terminal' }] }]]),
  });
  const keys = await readConfiguredEndpointKeys({}, snapshot);
  expect(keys.has('minimal-bot:terminal')).toBe(false);
  expect(keys).toEqual(new Set(['root:terminal', `${child}:terminal`]));
});

it('a candidate without an Adapter projection cannot authorize config-only or previous-generation endpoints', async () => {
 const root = rootPluginId();
 const candidate = createSnapshotView(3, { root, tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() });
 expect(await readConfiguredEndpointKeys({ plugins: { sandbox: {} } } as never, candidate)).toEqual(new Set());
});
