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
  it('keeps route guard, Navigation and Layout inheritance on one snapshot', async () => {
    const store = new SnapshotStore(state());
    const runtime = new ConsoleRuntime();
    runtime.attach(store);

    await runtime.runView(
      { permissions: ['status:read'], roles: [] },
      (catalog) => {
        expect(catalog.match('/a/p-status').status).toBe('found');
        expect(catalog.match('/a/p-secret').status).toBe('forbidden');
        expect(catalog.match('/missing').status).toBe('missing');
        expect(catalog.navigation()).toMatchObject([
          { type: 'plugin', label: 'Admin', children: [{ label: 'Status' }] },
          { type: 'page', label: 'Home' },
        ]);
        expect(catalog.layouts(`${rootPluginId()}/a/b` as PluginId, 'nav')
          .map((layout) => layout.module)).toEqual(['/a-nav.js', '/root-nav.js']);
        expect(catalog.fallback(`${rootPluginId()}/a/b` as PluginId)).toBe('/a/p-status');
      },
    );
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

function state(): SnapshotState {
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
    page(root, 'home', { title: 'Home', order: 20 }),
    page(a, 'status', { title: 'Status', order: 10, requiredPermissions: ['status:read'] }),
    page(a, 'secret', { title: 'Secret', order: 20, hideInNav: true, requiredRoles: ['admin'] }),
  ];
  const layoutSlots = [
    layout(root, 'nav', '/root-nav.js'),
    layout(a, 'nav', '/a-nav.js'),
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
      module: `/${localName}.js`,
      hash: `hash-${localName}`,
      ...metadata,
    }),
  });
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
