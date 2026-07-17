import { describe, expect, it } from 'vitest';
import {
  rootPluginId,
  type PluginId,
  type PluginNodeSnapshot,
  type SnapshotState,
} from '@zhin.js/next-kernel';
import { FeatureDiscovery, type DiscoveryHost } from '@zhin.js/next-feature-kit';
import pageFeature, { PageIndex } from '../src/index.js';

describe('Page Feature', () => {
  it('discovers only flat ordinary TS/TSX pages through the client adapter', async () => {
    const loaded: string[] = [];
    const host = memoryHost(
      ['home.tsx', 'service-status.ts', '$nav.tsx', '$other.tsx', 'Bad.tsx'],
      loaded,
    );
    const slots = await new FeatureDiscovery(host).discover(pageFeature, [{
      owner: rootPluginId(),
      packageRoot: '/app',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['home', 'service-status']);
    expect(loaded).toEqual(['/app/pages/home.tsx', '/app/pages/service-status.ts']);
    expect(slots[0]?.definition).toMatchObject({ title: 'Home', module: '/assets/home.js' });
  });

  it('derives immutable routes from owner paths', () => {
    const root = rootPluginId();
    const child = `${root}/admin` as PluginId;
    const snapshot = snapshotWithChild(child);
    const index = new PageIndex([
      slot(root, 'home', '/assets/home.js'),
      slot(child, 'status', '/assets/status.js'),
    ], { generation: 1, ...snapshot });

    expect(index.list().map((page) => page.route)).toEqual(['/p-home', '/admin/p-status']);
    expect(index.route('/admin/p-status')?.owner).toBe(child);
  });
});

function memoryHost(files: readonly string[], loaded: string[]): DiscoveryHost {
  return {
    async list(directory) {
      return directory === '/app/pages'
        ? files.map((name) => ({ name, kind: 'file' as const }))
        : [];
    },
    async loadModule<T>(): Promise<T> { throw new Error('Page source must not execute in Node'); },
    async loadClientModule<T>(source): Promise<T> {
      loaded.push(source);
      const name = source.split('/').at(-1)?.split('.')[0];
      return { module: `/assets/${name}.js`, hash: `hash-${name}` } as T;
    },
    async readText(): Promise<string> { throw new Error('Not used'); },
  };
}

function snapshotWithChild(child: PluginId): SnapshotState {
  const root = rootPluginId();
  return {
    root,
    tree: new Map([
      [root, node({
        id: root,
        instanceKey: 'root',
        packageName: 'root',
        packageRoot: '/app',
        children: [child],
      })],
      [child, node({
        id: child,
        instanceKey: 'admin',
        packageName: 'admin',
        packageRoot: '/app/plugins/admin',
        parent: root,
        children: [],
      })],
    ]),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
}

function node(value: PluginNodeSnapshot): PluginNodeSnapshot {
  return Object.freeze({ ...value, children: Object.freeze([...value.children]) });
}

function slot(owner: PluginId, localName: string, module: string) {
  return {
    id: `${owner}:zhin.page:${localName}` as never,
    owner,
    feature: pageFeature.id,
    localName,
    source: `${module}.tsx`,
    definition: {
      title: localName,
      order: 100,
      hideInNav: false,
      requiredPermissions: [],
      requiredRoles: [],
      module,
      hash: `hash-${localName}`,
    },
  };
}
