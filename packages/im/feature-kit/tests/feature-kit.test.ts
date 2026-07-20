import { describe, expect, it } from 'vitest';
import {
  capabilityId,
  childPluginId,
  createCapabilitySlot,
  featureId,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  FeatureCatalog,
  FeatureConflictError,
  FeatureDiscovery,
  OwnerCapabilityIndex,
  defineFeatureProvider,
  type DiscoveryHost,
  type SourceConvention,
} from '../src/index.js';

const convention: SourceConvention = {
  id: 'test-files',
  async *discover({ packageRoot }) {
    yield {
      localName: 'hello',
      source: `${packageRoot}/hello.ts`,
      target: 'server',
    };
  },
  async load(source, context) {
    return context.host.loadModule(source.source);
  },
};

const provider = defineFeatureProvider({
  protocol: 1,
  id: featureId('test.command'),
  authoring: {
    conventions: [convention],
    validate(value) {
      if (typeof value !== 'function') throw new TypeError('Expected function');
      return value as () => string;
    },
  },
  runtime: {
    project(slots) {
      return { value: new Map(slots.map((slot) => [slot.localName, slot.definition])) };
    },
  },
});

const host: DiscoveryHost = {
  async list() {
    return [];
  },
  async loadModule<T>() {
    return (() => 'hello') as T;
  },
  async readText() {
    return '';
  },
};

describe('Feature provider kit', () => {
  it('discovers definitions and binds slots to their owner', async () => {
    const slots = await new FeatureDiscovery(host).discover(provider, [
      { owner: rootPluginId(), packageRoot: '/plugin' },
    ]);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.owner).toBe(rootPluginId());
    expect(slots[0]?.feature).toBe(provider.id);
    expect(slots[0]?.definition()).toBe('hello');
  });

  it('rejects different providers claiming the same FeatureId', () => {
    const catalog = new FeatureCatalog();
    catalog.add(provider);
    expect(() => catalog.add({ ...provider })).toThrow(FeatureConflictError);
  });

  it('allows one package source to contribute to multiple Plugin instances', async () => {
    const root = rootPluginId();
    const slots = await new FeatureDiscovery(host).discover(provider, [
      { owner: childPluginId(root, 'first'), packageRoot: '/shared-plugin' },
      { owner: childPluginId(root, 'second'), packageRoot: '/shared-plugin' },
    ]);

    expect(slots.map((slot) => slot.owner)).toEqual([
      'root/first',
      'root/second',
    ]);
  });

  it('enumerates all descriptors but only loads selected Capability slots', async () => {
    const root = rootPluginId();
    const first = childPluginId(root, 'first');
    const second = childPluginId(root, 'second');
    let loads = 0;
    const selectiveHost: DiscoveryHost = {
      ...host,
      async loadModule<T>() {
        loads += 1;
        return (() => 'selected') as T;
      },
    };
    const slots = await new FeatureDiscovery(selectiveHost).discover(
      provider,
      [
        { owner: first, packageRoot: '/shared-plugin' },
        { owner: second, packageRoot: '/shared-plugin' },
      ],
      { capabilities: new Set([capabilityId(second, provider.id, 'hello')]) },
    );

    expect(loads).toBe(1);
    expect(slots.map((slot) => slot.owner)).toEqual([second]);
  });

  it('resolves nearest-owner overrides and stable qualified names', () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const id = featureId('test.owner-index');
    const slot = (owner: typeof root, name: string, value: string) => createCapabilitySlot({
      owner,
      feature: id,
      localName: name,
      source: `/${owner}/${name}.ts`,
      definition: value,
    });
    const slots = [
      slot(root, 'shared', 'root'),
      slot(root, 'global', 'global'),
      slot(child, 'shared', 'child'),
    ];
    const snapshot: RuntimeSnapshot = {
      generation: 1,
      root,
      tree: new Map([
        [root, {
          id: root,
          instanceKey: 'root',
          packageName: '@test/root',
          packageRoot: '/project',
          children: [child],
        }],
        [child, {
          id: child,
          instanceKey: 'child',
          packageName: '@test/child',
          packageRoot: '/project/plugins/child',
          parent: root,
          children: [],
        }],
      ]),
      config: new Map([[root, {}], [child, {}]]),
      resources: new Map([[root, new Map()], [child, new Map()]]),
      capabilities: new Map(slots.map((entry) => [entry.id, entry])),
      projections: new Map(),
    };
    const index = new OwnerCapabilityIndex(slots, snapshot);

    expect(index.resolve(child, 'shared')?.slot.definition).toBe('child');
    expect(index.resolve(child, 'global')?.slot.definition).toBe('global');
    expect(index.visible(child).map((entry) => [entry.name, entry.slot.definition])).toEqual([
      ['global', 'global'],
      ['shared', 'child'],
    ]);
    expect(index.entries().map((entry) => entry.qualifiedName)).toEqual([
      'child__shared',
      'global',
      'shared',
    ]);
  });
});
