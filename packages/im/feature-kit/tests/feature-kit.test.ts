import { describe, expect, it } from 'vitest';
import {
  capabilityId,
  childPluginId,
  createCapabilitySlot,
  createSnapshotView,
  createToken,
  featureId,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  createConstructionContext,
  createCapabilityContext,
  FeatureCatalog,
  FeatureConflictError,
  FeatureDiscovery,
  OwnerCapabilityIndex,
  defineFeatureProvider,
  operationInputSignal,
  readOperationInputSignal,
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
  it('reads operation lifetime only from the neutral input hook', () => {
    const lifetime = new AbortController();
    const untrusted = new AbortController();
    untrusted.abort();
    const input = { signal: untrusted.signal, metadata: { retirementSignal: untrusted.signal },
      [operationInputSignal]() { return lifetime.signal; } };
    expect(readOperationInputSignal(input)).toBe(lifetime.signal);
    expect(readOperationInputSignal({ signal: untrusted.signal })).toBeUndefined();
    expect(readOperationInputSignal({ metadata: { retirementSignal: untrusted.signal } })).toBeUndefined();
    expect(readOperationInputSignal(undefined)).toBeUndefined();
    expect(readOperationInputSignal('text input')).toBeUndefined();
    lifetime.abort();
    expect(readOperationInputSignal(input)?.aborted).toBe(true);
  });
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

  it('validates setup shortcut names', () => {
    expect(() => defineFeatureProvider({
      ...provider,
      id: featureId('test.invalid-shortcut'),
      authoring: {
        ...provider.authoring,
        setupMethod: 'command',
      },
    })).toThrow('Invalid Feature setup method: command');
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

it('retention is explicit and rejects unknown policies instead of silently treating them as reusable', () => {
  expect(provider.runtime.retain).toBeUndefined();
  const retained = defineFeatureProvider({ ...provider, runtime: { ...provider.runtime, retain: 'when-owner-unchanged' } });
  expect(retained.runtime.retain).toBe('when-owner-unchanged');
  expect(Object.isFrozen(retained.runtime)).toBe(true);
  expect(() => defineFeatureProvider({ ...provider, runtime: { ...provider.runtime, retain: 'always' } } as never)).toThrow('retention policy');
});


it('construction context contains only owner-lifetime resources while operations retain project', () => {
  const owner = rootPluginId();
  const token = createToken<string>('fixture.transport');
  const feature = featureId('fixture.operation');
  const snapshot = createSnapshotView(1, { root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'test', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[owner, { account: 'test' }]]),
    resources: new Map([[owner, new Map([[token.id, 'transport']])]]),
    capabilities: new Map(), projections: new Map([[feature, 'operation']]),
  });
  const context = createConstructionContext<{ account: string }>(snapshot, owner);
  expect(Object.keys(context).sort()).toEqual(['config', 'generation', 'owner', 'signal', 'use']);
  expect(Object.isFrozen(context)).toBe(true);
  expect(context.config.account).toBe('test');
  expect(context.use(token)).toBe('transport');
  expect(Reflect.has(context, 'project')).toBe(false);
  const invalid = context as unknown as { project(feature: unknown): unknown };
  expect(() => invalid.project(feature)).toThrow(TypeError);
  expect(() => invalid.project(feature)).toThrow(/project/);
  expect(createCapabilityContext(snapshot, owner).project(feature)).toBe('operation');
});
