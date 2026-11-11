import { afterEach, expect, it } from 'vitest';
import {
  SnapshotStore, childPluginId, definePluginConsoleRpc, pluginConsoleRpcToken, rootPluginId, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  collectPluginPermissionCatalog,
  createPluginPermissionCatalogSource,
} from '../../../src/instance/console/plugin-permission-catalog.js';
import { composeHostConsoleRpc } from '../../../src/instance/console/tool-approvals.js';

const stores: SnapshotStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });

const root = rootPluginId(), rss = childPluginId(root, 'rss'), nested = childPluginId(rss, 'nested');
const handler = async () => null;

function store(generationRpc = definePluginConsoleRpc({
  permissions: [{ id: 'rss:write', level: 'operate', description: '编辑订阅' }],
  status: { handler, requiredPermissions: ['rss:read'] },
  actions: { add: { handler, requiredPermissions: ['rss:write'], anyOfPermissions: ['rss:legacy-write', 'status.view'] } },
})) {
  const state: SnapshotState = {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [rss] }],
      [rss, { id: rss, instanceKey: 'rss', packageName: 'rss', packageRoot: '/app/rss', parent: root, children: [nested] }],
      [nested, { id: nested, instanceKey: 'nested', packageName: 'nested', packageRoot: '/app/nested', parent: rss, children: [] }],
    ]),
    config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([
      [root, new Map()],
      [rss, new Map([[pluginConsoleRpcToken.id, generationRpc]])],
      // Inherited binding: only the declaring owner is collected.
      [nested, new Map([[pluginConsoleRpcToken.id, generationRpc]])],
    ]),
  };
  const value = new SnapshotStore(state);
  stores.push(value);
  return value;
}

it('collects used and declared plugin permissions with levels, including Host-owned root methods', () => {
  const snapshots = store();
  const lease = snapshots.acquire();
  try {
    const host = composeHostConsoleRpc(
      definePluginConsoleRpc({ queries: { cards: { handler, anyOfPermissions: ['ops:approve', 'tool_approvals:read'] } } }),
      definePluginConsoleRpc({ permissions: [{ id: 'ambient:tune', level: 'manage' }], actions: { tune: { handler, requiredPermissions: ['ambient:tune'] } } }),
    );
    expect(host.permissions).toEqual([{ id: 'ambient:tune', level: 'manage' }]);
    const catalog = collectPluginPermissionCatalog(lease.value, host);
    expect(catalog.map(entry => [entry.id, entry.level, entry.declared])).toEqual([
      ['ambient:tune', 'manage', true],
      ['ops:approve', 'manage', false],
      ['rss:legacy-write', 'operate', false],
      ['rss:read', 'read', false],
      ['rss:write', 'operate', true],
      ['tool_approvals:read', 'read', false],
    ]);
    expect(catalog.find(entry => entry.id === 'rss:write')).toMatchObject({ owners: [rss], description: '编辑订阅' });
  } finally {
    lease.release();
  }
});

it('caches the catalog per generation', () => {
  const snapshots = store();
  let built = 0;
  const source = createPluginPermissionCatalogSource({
    snapshots,
    hostConsoleRpc: () => { built += 1; return definePluginConsoleRpc({ status: { handler, requiredPermissions: ['ops:read'] } }); },
  });
  const first = source();
  expect(source()).toBe(first);
  expect(built).toBe(1);
  expect(first.map(entry => entry.id)).toContain('ops:read');
});
