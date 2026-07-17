import { describe, expect, it } from 'vitest';
import { childPluginId, featureId, rootPluginId } from '@zhin.js/next-kernel';
import {
  FeatureCatalog,
  FeatureConflictError,
  FeatureDiscovery,
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
});
