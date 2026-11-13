import { describe, expect, it } from 'vitest';
import {
  childPluginId, disabledFeatureOwners, featureConfigSource, featureId, formatFeatureResolutionKey, isFeatureOwnerEnabled,
  parseFeatureResolutionKey, primaryConfigToken, readFeatureOverrides, resolveEndpointFeatureKey, resolveFeatureEnabled,
  resolveFeatureTargetKey, resolveLayeredConfig, rootPluginId,
  escapeFeatureConversationId, featureConversationEntry, featureConversationOverridesToken, featureEndpointKeyOf, featureInstancePath,
  featureKeyLevel, formatFeatureConversationKey, parseFeatureConversationKey, readFeatureConversationOverrides, readStoredFeatureOverrides,
  unescapeFeatureConversationId,
  type FeatureConversationOverride, type PluginId, type PrimaryConfig, type RuntimeSnapshot,
} from '../src/index.js';

describe('resolution keys', () => {
  it('parses and formats global, adapter and endpoint keys', () => {
    expect(parseFeatureResolutionKey('')).toEqual({});
    expect(parseFeatureResolutionKey('qq')).toEqual({ adapter: 'qq' });
    // Endpoint ids never contain `/`: a second slash starts the conversation level (ADR 0055).
    expect(() => parseFeatureResolutionKey('tg-main/news/x')).toThrow(TypeError);
    expect(parseFeatureResolutionKey('tg-main/news/group:x')).toEqual({ adapter: 'tg-main', endpointId: 'news', conversation: { kind: 'group', id: 'x' } });
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
  const snapshot = (document: Record<string, unknown>, rows?: ReadonlyMap<string, FeatureConversationOverride>): RuntimeSnapshot => ({
    generation: 1, root: rootPluginId(), config: new Map(), capabilities: new Map(),
    tree: new Map([[adapterOwner, { id: adapterOwner, instanceKey: 'qq', packageName: '@x/qq', packageRoot: '/x', children: [] } as never]]),
    resources: new Map([[rootPluginId(), new Map<string, unknown>([
      [primaryConfigToken.id, { document, expanded: document, get: () => undefined } satisfies PrimaryConfig],
      ...(rows ? [[featureConversationOverridesToken.id, { version: 1, get: (plugin: string, key: string) => rows.get(`${plugin}|${key}`) }] as const] : []),
    ])]]),
    projections: new Map([[featureId('zhin.adapter'), {
      owner: (id: string) => { if (!id.startsWith('ep:')) throw new Error('unknown'); return adapterOwner; },
      endpointEntry: (id: string) => id === 'ep:a' ? { desired: { endpointId: 'bot-a' } } : undefined,
      // Platform name, online name, alias and omitted key all select the one Endpoint (AdapterIndex.resolve).
      resolve: (adapter: string, endpointKey: string) => ['OneBot', 'qq'].includes(adapter) && ['', 'bot-a', 'Online Name', 'qq'].includes(endpointKey) ? 'ep:a' : undefined,
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

  it('resolves outbound selectors through AdapterIndex.resolve, like the send', () => {
    const value = snapshot({});
    for (const [adapter, endpointKey] of [['OneBot', ''], ['OneBot', 'Online Name'], ['qq', 'qq'], ['qq', 'bot-a']] as const) {
      expect(resolveFeatureTargetKey(value, { endpoint: { adapter, endpointKey }, conversation: { kind: 'group', id: 'a/b' } })).toBe('qq/bot-a/group:a%2Fb');
    }
    expect(resolveFeatureTargetKey(value, { endpoint: { adapter: 'OneBot', endpointKey: 'bot-a' } })).toBe('qq/bot-a');
    // Unresolvable selectors fall back to the global switch instead of throwing.
    expect(resolveFeatureTargetKey(value, { endpoint: { adapter: 'Other', endpointKey: 'x/y' } })).toBeUndefined();
    expect(resolveFeatureTargetKey(undefined, { endpoint: { adapter: 'OneBot', endpointKey: '' } })).toBeUndefined();
  });

  it('gates owners by the stored override levels, nested Plugins by their ancestors (ADR 0057 §2)', () => {
    const value = snapshot({ configVersion: 2, plugins: { rss: '@x/rss' }, rss: { child: {} } },
      new Map([['rss|qq/bot-a', { enabled: false, patch: {}, revision: 1, updatedAt: 1 }]]));
    expect(isFeatureOwnerEnabled(value, owner, 'qq/bot-a')).toBe(false);
    expect(isFeatureOwnerEnabled(value, owner, 'qq/bot-b')).toBe(true);
    expect(isFeatureOwnerEnabled(value, nested, 'qq/bot-a')).toBe(false);
    expect(isFeatureOwnerEnabled(value, owner, undefined)).toBe(true);
    expect(isFeatureOwnerEnabled(value, rootPluginId(), 'qq/bot-a')).toBe(true);
    expect([...disabledFeatureOwners(value, [owner, nested, adapterOwner] as PluginId[], 'qq/bot-a')]).toEqual([owner, nested]);
    expect(disabledFeatureOwners(value, [owner], undefined).size).toBe(0);
  });

  it('reads adapter and endpoint levels from the store and never from a legacy overrides block', () => {
    const rows = new Map<string, FeatureConversationOverride>([
      ['rss|tg', { enabled: false, patch: {}, revision: 1, updatedAt: 1 }],
      ['rss|qq', { patch: { maxItems: 3 }, revision: 2, updatedAt: 1 }],
      ['rss|qq/bot-a', { patch: { maxItems: 4 }, revision: 1, updatedAt: 1 }],
    ]);
    const reader = { get: (plugin: string, key: string) => rows.get(`${plugin}|${key}`) };
    expect(readStoredFeatureOverrides(reader, 'rss', 'qq/bot-a/group:1')).toEqual({
      adapters: { qq: { maxItems: 3 } }, endpoints: { 'qq/bot-a': { maxItems: 4 } } });
    expect(readStoredFeatureOverrides(reader, 'rss', 'tg')).toEqual({ adapters: { tg: { enabled: false } } });
    expect(readStoredFeatureOverrides(reader, 'rss', '')).toEqual({});
    expect(readStoredFeatureOverrides(undefined, 'rss', 'qq')).toEqual({});
    // A block left in the configuration file has no effect on dispatch: only the store counts.
    const legacy = snapshot({ configVersion: 2, plugins: { rss: '@x/rss' }, rss: { overrides: { adapters: { qq: { enabled: false } } } } }, new Map());
    expect(isFeatureOwnerEnabled(legacy, owner, 'qq/bot-a')).toBe(true);
    expect(isFeatureOwnerEnabled(snapshot({ configVersion: 2, plugins: { rss: '@x/rss' }, rss: {} }, rows), owner, 'tg/x')).toBe(false);
  });
});

describe('conversation level (ADR 0055)', () => {
  it('formats, escapes and parses conversation keys without slash ambiguity', () => {
    expect(escapeFeatureConversationId('a/b%c')).toBe('a%2Fb%25c');
    expect(unescapeFeatureConversationId('a%2Fb%25c')).toBe('a/b%c');
    expect(unescapeFeatureConversationId('a%2fb')).toBe('a/b');
    expect(unescapeFeatureConversationId('a%20b')).toBeUndefined();
    expect(unescapeFeatureConversationId('a/b')).toBeUndefined();
    const key = formatFeatureConversationKey('qq', 'bot-1', { kind: 'private', id: 'u/1:x' });
    expect(key).toBe('qq/bot-1/private:u%2F1:x');
    expect(parseFeatureConversationKey(key)).toEqual({ adapter: 'qq', endpointId: 'bot-1', conversation: { kind: 'private', id: 'u/1:x' } });
    expect(formatFeatureResolutionKey(key)).toBe(key);
    expect(featureKeyLevel(key)).toBe('conversation');
    expect(featureEndpointKeyOf(key)).toBe('qq/bot-1');
    for (const bad of ['qq/bot-1/room:1', 'qq/bot-1/group:', 'qq/bot-1/group', 'Q/bot/group:1', 'qq/bot-1/group:a%2', 'qq/bot-1/group:a%2fb']) {
      expect(parseFeatureConversationKey(bad)).toBeUndefined();
    }
    expect(() => formatFeatureConversationKey('qq', 'bot', { kind: 'group', id: 'x'.repeat(257) })).toThrow(TypeError);
    expect(() => formatFeatureConversationKey('qq', 'bot', { kind: 'group', id: 'a\nb' })).toThrow(TypeError);
  });

  it('locks the conversation below any disabled upper level and records conversation sources', () => {
    const overrides = { adapters: { tg: { enabled: false } }, endpoints: { 'qq/off': { enabled: false }, 'qq/a': { maxItems: 2, style: { color: 'blue' } } } };
    expect(resolveFeatureEnabled({ overrides, key: 'qq/off/group:1', conversation: { enabled: false } }))
      .toEqual({ enabled: false, disabledAt: 'endpoint', lockedBy: 'endpoint' });
    expect(resolveFeatureEnabled({ overrides, key: 'tg/a/group:1' })).toEqual({ enabled: false, disabledAt: 'adapter', lockedBy: 'adapter' });
    expect(resolveFeatureEnabled({ overrides, globalEnabled: false, key: 'qq/a/group:1' })).toMatchObject({ lockedBy: 'global' });
    expect(resolveFeatureEnabled({ overrides, key: 'qq/a/group:1', conversation: { enabled: false } })).toEqual({ enabled: false, disabledAt: 'conversation' });
    // A conversation-level `enabled: true` never re-enables.
    expect(resolveFeatureEnabled({ overrides, key: 'qq/off/group:1', conversation: { enabled: true } }).enabled).toBe(false);
    const result = resolveLayeredConfig({ global: { maxItems: 5, style: { color: 'red', size: 1 } }, overrides, key: 'qq/a/group:1',
      conversation: { maxItems: 9, style: { size: 3 } } });
    expect(result.value).toEqual({ maxItems: 9, style: { color: 'blue', size: 3 } });
    expect(result.sources).toEqual({ '/maxItems': 'conversation', '/style/color': 'endpoint', '/style/size': 'conversation' });
    // The conversation entry only applies to conversation keys.
    expect(resolveLayeredConfig({ global: { maxItems: 5 }, overrides, key: 'qq/a', conversation: { maxItems: 9 } }).value).toEqual({ maxItems: 2, style: { color: 'blue' } });
  });

  it('resolves messages with a conversation to the conversation key', () => {
    const adapterOwner = childPluginId(rootPluginId(), 'qq');
    const value = {
      tree: new Map([[adapterOwner, { instanceKey: 'qq' } as never]]),
      projections: new Map([[featureId('zhin.adapter'), { owner: () => adapterOwner, endpointEntry: () => ({ desired: { endpointId: 'bot-a' } }) }]]),
    } as unknown as RuntimeSnapshot;
    expect(resolveFeatureTargetKey(value, { conversation: { endpoint: { id: 'ep:a' }, kind: 'group', id: 'g/1' } })).toBe('qq/bot-a/group:g%2F1');
    // Unkeyable ids stay at the endpoint level.
    expect(resolveEndpointFeatureKey(value, 'ep:a', undefined, { kind: 'group', id: '' })).toBe('qq/bot-a');
    expect(resolveEndpointFeatureKey(value, 'ep:a', undefined, { kind: 'room', id: '1' })).toBe('qq/bot-a');
    expect(resolveFeatureTargetKey(undefined, { adapter: 'qq', endpointId: 'x', conversation: { kind: 'channel', id: 'c' } })).toBe('qq/x/channel:c');
  });

  it('gates owners per conversation from the Root reader and invalidates on writes', () => {
    const owner = childPluginId(rootPluginId(), 'rss');
    const nested = childPluginId(owner, 'child');
    const rows = new Map<string, FeatureConversationOverride>();
    const reader = { version: 0, get: (plugin: string, key: string) => rows.get(`${plugin}|${key}`) };
    const document = { configVersion: 2, plugins: { rss: '@x/rss' }, rss: { child: {} } };
    const value = {
      generation: 1, root: rootPluginId(), config: new Map(), capabilities: new Map(), tree: new Map(), projections: new Map(),
      resources: new Map([[rootPluginId(), new Map<string, unknown>([[primaryConfigToken.id, { document, expanded: document, get: () => undefined }],
        [featureConversationOverridesToken.id, reader]])]]),
    } as unknown as RuntimeSnapshot;
    expect(readFeatureConversationOverrides(value)).toBe(reader);
    expect(isFeatureOwnerEnabled(value, owner, 'qq/a/group:1')).toBe(true);
    rows.set('rss|qq/a/group:1', { enabled: false, patch: {}, revision: 1, updatedAt: 1 });
    // Same version: cached.
    expect(isFeatureOwnerEnabled(value, owner, 'qq/a/group:1')).toBe(true);
    reader.version = 1;
    expect(isFeatureOwnerEnabled(value, owner, 'qq/a/group:1')).toBe(false);
    expect(isFeatureOwnerEnabled(value, nested, 'qq/a/group:1')).toBe(false);
    expect(isFeatureOwnerEnabled(value, owner, 'qq/a/group:2')).toBe(true);
    expect(isFeatureOwnerEnabled(value, owner, 'qq/a')).toBe(true);
    expect(featureInstancePath(nested)).toBe('rss/child');
    expect(featureConversationEntry({ enabled: false, patch: { a: 1 }, revision: 1, updatedAt: 1 })).toEqual({ a: 1, enabled: false });
  });
});
