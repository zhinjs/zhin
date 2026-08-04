import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  rootPluginId,
  SnapshotStore,
  type PluginId,
  type PluginNodeSnapshot,
  type RuntimeSnapshot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  LayoutIndex,
  layoutFeatureId,
  type LayoutDefinition,
} from '@zhin.js/layout';
import {
  PageIndex,
  pageFeatureId,
  type PageDefinition,
} from '@zhin.js/page';
import { ConsoleRuntime } from '../../src/plugin-runtime/index.js';

describe('Console Runtime', () => {
  it('resolves pages, navigation, and nearest layouts from one snapshot', async () => {
    const store = new SnapshotStore(state());
    const runtime = new ConsoleRuntime();
    runtime.attach(store);

    await runtime.runView(
      { permissions: ['status:read'], roles: [] },
      (catalog) => {
        const topology = catalog.topology();
        expect(topology.generation).toBe(0);
        expect(topology.resolve('/a/p-status')).toMatchObject({
          status: 'found',
          layouts: { nav: { module: '/a-nav.js' }, footer: { module: '/a-footer.js' } },
        });
        expect(topology.resolve('/a/b/p-overview')).toMatchObject({
          status: 'found',
          layouts: { nav: { module: '/a-nav.js' }, footer: { module: '/a-footer.js' } },
        });
        expect(topology.resolve('/p-home')).toMatchObject({
          status: 'found',
          layouts: { nav: { module: '/root-nav.js' }, footer: { module: '/root-footer.js' } },
        });
        expect(topology.resolve('/a/p-secret')).toEqual({ status: 'forbidden' });
        expect(topology.resolve('/missing')).toEqual({ status: 'missing' });
        expect(topology.navigation).toMatchObject([
          { type: 'plugin', label: 'Admin', children: [{ label: 'Status' }] },
          { type: 'page', label: 'Home' },
        ]);
        expect(catalog.layouts(`${rootPluginId()}/a/b` as PluginId, 'nav')
          .map((layout) => layout.module)).toEqual(['/a-nav.js', '/root-nav.js']);
        expect(catalog.fallback(`${rootPluginId()}/a/b` as PluginId)).toBe('/a/b/p-overview');
      },
    );
  });

  it('does not mix page and layout catalogs across an HMR generation commit', async () => {
    const store = new SnapshotStore(state('v1'));
    const runtime = new ConsoleRuntime();
    runtime.attach(store);
    let continueOldView!: () => void;
    let oldViewReady!: () => void;
    const oldViewStarted = new Promise<void>((resolve) => { oldViewReady = resolve; });
    const waitForCommit = new Promise<void>((resolve) => { continueOldView = resolve; });

    const oldView = runtime.runView({ permissions: ['status:read'], roles: [] }, async (catalog) => {
      const topology = catalog.topology();
      oldViewReady();
      await waitForCommit;
      return {
        generation: topology.generation,
        resolution: topology.resolve('/a/b/p-overview'),
      };
    });
    await oldViewStarted;
    store.commit(0, { snapshot: state('v2'), dispose: () => undefined });
    continueOldView();

    await expect(oldView).resolves.toMatchObject({
      generation: 0,
      resolution: {
        page: { module: '/overview-v1.js' },
        layouts: { nav: { module: '/a-nav-v1.js' }, footer: { module: '/a-footer-v1.js' } },
      },
    });
    await expect(runtime.runView({ permissions: ['status:read'], roles: [] }, (catalog) => {
      const topology = catalog.topology();
      return { generation: topology.generation, resolution: topology.resolve('/a/b/p-overview') };
    })).resolves.toMatchObject({
      generation: 1,
      resolution: {
        page: { module: '/overview-v2.js' },
        layouts: { nav: { module: '/a-nav-v2.js' }, footer: { module: '/a-footer-v2.js' } },
      },
    });
  });

  it('expires a catalog after the view lease is released', async () => {
    const store = new SnapshotStore(state());
    const runtime = new ConsoleRuntime();
    runtime.attach(store);
    let escaped: Parameters<Parameters<ConsoleRuntime['runView']>[1]>[0] | undefined;
    await runtime.runView({ permissions: [], roles: [] }, (catalog) => {
      escaped = catalog;
    });
    expect(() => escaped?.navigation()).toThrow('scope has ended');
  });
});

function state(revision = ''): SnapshotState {
  const root = rootPluginId();
  const a = `${root}/a` as PluginId;
  const b = `${a}/b` as PluginId;
  const tree = new Map<PluginId, PluginNodeSnapshot>([
    [root, plugin(root, 'root', undefined, [a])],
    [a, plugin(a, 'a', root, [b], { displayName: 'Admin', order: 10 })],
    [b, plugin(b, 'b', a, [])],
  ]);
  const base: RuntimeSnapshot = {
    generation: 0,
    root,
    tree,
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
  const pageSlots = [
    page(root, 'home', { title: 'Home', order: 20 }, revision),
    page(a, 'status', { title: 'Status', order: 10, requiredPermissions: ['status:read'] }, revision),
    page(a, 'secret', { title: 'Secret', order: 20, hideInNav: true, requiredRoles: ['admin'] }, revision),
    page(b, 'overview', { title: 'Overview', hideInNav: true }, revision),
  ];
  const layoutSlots = [
    layout(root, 'nav', moduleName('root-nav', revision)),
    layout(root, 'footer', moduleName('root-footer', revision)),
    layout(a, 'nav', moduleName('a-nav', revision)),
    layout(a, 'footer', moduleName('a-footer', revision)),
  ];
  return {
    ...base,
    capabilities: new Map([...pageSlots, ...layoutSlots].map((slot) => [slot.id, slot])),
    projections: new Map([
      [pageFeatureId, new PageIndex(pageSlots, base)],
      [layoutFeatureId, new LayoutIndex(layoutSlots, base)],
    ]),
  };
}

function plugin(
  id: PluginId,
  instanceKey: string,
  parent: PluginId | undefined,
  children: readonly PluginId[],
  metadata?: PluginNodeSnapshot['metadata'],
): PluginNodeSnapshot {
  return Object.freeze({
    id,
    instanceKey,
    packageName: instanceKey,
    packageRoot: `/app/${instanceKey}`,
    parent,
    children: Object.freeze([...children]),
    metadata,
  });
}

function page(
  owner: PluginId,
  localName: string,
  metadata: Partial<PageDefinition>,
  revision: string,
) {
  return createCapabilitySlot<PageDefinition>({
    owner,
    feature: pageFeatureId,
    localName,
    source: `/app/pages/${localName}.tsx`,
    definition: Object.freeze({
      title: localName,
      order: 100,
      hideInNav: false,
      requiredPermissions: Object.freeze([]),
      requiredRoles: Object.freeze([]),
      module: moduleName(localName, revision),
      hash: `hash-${localName}-${revision || 'current'}`,
      ...metadata,
    }),
  });
}

function moduleName(name: string, revision: string): string {
  return `/${name}${revision ? `-${revision}` : ''}.js`;
}

function layout(owner: PluginId, slot: LayoutDefinition['slot'], module: string) {
  return createCapabilitySlot<LayoutDefinition>({
    owner,
    feature: layoutFeatureId,
    localName: slot,
    source: `/app/pages/$${slot}.tsx`,
    definition: Object.freeze({ slot, module, hash: `hash-${slot}` }),
  });
}
