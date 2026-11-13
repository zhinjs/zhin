import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  childPluginId, definePlugin, featureConversationOverridesToken, primaryConfigToken, rootPluginId,
  type FeatureConversationOverride, type PluginSetupContext, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  ConfigComposer, ConfigSchemaCollisionError, ConfigValidationError, NodePackageResolver, ProjectGraphService, RootRuntime,
  assertFeatureLevelDeclarations, collectFeatureOverrideWarnings, createLayeredConfigAccessor, createPrimaryConfig,
  featureOverrideEntrySchema, overridableFields, readFeatureConversationDeclaration, readFeatureLevels, readFieldLevels,
  validateConversationOverride, validateFeatureOverrides, validateStoredFeatureOverride,
  type ModuleRuntime,
} from '../src/index.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true })));
});

const rssSchema = {
  type: 'object',
  additionalProperties: false,
  'x-zhin-config': { levels: ['global', 'adapter', 'endpoint'] },
  properties: {
    maxItems: { type: 'integer', minimum: 1, default: 5 },
    feeds: { type: 'array', items: { type: 'string' } },
    style: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' }, color: { type: 'string' } } },
    apiKey: { type: 'string', 'x-zhin-config': { levels: ['global'], secret: true } },
    region: { type: 'string', 'x-zhin-config': { levels: ['global', 'adapter'] } },
  },
} as const;

describe('x-zhin-config.levels', () => {
  it('defaults to global and validates declarations', () => {
    expect(readFeatureLevels({ type: 'object' })).toEqual(['global']);
    expect(readFeatureLevels(rssSchema)).toEqual(['global', 'adapter', 'endpoint']);
    expect(readFeatureLevels({ 'x-zhin-config': { levels: ['endpoint', 'global'] } })).toEqual(['global', 'endpoint']);
    for (const levels of [[], ['adapter'], ['global', 'global'], ['global', 'account'], 'global']) {
      expect(() => readFeatureLevels({ 'x-zhin-config': { levels } })).toThrow(TypeError);
    }
  });

  it('lets a property narrow but never widen the root levels', () => {
    expect(readFieldLevels(['global', 'adapter', 'endpoint'], 'apiKey', rssSchema.properties.apiKey)).toEqual(['global']);
    expect(readFieldLevels(['global', 'adapter'], 'maxItems', rssSchema.properties.maxItems)).toEqual(['global', 'adapter']);
    expect(() => readFieldLevels(['global'], 'region', rssSchema.properties.region)).toThrow(/cannot widen/);
    expect(() => assertFeatureLevelDeclarations({ ...rssSchema, 'x-zhin-config': { levels: ['global'] } })).toThrow(/region/);
    expect(() => assertFeatureLevelDeclarations(rssSchema)).not.toThrow();
  });

  it('lists the fields overridable at each level, never framework keys', () => {
    expect(overridableFields(rssSchema, 'adapter')).toEqual(['maxItems', 'feeds', 'style', 'region']);
    expect(overridableFields(rssSchema, 'endpoint')).toEqual(['maxItems', 'feeds', 'style']);
    expect(overridableFields({ type: 'object', properties: { a: { type: 'string' } } }, 'adapter')).toEqual([]);
    const schema = featureOverrideEntrySchema({ ...rssSchema, properties: { ...rssSchema.properties, commandNamespace: { type: 'string' }, enabled: { type: 'boolean' } } }, 'endpoint');
    expect(Object.keys(schema.properties as object)).toEqual(['enabled', 'maxItems', 'feeds', 'style']);
    expect((schema.properties as Record<string, Record<string, unknown>>).maxItems).not.toHaveProperty('default');
    expect((schema.properties as Record<string, Record<string, unknown>>).style).not.toHaveProperty('required');
  });
});

describe('validateFeatureOverrides', () => {
  it('accepts partial entries, explicit clears and the enabled switch', () => {
    expect(validateFeatureOverrides(rssSchema, { maxItems: 5, style: { title: 'x' }, overrides: {
      adapters: { qq: { enabled: false, region: 'cn' } },
      endpoints: { 'tg-main/news': { maxItems: 1, style: { color: 'red' }, feeds: null } },
    } })).toEqual([]);
  });

  it('rejects fields outside the level, wrong types, bad keys and invalid merged views', () => {
    const issues = validateFeatureOverrides(rssSchema, { style: { title: 'x' }, overrides: {
      adapters: { qq: { apiKey: 'k' }, 'Bad Alias': {} },
      endpoints: { 'qq/a': { maxItems: 0 }, 'qq/b': { region: 'cn' }, 'qq/c': { style: { title: null } }, nokey: {} },
    } });
    expect(issues.map(issue => issue.path)).toEqual([
      '/overrides/adapters/qq',
      '/overrides/adapters/Bad Alias',
      '/overrides/endpoints/qq~1a/maxItems',
      '/overrides/endpoints/qq~1b',
      '/overrides/endpoints/qq~1c/style',
      '/overrides/endpoints/nokey',
    ]);
    expect(issues[0]!.message).toContain('additionalProperty: apiKey');
    expect(issues[4]!.message).toMatch(/^effective configuration/);
  });

  it('only allows the switch for Plugins without levels or schema fields', () => {
    const plain = { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } } };
    expect(validateFeatureOverrides(plain, { overrides: { endpoints: { 'qq/a': { enabled: false } } } })).toEqual([]);
    expect(validateFeatureOverrides(plain, { overrides: { endpoints: { 'qq/a': { label: 'x' } } } })).toHaveLength(1);
    expect(validateFeatureOverrides(plain, { overrides: { extra: {} } })).toHaveLength(1);
  });
});

describe('collectFeatureOverrideWarnings', () => {
  const document = { configVersion: 2, plugins: { rss: '@x/rss', qq: '@x/qq', tg: '@x/tg' }, qq: { endpoints: [{ id: 'bot-1' }] } };
  it('warns (not errors) for unknown aliases, unknown endpoints and ineffective enabled: true', () => {
    const warnings = collectFeatureOverrideWarnings(document, 'rss', {
      adapters: { ghost: {}, qq: { enabled: false } },
      endpoints: { 'qq/bot-1': { enabled: true }, 'qq/bot-9': {}, 'tg/any': {}, 'ghost/x': {} },
    });
    expect(warnings.map(warning => [warning.code, warning.path])).toEqual([
      ['unknown-adapter', '/overrides/adapters/ghost'],
      ['enabled-under-disabled', '/overrides/endpoints/qq~1bot-1/enabled'],
      ['unknown-endpoint', '/overrides/endpoints/qq~1bot-9'],
      ['unknown-adapter', '/overrides/endpoints/ghost~1x'],
    ]);
    expect(collectFeatureOverrideWarnings(document, 'rss', { adapters: { qq: { enabled: true } } }, false))
      .toEqual([expect.objectContaining({ code: 'enabled-under-disabled' })]);
  });
});

describe('ConfigComposer overrides', () => {
  it('injects and validates overrides, strips them from ConfigViews and reports warnings', async () => {
    const root = await project({ childSchema: rssSchema });
    const graph = await inspect(root);
    const document = { configVersion: 2, plugins: { child: '@test/child' },
      child: { style: { title: 't' }, overrides: { adapters: { ghost: { enabled: false } }, endpoints: { 'child/a': { maxItems: 2 } } } } };
    const composed = await new ConfigComposer().compose(graph, document);
    const id = graph.root.children[0]!.id;
    expect(composed.views.get(id)).toEqual({ maxItems: 5, style: { title: 't' } });
    expect(composed.ownSchemas.get(id)!.properties).toHaveProperty('overrides');
    expect(composed.ownSchemas.get(graph.root.id)!.properties).not.toHaveProperty('overrides');
    expect((composed.document.child as Record<string, unknown>).overrides).toEqual(document.child.overrides);
    expect(composed.warnings).toEqual([expect.objectContaining({ code: 'unknown-adapter', plugin: 'child' })]);
    await expect(new ConfigComposer().compose(graph, { ...document, child: { overrides: { endpoints: { 'child/a': { apiKey: 'x' } } } } }))
      .rejects.toThrow(ConfigValidationError);
    await expect(new ConfigComposer().compose(graph, { ...document, child: { overrides: { adapters: { qq: { enabled: 'no' } } } } }))
      .rejects.toThrow(/enabled/);
  });

  it('gives schema-less Plugins the three-level switch and reserves the key', async () => {
    const root = await project({ childSchema: undefined });
    const graph = await inspect(root);
    const composed = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { overrides: { endpoints: { 'qq/a': { enabled: false } } } } });
    expect(composed.views.get(graph.root.children[0]!.id)).toEqual({});
    await expect(new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { overrides: { endpoints: { 'qq/a': { label: 1 } } } } }))
      .rejects.toThrow(ConfigValidationError);
    const reserved = await project({ childSchema: { type: 'object', properties: { overrides: { type: 'object' } } } });
    await expect(new ConfigComposer().compose(await inspect(reserved), { configVersion: 2, plugins: { child: '@test/child' } }))
      .rejects.toBeInstanceOf(ConfigSchemaCollisionError);
    const widening = await project({ childSchema: { ...rssSchema, 'x-zhin-config': { levels: ['global'] } } });
    await expect(new ConfigComposer().compose(await inspect(widening), { configVersion: 2, plugins: { child: '@test/child' } }))
      .rejects.toThrow(/cannot widen/);
  });
});

describe('layered config accessor', () => {
  const owner = childPluginId(rootPluginId(), 'rss');
  const env = { expandMissingAsEmpty: <T>(value: T) => value } as never;
  const primary = (extra: Record<string, unknown> = {}, block: Record<string, unknown> = {}) => createPrimaryConfig({
    configVersion: 2, plugins: { rss: '@x/rss', qq: '@x/qq' }, ...extra,
    rss: { maxItems: 5, feeds: ['a'], ...block },
  }, env);
  /** ADR 0057 §2: adapter / endpoint / conversation levels come from the instance's override store. */
  const store = (entries: Record<string, FeatureConversationOverride> = {}) => {
    const rows = new Map(Object.entries(entries));
    return { rows, reader: { version: 0, get: (plugin: string, key: string) => rows.get(`${plugin}|${key}`) } };
  };
  const row = (patch: Record<string, unknown>, enabled?: false): FeatureConversationOverride => ({ ...(enabled === false ? { enabled } : {}), patch, revision: 1, updatedAt: 1 });
  const snapshot = (generation: number, config: ReturnType<typeof primary>, reader?: ReturnType<typeof store>['reader']): RuntimeSnapshot => ({
    generation, root: rootPluginId(), tree: new Map(), config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([[rootPluginId(), new Map<string, unknown>([[primaryConfigToken.id, config], ...(reader ? [[featureConversationOverridesToken.id, reader] as const] : [])])]]) as never,
  });

  it('reads the latest committed configuration and the stored overrides, cached per store version and key', () => {
    const overrides = store({ 'rss|qq/a': row({ maxItems: 1 }) });
    let committed = snapshot(1, primary(), overrides.reader);
    const accessor = createLayeredConfigAccessor({ owner, generation: 1, schema: { ...rssSchema }, candidate: primary(),
      readCommitted: () => committed, expand: value => value, view: {} });
    const first = accessor.configFor<{ maxItems: number; feeds: string[] }>('qq/a');
    expect(first).toEqual({ maxItems: 1, feeds: ['a'] });
    expect(Object.isFrozen(first)).toBe(true);
    expect(accessor.configFor('qq/a')).toBe(first);
    expect(accessor.configFor({ adapter: 'qq', endpointId: 'a' })).toBe(first);
    expect(accessor.configFor('')).toEqual({ maxItems: 5, feeds: ['a'] });
    // A store write is visible at once (no new generation): the version invalidates the cache.
    overrides.rows.set('rss|qq', row({}, false));
    overrides.rows.set('rss|qq/a', { ...row({ maxItems: 3 }), revision: 2 });
    overrides.reader.version = 1;
    expect(accessor.configFor('qq/a')).toEqual({ maxItems: 3, feeds: ['a'] });
    expect(accessor.isEnabledFor('qq/a')).toBe(false);
    expect(accessor.resolve('qq/a').lockedBy).toBe('adapter');
    expect(accessor.resolve('qq/a').sources['/maxItems']).toBe('endpoint');
    expect(accessor.isEnabledFor('qq')).toBe(false);
    expect(accessor.isEnabledFor('tg/x')).toBe(true);
    // A newer committed global block still merges under the stored levels.
    committed = snapshot(2, primary({}, { feeds: ['b'] }), overrides.reader);
    expect(accessor.configFor('qq/a')).toEqual({ maxItems: 3, feeds: ['b'] });
  });

  it('ignores a legacy overrides block in the configuration file', () => {
    const accessor = createLayeredConfigAccessor({ owner, generation: 1, schema: { ...rssSchema },
      candidate: primary({}, { overrides: { adapters: { qq: { enabled: false, maxItems: 9 } } } }),
      readCandidate: () => snapshot(1, primary(), store().reader), expand: value => value, view: {} });
    expect(accessor.configFor('qq')).toEqual({ maxItems: 5, feeds: ['a'] });
    expect(accessor.isEnabledFor('qq')).toBe(true);
  });

  it('uses the candidate configuration before its generation commits and disable_plugins for the global level', () => {
    const accessor = createLayeredConfigAccessor({ owner, generation: 3, candidate: primary({ disable_plugins: ['rss'] }),
      readCommitted: () => snapshot(2, primary(), store({ 'rss|qq': row({ maxItems: 9 }) }).reader), expand: value => value, view: {} });
    expect(accessor.configFor('qq')).toMatchObject({ maxItems: 9 });
    expect(accessor.resolve('qq')).toMatchObject({ enabled: false, disabledAt: 'global', lockedBy: 'global' });
  });

  it('hides a nested Plugin wherever an ancestor is switched off', () => {
    const nested = childPluginId(owner, 'child');
    const config = createPrimaryConfig({ configVersion: 2, plugins: { rss: '@x/rss' }, rss: { child: { label: 'x' } } }, env);
    const accessor = createLayeredConfigAccessor({ owner: nested, generation: 1, candidate: config,
      readCandidate: () => snapshot(1, config, store({ 'rss|qq/a': row({}, false) }).reader), expand: value => value, view: {} });
    expect(accessor.isEnabledFor('qq/a')).toBe(false);
    expect(accessor.isEnabledFor('qq/a/group:1')).toBe(false);
    expect(accessor.isEnabledFor('qq/b')).toBe(true);
  });

  it('validates stored adapter / endpoint entries against their level and the effective configuration', () => {
    const block = { maxItems: 5, style: { title: 't' } };
    expect(validateStoredFeatureOverride(rssSchema, { block, level: 'adapter', key: 'qq', entry: { region: 'cn', enabled: false } })).toEqual([]);
    // region is adapter-only; apiKey global-only.
    expect(validateStoredFeatureOverride(rssSchema, { block, level: 'endpoint', key: 'qq/a', entry: { region: 'cn' } }))
      .toMatchObject([{ message: expect.stringContaining('additionalProperty: region') }]);
    expect(validateStoredFeatureOverride(rssSchema, { block, level: 'adapter', key: 'qq', entry: { apiKey: null } })).toHaveLength(1);
    expect(validateStoredFeatureOverride(rssSchema, { block, level: 'endpoint', key: 'qq/a', entry: { maxItems: 0 } })[0]!.path).toBe('/maxItems');
    // The effective view includes the stored levels above the written one.
    expect(validateStoredFeatureOverride(rssSchema, { block: { maxItems: 5 }, level: 'endpoint', key: 'qq/a', entry: { style: { color: 'x' } } }))
      .toMatchObject([{ message: expect.stringContaining('effective configuration') }]);
    expect(validateStoredFeatureOverride(rssSchema, { block: { maxItems: 5 }, level: 'endpoint', key: 'qq/a', entry: { style: { color: 'x' } },
      overrides: { adapters: { qq: { style: { title: 't' } } } } })).toEqual([]);
    // The level's own stored entry is replaced by the candidate.
    expect(validateStoredFeatureOverride(rssSchema, { block, level: 'endpoint', key: 'qq/a', entry: { maxItems: 2 },
      overrides: { endpoints: { 'qq/a': { maxItems: 0 } } } })).toEqual([]);
  });
});

const repeaterSchema = {
  type: 'object', additionalProperties: false,
  'x-zhin-config': { levels: ['global', 'adapter', 'endpoint', 'conversation'], conversationFields: ['threshold', 'style'], selfServiceFields: ['threshold'] },
  properties: {
    threshold: { type: 'integer', minimum: 2, default: 3 },
    style: { type: 'object', additionalProperties: false, properties: { color: { type: 'string' } } },
    apiKey: { type: 'string', 'x-zhin-config': { levels: ['global'] } },
  },
} as const;

describe('conversation level declarations (ADR 0055)', () => {
  it('requires endpoint with conversation and validates conversation / self-service / chat admin fields', () => {
    expect(readFeatureLevels(repeaterSchema)).toEqual(['global', 'adapter', 'endpoint', 'conversation']);
    expect(() => readFeatureLevels({ 'x-zhin-config': { levels: ['global', 'conversation'] } })).toThrow(/must include endpoint/);
    expect(readFeatureConversationDeclaration(repeaterSchema)).toEqual({ conversationFields: ['threshold', 'style'], selfServiceFields: ['threshold'], chatAdminFields: ['threshold'] });
    expect(readFeatureConversationDeclaration({ type: 'object' })).toEqual({ conversationFields: [], selfServiceFields: [], chatAdminFields: [] });
    expect(overridableFields(repeaterSchema, 'conversation')).toEqual(['threshold', 'style']);
    expect(overridableFields({ ...repeaterSchema, 'x-zhin-config': { levels: ['global', 'adapter', 'endpoint', 'conversation'] } }, 'conversation')).toEqual([]);
    const bad = (metadata: Record<string, unknown>) => () => assertFeatureLevelDeclarations({ ...repeaterSchema, 'x-zhin-config': metadata });
    expect(bad({ levels: ['global', 'endpoint'], conversationFields: ['threshold'] })).toThrow(/require levels to include conversation/);
    expect(bad({ levels: ['global', 'endpoint', 'conversation'], conversationFields: ['missing'] })).toThrow(/unknown field/);
    expect(bad({ levels: ['global', 'endpoint', 'conversation'], conversationFields: ['apiKey'] })).toThrow(/does not allow the conversation level/);
    expect(bad({ levels: ['global', 'endpoint', 'conversation'], conversationFields: ['threshold'], selfServiceFields: ['style'] })).toThrow(/must also be listed/);
    expect(bad({ levels: ['global', 'endpoint', 'conversation'], conversationFields: 'threshold' })).toThrow(/duplicate-free array/);
    expect(bad({ levels: ['global'], chatAdminFields: ['nope'] })).toThrow(/chatAdminFields names unknown field/);
    expect(readFeatureConversationDeclaration({ ...repeaterSchema, 'x-zhin-config': { ...repeaterSchema['x-zhin-config'], chatAdminFields: ['apiKey'] } }).chatAdminFields).toEqual(['apiKey']);
  });

  it('validates conversation entries against the allowed fields and the effective configuration', () => {
    const block = { threshold: 3 };
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { threshold: 5, enabled: false })).toEqual([]);
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { apiKey: 'x' })).toMatchObject([{ message: expect.stringContaining('additionalProperty: apiKey') }]);
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { threshold: 1 })[0]!.path).toBe('/threshold');
    // Self-service narrows further.
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { style: { color: 'x' } }, ['threshold'])).toHaveLength(1);
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { style: { color: 'x' } })).toEqual([]);
  });

  it('rejects explicit clears (null) of fields outside the allowed set, top-level or nested', () => {
    const block = { threshold: 3, apiKey: 'k' };
    // Global-only / non-conversation fields cannot be cleared from the conversation level.
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { apiKey: null }))
      .toMatchObject([{ message: expect.stringContaining('additionalProperty: apiKey') }]);
    // Self-service narrowing applies to clears as well.
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { style: null }, ['threshold'])).toHaveLength(1);
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { style: { nope: null } })).toMatchObject([{ path: '/style/nope' }]);
    // Allowed clears still pass.
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { style: { color: null } })).toEqual([]);
    expect(validateConversationOverride(repeaterSchema, block, 'qq/a/group:1', { style: null })).toEqual([]);
  });

  it('rejects explicit clears of global-only fields in file overrides', () => {
    const issues = validateFeatureOverrides(rssSchema, { apiKey: 'k', region: 'cn', style: { title: 'x' }, overrides: {
      adapters: { qq: { apiKey: null } },
      endpoints: { 'qq/a': { region: null }, 'qq/b': { style: { bogus: null } }, 'qq/c': { feeds: null, enabled: null } },
    } });
    expect(issues.map(issue => issue.path)).toEqual(['/overrides/adapters/qq', '/overrides/endpoints/qq~1a', '/overrides/endpoints/qq~1b/style/bogus']);
    expect(issues[0]!.message).toContain('additionalProperty: apiKey');
  });

  it('configFor / isEnabledFor read conversation overrides in place and are never env-expanded', () => {
    const owner = childPluginId(rootPluginId(), 'repeater');
    const rows = new Map<string, FeatureConversationOverride>();
    const reader = { version: 0, get: (plugin: string, key: string) => rows.get(`${plugin}|${key}`) };
    const document = { configVersion: 2, plugins: { repeater: '@x/repeater' }, repeater: { threshold: 3 } };
    const primary = createPrimaryConfig(document, { expandMissingAsEmpty: <T>(value: T) => value } as never);
    const committed: RuntimeSnapshot = {
      generation: 1, root: rootPluginId(), tree: new Map(), config: new Map(), capabilities: new Map(), projections: new Map(),
      resources: new Map([[rootPluginId(), new Map<string, unknown>([[primaryConfigToken.id, primary], [featureConversationOverridesToken.id, reader]])]]) as never,
    };
    const expand = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value).replaceAll('${SECRET}', 'leaked')) as T;
    const accessor = createLayeredConfigAccessor({ owner, generation: 1, schema: { ...repeaterSchema }, candidate: primary,
      readCommitted: () => committed, expand, view: {} });
    const key = { adapter: 'qq', endpointId: 'a', conversation: { kind: 'group' as const, id: '1' } };
    expect(accessor.configFor(key)).toEqual({ threshold: 3 });
    rows.set('repeater|qq/a/group:1', { enabled: false, patch: { threshold: 8, style: { color: '${SECRET}' } }, revision: 1, updatedAt: 1 });
    reader.version = 1;
    expect(accessor.configFor(key)).toEqual({ threshold: 8, style: { color: '${SECRET}' } });
    expect(accessor.resolve(key).sources['/threshold']).toBe('conversation');
    expect(accessor.isEnabledFor('qq/a/group:1')).toBe(false);
    expect(accessor.isEnabledFor('qq/a/group:2')).toBe(true);
    expect(accessor.isEnabledFor('qq/a')).toBe(true);
  });
});

describe('RootRuntime stored overrides (ADR 0057 §2)', () => {
  it('reads adapter / endpoint overrides from the Root override reader in place: no Plugin reload, no new generation', async () => {
    const root = await project({ childSchema: rssSchema });
    const modules = new FakeModuleRuntime();
    let setups = 0;
    let context: PluginSetupContext | undefined;
    modules.set(join(root, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(root, 'plugins/child/plugin.ts'), { default: definePlugin({ name: 'child', setup(ctx) { setups += 1; context = ctx; } }) });
    const rows = new Map<string, FeatureConversationOverride>();
    const reader = { version: 0, get: (plugin: string, key: string) => rows.get(`${plugin}|${key}`) };
    const runtime = new RootRuntime({ projectRoot: root, modules,
      config: { configVersion: 2, plugins: { child: '@test/child' }, child: { style: { title: 't' } } },
      installResources: ({ resources }) => { resources.provide(featureConversationOverridesToken, reader); },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    try {
      await runtime.start();
      expect(setups).toBe(1);
      expect(context!.configFor('child/a')).toMatchObject({ maxItems: 5 });
      const generation = runtime.snapshot.generation;
      rows.set('child|child/a', { enabled: false, patch: { maxItems: 2 }, revision: 1, updatedAt: 1 });
      reader.version += 1;
      expect(runtime.snapshot.generation).toBe(generation);
      expect(setups).toBe(1);
      expect(context!.configFor('child/a')).toMatchObject({ maxItems: 2 });
      expect(context!.isEnabledFor('child/a')).toBe(false);
      expect(context!.config.get()).not.toHaveProperty('overrides');
      // A global field still reloads the owner; the stored level keeps applying on top.
      await runtime.patchConfig([{ op: 'set', path: ['child', 'maxItems'], value: 7 }]);
      expect(setups).toBe(2);
      expect(context!.configFor('child/a')).toMatchObject({ maxItems: 2 });
      expect(context!.configFor('child/b')).toMatchObject({ maxItems: 7 });
      // The legacy block is still schema-checked while it may be waiting for its one-time import.
      await expect(runtime.patchConfig([{ op: 'set', path: ['child', 'overrides'], value: { adapters: { child: { apiKey: 'x' } } } }]))
        .rejects.toBeInstanceOf(ConfigValidationError);
    } finally { await runtime.stop(); }
  });
});

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }
  async close(): Promise<void> {}
}

async function inspect(root: string) {
  return new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
}

async function project(input: { childSchema: unknown }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-layered-config-'));
  temporary.push(root);
  await json(join(root, 'package.json'), { name: '@test/root', dependencies: { '@test/child': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [] } });
  await json(join(root, 'schema.json'), { type: 'object', properties: {} });
  await json(join(root, 'plugins/child/package.json'), { name: '@test/child', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
  if (input.childSchema !== undefined) await json(join(root, 'plugins/child/schema.json'), input.childSchema);
  for (const file of ['plugin.ts', 'plugins/child/plugin.ts']) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), '');
  }
  return realpath(root);
}

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
