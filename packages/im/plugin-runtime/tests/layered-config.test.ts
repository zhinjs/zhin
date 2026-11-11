import { describe, expect, it } from 'vitest';
import {
  childPluginId, disabledFeatureOwners, featureConfigSource, featureId, formatFeatureResolutionKey, isFeatureOwnerEnabled,
  parseFeatureResolutionKey, primaryConfigToken, readFeatureOverrides, resolveEndpointFeatureKey, resolveFeatureEnabled,
  resolveFeatureTargetKey, resolveLayeredConfig, rootPluginId,
  type PluginId, type PrimaryConfig, type RuntimeSnapshot,
} from '../src/index.js';

describe('resolution keys', () => {
  it('parses and formats global, adapter and endpoint keys', () => {
    expect(parseFeatureResolutionKey('')).toEqual({});
    expect(parseFeatureResolutionKey('qq')).toEqual({ adapter: 'qq' });
    expect(parseFeatureResolutionKey('tg-main/news/x')).toEqual({ adapter: 'tg-main', endpointId: 'news/x' });
    expect(formatFeatureResolutionKey({ adapter: 'qq', endpointId: 'bot-1' })).toBe('qq/bot-1');
    expect(() => parseFeatureResolutionKey({ endpointId: 'x' })).toThrow(TypeError);
  });

  it('ignores malformed override structures', () => {
    expect(readFeatureOverrides(null)).toEqual({});
    expect(readFeatureOverrides({ adapters: { qq: 1, tg: { enabled: false } }, endpoints: [] })).toEqual({ adapters: { tg: { enabled: false } } });
  });
});

describe('resolveFeatureEnabled', () => {
  const overrides = { adapters: { qq: { enabled: false }, tg: { enabled: true } }, endpoints: { 'qq/a': { enabled: true }, 'tg/b': { enabled: false } } };
  it('is top-down: an upper disable wins and lower enabled: true never re-enables', () => {
    expect(resolveFeatureEnabled({ overrides, key: '' })).toEqual({ enabled: true });
    expect(resolveFeatureEnabled({ overrides, key: 'qq' })).toEqual({ enabled: false, disabledAt: 'adapter' });
    expect(resolveFeatureEnabled({ overrides, key: 'qq/a' })).toEqual({ enabled: false, disabledAt: 'adapter', lockedBy: 'adapter' });
    expect(resolveFeatureEnabled({ overrides, key: 'tg/b' })).toEqual({ enabled: false, disabledAt: 'endpoint' });
    expect(resolveFeatureEnabled({ overrides, key: 'tg/c' })).toEqual({ enabled: true });
    expect(resolveFeatureEnabled({ overrides, globalEnabled: false, key: 'tg' })).toEqual({ enabled: false, disabledAt: 'global', lockedBy: 'global' });
    expect(resolveFeatureEnabled({ overrides, globalEnabled: false, key: '' })).toEqual({ enabled: false, disabledAt: 'global' });
  });
});

describe('resolveLayeredConfig', () => {
  const global = { maxItems: 5, feeds: ['a', 'b'], style: { title: 'T', color: 'red', font: { size: 12 } }, note: 'n', overrides: { ignored: true } };
  const overrides = {
    adapters: { qq: { enabled: true, feeds: ['q'], style: { color: 'blue' } } },
    endpoints: { 'qq/a': { maxItems: 1, note: null, style: { font: { weight: 'bold' } } } },
  };

  it('merges bottom-up: objects deep, arrays and scalars replace, null clears', () => {
    const result = resolveLayeredConfig({ global, overrides, key: 'qq/a' });
    expect(result.value).toEqual({ maxItems: 1, feeds: ['q'], style: { title: 'T', color: 'blue', font: { size: 12, weight: 'bold' } } });
    expect(result.key).toBe('qq/a');
    expect(result.enabled).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen((result.value as { style: object }).style)).toBe(true);
    expect(global.style.color).toBe('red');
  });

  it('tracks the source of every leaf and cleared path', () => {
    const result = resolveLayeredConfig({ global, overrides, key: 'qq/a' });
    expect(result.sources).toEqual({
      '/feeds': 'adapter',
      '/maxItems': 'endpoint',
      '/note': 'endpoint',
      '/style/color': 'adapter',
      '/style/font/size': 'global',
      '/style/font/weight': 'endpoint',
      '/style/title': 'global',
    });
    expect(featureConfigSource(result, ['style', 'font', 'size'])).toBe('global');
    expect(featureConfigSource(result, ['feeds', '0'])).toBe('adapter');
    expect(featureConfigSource(result, ['missing'])).toBeUndefined();
    expect(resolveLayeredConfig({ global, overrides, key: 'qq' }).sources['/maxItems']).toBe('global');
  });

  it('replaces a scalar with an object and an object with a scalar', () => {
    const result = resolveLayeredConfig({ global: { a: 1, b: { c: 1 } }, overrides: { adapters: { x: { a: { d: null, e: 2 }, b: 'flat' } } }, key: 'x' });
    expect(result.value).toEqual({ a: { e: 2 }, b: 'flat' });
    expect(result.sources).toEqual({ '/a/d': 'adapter', '/a/e': 'adapter', '/b': 'adapter' });
  });

  it('applies only the levels the key names and never reads unrelated entries', () => {
    expect(resolveLayeredConfig({ global, overrides, key: '' }).value).not.toHaveProperty('overrides');
    expect(resolveLayeredConfig({ global, overrides, key: 'tg/a' }).value).toEqual({ maxItems: 5, feeds: ['a', 'b'], style: global.style, note: 'n' });
    const polluted = resolveLayeredConfig({ global: {}, overrides: { adapters: { x: JSON.parse('{"__proto__":{"evil":1}}') } }, key: 'x' });
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
    expect(polluted.value).toEqual({});
  });
});

describe('dispatch gate helpers', () => {
  const owner = childPluginId(rootPluginId(), 'rss');
  const nested = childPluginId(owner, 'child');
  const adapterOwner = childPluginId(rootPluginId(), 'qq');
  const snapshot = (document: Record<string, unknown>): RuntimeSnapshot => ({
    generation: 1, root: rootPluginId(), config: new Map(), capabilities: new Map(),
    tree: new Map([[adapterOwner, { id: adapterOwner, instanceKey: 'qq', packageName: '@x/qq', packageRoot: '/x', children: [] } as never]]),
    resources: new Map([[rootPluginId(), new Map([[primaryConfigToken.id, { document, expanded: document, get: () => undefined } satisfies PrimaryConfig]])]]),
    projections: new Map([[featureId('zhin.adapter'), {
      owner: (id: string) => { if (!id.startsWith('ep:')) throw new Error('unknown'); return adapterOwner; },
      endpointEntry: (id: string) => id === 'ep:a' ? { desired: { endpointId: 'bot-a' } } : undefined,
    }]]),
  });

  it('maps a message endpoint to its alias/endpointId key', () => {
    const value = snapshot({});
    expect(resolveEndpointFeatureKey(value, 'ep:a')).toBe('qq/bot-a');
    expect(resolveEndpointFeatureKey(value, 'ep:b', 'fallback')).toBe('qq/fallback');
    expect(resolveEndpointFeatureKey(value, 'ep:b')).toBe('qq');
    expect(resolveEndpointFeatureKey(value, 'other')).toBeUndefined();
    expect(resolveFeatureTargetKey(value, { conversation: { endpoint: { id: 'ep:a' } } })).toBe('qq/bot-a');
    expect(resolveFeatureTargetKey(undefined, { conversation: { endpoint: { id: 'ep:a' } } })).toBeUndefined();
    expect(resolveFeatureTargetKey(undefined, { adapter: 'qq', endpointId: 'x' })).toBe('qq/x');
    expect(() => resolveFeatureTargetKey(undefined, { adapter: '' })).toThrow(TypeError);
  });

  it('gates owners by override levels, nested Plugins by their ancestors', () => {
    const value = snapshot({ configVersion: 2, plugins: { rss: '@x/rss' },
      rss: { overrides: { endpoints: { 'qq/bot-a': { enabled: false } } }, child: {} } });
    expect(isFeatureOwnerEnabled(value, owner, 'qq/bot-a')).toBe(false);
    expect(isFeatureOwnerEnabled(value, owner, 'qq/bot-b')).toBe(true);
    expect(isFeatureOwnerEnabled(value, nested, 'qq/bot-a')).toBe(false);
    expect(isFeatureOwnerEnabled(value, owner, undefined)).toBe(true);
    expect(isFeatureOwnerEnabled(value, rootPluginId(), 'qq/bot-a')).toBe(true);
    expect([...disabledFeatureOwners(value, [owner, nested, adapterOwner] as PluginId[], 'qq/bot-a')]).toEqual([owner, nested]);
    expect(disabledFeatureOwners(value, [owner], undefined).size).toBe(0);
  });
});
