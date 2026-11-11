import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  childPluginId, definePlugin, primaryConfigToken, rootPluginId,
  type PluginSetupContext, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  ConfigComposer, ConfigSchemaCollisionError, ConfigValidationError, NodePackageResolver, ProjectGraphService, RootRuntime,
  assertFeatureLevelDeclarations, collectFeatureOverrideWarnings, createLayeredConfigAccessor, createPrimaryConfig,
  featureOverrideEntrySchema, overridableFields, readFeatureLevels, readFieldLevels, validateFeatureOverrides,
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
  const primary = (overrides: unknown, extra: Record<string, unknown> = {}) => createPrimaryConfig({
    configVersion: 2, plugins: { rss: '@x/rss', qq: '@x/qq' }, ...extra,
    rss: { maxItems: 5, feeds: ['a'], overrides },
  }, env);
  const snapshot = (generation: number, config: ReturnType<typeof primary>): RuntimeSnapshot => ({
    generation, root: rootPluginId(), tree: new Map(), config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([[rootPluginId(), new Map([[primaryConfigToken.id, config]])]]),
  });

  it('reads the latest committed configuration and caches per generation and key', () => {
    let committed = snapshot(1, primary({ endpoints: { 'qq/a': { maxItems: 1 } } }));
    const accessor = createLayeredConfigAccessor({ owner, generation: 1, schema: { ...rssSchema }, candidate: primary(undefined),
      readCommitted: () => committed, expand: value => value, view: {} });
    const first = accessor.configFor<{ maxItems: number; feeds: string[] }>('qq/a');
    expect(first).toEqual({ maxItems: 1, feeds: ['a'] });
    expect(Object.isFrozen(first)).toBe(true);
    expect(accessor.configFor('qq/a')).toBe(first);
    expect(accessor.configFor({ adapter: 'qq', endpointId: 'a' })).toBe(first);
    expect(accessor.configFor('')).toEqual({ maxItems: 5, feeds: ['a'] });
    committed = snapshot(2, primary({ adapters: { qq: { enabled: false } }, endpoints: { 'qq/a': { maxItems: 3 } } }));
    expect(accessor.configFor('qq/a')).toEqual({ maxItems: 3, feeds: ['a'] });
    expect(accessor.isEnabledFor('qq/a')).toBe(false);
    expect(accessor.resolve('qq/a').lockedBy).toBe('adapter');
    expect(accessor.isEnabledFor('qq')).toBe(false);
    expect(accessor.isEnabledFor('tg/x')).toBe(true);
  });

  it('uses the candidate configuration before its generation commits and disable_plugins for the global level', () => {
    const accessor = createLayeredConfigAccessor({ owner, generation: 3, candidate: primary({ adapters: { qq: { maxItems: 9 } } }, { disable_plugins: ['rss'] }),
      readCommitted: () => snapshot(2, primary(undefined)), expand: value => value, view: {} });
    expect(accessor.configFor('qq')).toMatchObject({ maxItems: 9 });
    expect(accessor.resolve('qq')).toMatchObject({ enabled: false, disabledAt: 'global', lockedBy: 'global' });
  });

  it('hides a nested Plugin wherever an ancestor is switched off', () => {
    const nested = childPluginId(owner, 'child');
    const config = createPrimaryConfig({ configVersion: 2, plugins: { rss: '@x/rss' },
      rss: { overrides: { endpoints: { 'qq/a': { enabled: false } } }, child: { label: 'x' } } }, env);
    const accessor = createLayeredConfigAccessor({ owner: nested, generation: 1, candidate: config, expand: value => value, view: {} });
    expect(accessor.isEnabledFor('qq/a')).toBe(false);
    expect(accessor.isEnabledFor('qq/b')).toBe(true);
  });
});

describe('RootRuntime override application', () => {
  it('applies override-only edits in place: no Plugin reload, configFor sees the new value', async () => {
    const root = await project({ childSchema: rssSchema });
    const modules = new FakeModuleRuntime();
    let setups = 0;
    let context: PluginSetupContext | undefined;
    modules.set(join(root, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(root, 'plugins/child/plugin.ts'), { default: definePlugin({ name: 'child', setup(ctx) { setups += 1; context = ctx; } }) });
    const runtime = new RootRuntime({ projectRoot: root, modules,
      config: { configVersion: 2, plugins: { child: '@test/child' }, child: { style: { title: 't' } } },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    try {
      await runtime.start();
      expect(setups).toBe(1);
      expect(context!.configFor('child/a')).toMatchObject({ maxItems: 5 });
      const scope = runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'child'));
      await runtime.patchConfig([{ op: 'set', path: ['child', 'overrides'], value: { endpoints: { 'child/a': { maxItems: 2, enabled: false } } } }]);
      expect(setups).toBe(1);
      expect(runtime.snapshot.generation).toBe(2);
      expect(runtime.snapshot.config.get(childPluginId(rootPluginId(), 'child'))).toEqual({ maxItems: 5, style: { title: 't' } });
      expect(runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'child'))?.get(primaryConfigToken.id)).not.toBe(scope?.get(primaryConfigToken.id));
      expect(context!.configFor('child/a')).toMatchObject({ maxItems: 2 });
      expect(context!.isEnabledFor('child/a')).toBe(false);
      expect(context!.config.get()).not.toHaveProperty('overrides');
      expect(runtime.configurationApplication.groups).toEqual([expect.objectContaining({ id: 'plugins', effect: 'in-place', status: 'applied' })]);
      // A global field still reloads the owner.
      await runtime.patchConfig([{ op: 'set', path: ['child', 'maxItems'], value: 7 }]);
      expect(setups).toBe(2);
      expect(context!.configFor('child/a')).toMatchObject({ maxItems: 2 });
      expect(context!.configFor('child/b')).toMatchObject({ maxItems: 7 });
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
