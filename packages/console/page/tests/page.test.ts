import { describe, expect, it } from 'vitest';
import {
  rootPluginId,
  type PluginId,
  type PluginNodeSnapshot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { FeatureDiscovery, type DiscoveryHost } from '@zhin.js/feature-kit';
import pageFeature, {
  PageIndex,
  createAdapterConsolePage,
  createDeclarativePage,
  defineAdapterPage,
  definePage,
  definePageBlueprint,
  isPageIndex,
  pageIndexProjection,
  parsePageArtifact,
} from '../src/index.js';

describe('Page Feature', () => {
  it('re-exports definePage and supports extended PageMetadata fields', () => {
    const meta = definePage({
      title: 'Dashboard',
      group: 'ops',
      parent: 'root',
      fullWidth: true,
      section: 'ops',
      order: 15,
    });
    expect(meta).toMatchObject({
      section: 'ops',
      title: 'Dashboard',
      group: 'ops',
      parent: 'root',
      fullWidth: true,
      order: 15,
    });
    const parsed = parsePageArtifact(
      { module: '/assets/dash.js', hash: 'h1', metadata: meta },
      { owner: rootPluginId(), feature: pageFeature.id, localName: 'dashboard', source: '/app/pages/dashboard/index.tsx' },
    );
    expect(parsed).toMatchObject({
      title: 'Dashboard',
      group: 'ops',
      parent: 'root',
      fullWidth: true,
      section: 'ops',
      order: 15,
      module: '/assets/dash.js',
    });
    expect(() => parsePageArtifact(
      { module: '/assets/dash.js', hash: 'h1', metadata: { section: 'elsewhere' } },
      { owner: rootPluginId(), feature: pageFeature.id, localName: 'dashboard', source: '/app/pages/dashboard/index.tsx' },
    )).toThrow('Page section must be one of');
  });

  it('recognizes PageIndex by its projection brand rather than prototype identity', () => {
    expect(pageIndexProjection).toBe('zhin.page-index/1');
    expect(isPageIndex({ $projection: 'zhin.page-index/1' })).toBe(true);
    expect(isPageIndex({ $projection: 'zhin.other/1' })).toBe(false);
    expect(isPageIndex({})).toBe(false);
    expect(isPageIndex(null)).toBe(false);
    expect(isPageIndex(undefined)).toBe(false);
  });

  it('discovers only pages/<name>/index.tsx modules through the client adapter', async () => {
    const loaded: string[] = [];
    const host = memoryHost(
      ['home', 'service-status', 'nav', 'helper.tsx', 'Bad'],
      loaded,
    );
    const slots = await new FeatureDiscovery(host).discover(pageFeature, [{
      owner: rootPluginId(),
      packageRoot: '/app',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['home', 'service-status']);
    expect(loaded).toEqual(['/app/pages/home/index.tsx', '/app/pages/service-status/index.ts']);
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

  it('re-exports definePageBlueprint, createDeclarativePage, defineAdapterPage and createAdapterConsolePage', () => {
    expect(createDeclarativePage).toBe(definePageBlueprint);
    expect(createAdapterConsolePage).toBe(defineAdapterPage);

    const BlueprintPage = definePageBlueprint({
      title: { zh: '概览', en: 'Overview' },
      stats: [{ label: 'Total', value: 'total' }],
    });
    expect(BlueprintPage.kind).toBe('zhin.console.page-blueprint');
    expect(BlueprintPage().title).toBe('Overview');
    expect(BlueprintPage.sections).toHaveLength(1);

    const AdapterPage = defineAdapterPage('discord');
    expect(AdapterPage.kind).toBe('zhin.console.adapter-page');
    expect(AdapterPage().adapterKey).toBe('discord');
  });
});

function memoryHost(entries: readonly string[], loaded: string[]): DiscoveryHost {
  return {
    async list(directory) {
      if (directory === '/app/pages') {
        return entries.map((name) => ({
          name,
          kind: name.includes('.') ? 'file' as const : 'directory' as const,
        }));
      }
      if (directory === '/app/pages/home') return [{ name: 'index.tsx', kind: 'file' as const }];
      if (directory === '/app/pages/service-status') return [{ name: 'index.ts', kind: 'file' as const }];
      if (directory === '/app/pages/nav') return [{ name: 'index.tsx', kind: 'file' as const }];
      return [];
    },
    async loadModule<T>(): Promise<T> { throw new Error('Page source must not execute in Node'); },
    async loadClientModule<T>(source): Promise<T> {
      loaded.push(source);
      const name = source.split('/').at(-2);
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
