import { describe, expect, it } from 'vitest';
import {
  rootPluginId,
  type PluginId,
  type PluginNodeSnapshot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { FeatureDiscovery, type DiscoveryHost } from '@zhin.js/feature-kit';
import layoutFeature, { LayoutIndex } from '../src/index.js';

describe('Layout Feature', () => {
  it('discovers only the two reserved TSX slots without executing them', async () => {
    const host: DiscoveryHost = {
      async list(directory) {
        return directory === '/app/pages'
          ? ['$footer.tsx', '$nav.tsx', '$nav.ts', '$other.tsx', 'home.tsx']
              .map((name) => ({ name, kind: 'file' as const }))
          : [];
      },
      async loadModule<T>(): Promise<T> { throw new Error('Layout source must not execute in Node'); },
      async loadClientModule<T>(source): Promise<T> {
        return { module: `/assets/${source.split('/').at(-1)}.js`, hash: 'hash' } as T;
      },
      async readText(): Promise<string> { throw new Error('Not used'); },
    };
    const slots = await new FeatureDiscovery(host).discover(layoutFeature, [{
      owner: rootPluginId(),
      packageRoot: '/app',
    }]);
    expect(slots.map((slot) => slot.localName)).toEqual(['footer', 'nav']);
  });

  it('returns nearest-ancestor and ordered fallback layouts', () => {
    const root = rootPluginId();
    const a = `${root}/a` as PluginId;
    const b = `${a}/b` as PluginId;
    const snapshot = tree(root, a, b);
    const index = new LayoutIndex([
      layoutSlot(root, 'nav', 'root-nav'),
      layoutSlot(a, 'nav', 'a-nav'),
      layoutSlot(root, 'footer', 'root-footer'),
    ], { generation: 1, ...snapshot });

    expect(index.resolve(b, 'nav')?.module).toBe('a-nav');
    expect(index.chain(b, 'nav').map((layout) => layout.module)).toEqual(['a-nav', 'root-nav']);
    expect(index.chain(b, 'footer').map((layout) => layout.module)).toEqual(['root-footer']);
  });
});

function tree(root: PluginId, a: PluginId, b: PluginId): SnapshotState {
  return {
    root,
    tree: new Map([
      [root, node(root, 'root', undefined, [a])],
      [a, node(a, 'a', root, [b])],
      [b, node(b, 'b', a, [])],
    ]),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
}

function node(id: PluginId, key: string, parent: PluginId | undefined, children: readonly PluginId[]) {
  return Object.freeze<PluginNodeSnapshot>({
    id,
    instanceKey: key,
    packageName: key,
    packageRoot: `/app/${key}`,
    parent,
    children: Object.freeze([...children]),
  });
}

function layoutSlot(owner: PluginId, slot: 'nav' | 'footer', module: string) {
  return {
    id: `${owner}:zhin.layout:${slot}` as never,
    owner,
    feature: layoutFeature.id,
    localName: slot,
    source: `${module}.tsx`,
    definition: { slot, module, hash: `hash-${module}` },
  };
}
