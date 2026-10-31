import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginSchemaCatalog } from '../../../src/plugin-runtime/console/plugin-schema-catalog.js';
import { Schema } from '../../../../../basic/schema/src/index.js';
import { definePlugin, createPluginEventChannel } from '@zhin.js/plugin-runtime';
import { RootRuntime } from '@zhin.js/runtime';
import { calendarConfig } from '../../../../../plugins/utils/calendar/src/config.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writePackage(
  root: string,
  name: string,
  plugins: readonly { package: string; instanceKey: string; optional?: boolean }[] = [],
  dependencies: Readonly<Record<string, string>> = {},
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name, dependencies,
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [] },
  }));
  if ((await Promise.all(roots.map(directory => realpath(directory)))).includes(await realpath(root))) {
    const entries = plugins.map(item => `${JSON.stringify(item.instanceKey)}:${JSON.stringify(item.package)}`).join(',');
    await writeFile(join(root, 'zhin.config.json'), `{"configVersion":2,"plugins":{${entries}}}`);
  }
}

async function writeSchema(root: string, field: string): Promise<void> {
  await writeFile(join(root, 'schema.json'), JSON.stringify({
    type: 'object', properties: { [field]: { type: 'string' } }, required: [field],
  }));
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-schema-catalog-'));
  roots.push(root);
  await writePackage(root, 'schema-project', [
    { package: '@zhin.js/adapter-icqq', instanceKey: 'qq-main' },
    { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
  ], { '@zhin.js/adapter-icqq': '*', '@zhin.js/adapter-sandbox': '*' });
  const qq = join(root, 'node_modules', '@zhin.js', 'adapter-icqq');
  await writePackage(qq, '@zhin.js/adapter-icqq');
  await writeSchema(qq, 'account');
  return root;
}

function expectField(field: string): unknown {
  return { type: 'object', additional: { type: 'any' }, object: { [field]: { type: 'string', key: field, required: true } } };
}

describe('PluginSchemaCatalog', () => {
  it('reads actual calendar choices for exact aliases while retaining the raw validation schema', async () => {
    const root = await createProject();
    await writePackage(root, 'calendar-schema-project', [
      { package: './plugins/calendar', instanceKey: 'calendar-alpha' },
      { package: './plugins/calendar', instanceKey: 'calendar-beta' },
    ]);
    const child = join(root, 'plugins/calendar');
    await writePackage(child, '@zhin.js/plugin-calendar');
    const schema = calendarConfig.toJsonSchema();
    await writeFile(join(child, 'schema.json'), JSON.stringify(schema));
    const catalog = new PluginSchemaCatalog(root);
    const forms = await catalog.readAll(['calendar-alpha', 'calendar-beta']);
    expect(forms['calendar-alpha']).toEqual(forms['calendar-beta']);
    expect(forms['calendar-alpha']).toMatchObject({ object: { provider: {
      type: 'string', default: 'none', options: [
        { label: 'none', value: 'none' }, { label: 'caldav', value: 'caldav' },
        { label: 'google', value: 'google' }, { label: 'microsoft', value: 'microsoft' },
      ],
    } } });
    await expect(catalog.readJson('calendar-alpha')).resolves.toEqual(schema);
  });
  it('waits for declaration metadata without treating early startup as an absent inline schema', async () => {
    const root = await realpath(await createProject());
    let initialize!: () => void;
    const ready = new Promise<void>(resolve => { initialize = resolve; });
    const catalog = new PluginSchemaCatalog(root, async () => {
      await ready;
      return new Map([[root, Schema.object({ count: Schema.number().default(1) }).toJsonSchema()]]);
    });
    let completed = false;
    const reading = catalog.read('plugin').then(value => { completed = true; return value; });
    await Promise.resolve();
    expect(completed).toBe(false);
    initialize();
    await expect(reading).resolves.toMatchObject({ object: { count: { default: 1 } } });
  });

  it('keeps isolated Plugin forms on the committed Runtime schema after a failed reload', async () => {
    const root = await realpath(await createProject());
    await writePackage(root, 'isolated-schema-project', [{ package: './plugins/child', instanceKey: 'child' }]);
    const child = join(root, 'plugins/child');
    await mkdir(child, { recursive: true });
    await writeFile(join(root, 'plugin.ts'), '');
    await writeFile(join(child, 'plugin.ts'), 'throw new Error("must never execute in Host");');
    await writeFile(join(child, 'package.json'), JSON.stringify({
      name: 'isolated-schema-child',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', runtime: 'isolated' },
    }));
    const schemaFile = join(child, 'schema.json');
    await writeFile(schemaFile, JSON.stringify({ type: 'object', properties: { count: { type: 'number', default: 1 } } }));
    const loaded: string[] = [];
    let rejectCandidate = false;
    const runtime = new RootRuntime({
      projectRoot: root,
      config: {configVersion: 2, plugins: {child: './plugins/child'}},
      environment: { name: 'test', mode: 'test', platform: 'node' },
      modules: {
        async load<T>(source: string): Promise<T> {
          loaded.push(source);
          if (source !== join(root, 'plugin.ts')) throw new Error('Isolated code loaded in Host');
          return { default: definePlugin({ name: 'isolated-schema-project' }) } as T;
        },
        async close() {},
      },
      isolation: {
        async prepare() {
          if (rejectCandidate) throw new Error('isolated candidate failed');
          // This metadata-only isolate has no business lifecycle handlers. Deliver through the
          // real instance-owned channel while keeping its source unevaluated in the Host.
          const channel = createPluginEventChannel();
          return { descriptor: { name: 'isolated-schema-child' }, controlEvent: channel.dispatch, dispose: () => channel.dispose() };
        },
      },
    });
    const catalog = new PluginSchemaCatalog(root, () => runtime.configurationSchemas);
    try {
      const committed = await runtime.start();
      expect(runtime.configurationSchemas.get(child)?.properties).toMatchObject({ count: { default: 1 } });
      await expect(catalog.read('child')).resolves.toMatchObject({ object: { count: { default: 1 } } });
      await writeFile(schemaFile, JSON.stringify({
        type: 'object', properties: { count: { type: 'number', default: 2 }, candidate: { type: 'string' } },
      }));
      rejectCandidate = true;
      await expect(runtime.reload()).rejects.toThrow('isolated candidate failed');
      expect(runtime.snapshot).toBe(committed);
      const form = await catalog.read('child');
      expect(form).toMatchObject({ object: { count: { default: 1 } } });
      expect(form).not.toHaveProperty('object.candidate');
      rejectCandidate = false;
      await runtime.reload();
      await expect(catalog.read('child')).resolves.toMatchObject({ object: { count: { default: 2 }, candidate: { type: 'string' } } });
      expect(loaded.every(source => source === join(root, 'plugin.ts'))).toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  it('uses committed declarations for an entire read and refreshes on the next read', async () => {
    const root = await realpath(await createProject());
    const qq = join(root, 'node_modules', '@zhin.js', 'adapter-icqq');
    const schema = Schema.object({ apiKey: Schema.string().secret().required(),
      count: Schema.number().default(2).min(1).effect('reload') }).toJsonSchema();
    let reads = 0;
    let declarations = new Map([[root, schema], [qq, schema]]);
    const catalog = new PluginSchemaCatalog(root, () => { reads++; return declarations; });
    const result = await catalog.readAll(['plugin', 'qq-main']);
    expect(reads).toBe(1);
    expect(result.plugin).toEqual(result['qq-main']);
    expect(result.plugin).toMatchObject({ object: {
      apiKey: { type: 'string', secret: true, component: 'password', required: true },
      count: { type: 'number', default: 2, min: 1, effect: 'reload' },
    } });
    declarations = new Map([[root, Schema.object({ enabled: Schema.boolean().default(true) }).toJsonSchema()]]);
    await expect(catalog.read('plugin')).resolves.toMatchObject({ object: { enabled: { default: true } } });
    expect(reads).toBe(2);
  });

  it('projects committed union declarations without rejecting the entire form', async () => {
    const root = await realpath(await createProject());
    const catalog = new PluginSchemaCatalog(root, () => new Map([[root, {
      type: 'object', properties: { value: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    }]]));
    await expect(catalog.read('plugin')).resolves.toMatchObject({ object: { value: { type: 'union', list: [{ type: 'string' }, { type: 'number' }] } } });
  });

  it('does not let the root alias shadow a declared root child instance', async () => {
    const root = await createProject();
    await writePackage(root, 'schema-project', [{ package: './plugins/child', instanceKey: 'root' }]);
    await writeSchema(root, 'own');
    const child = join(root, 'plugins/child');
    await writePackage(child, 'root-child');
    await writeSchema(child, 'child');
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.readAll(['root', 'plugin'])).resolves.toEqual({
      root: expectField('child'), plugin: expectField('own'),
    });
    await expect(catalog.read('root/root')).resolves.toEqual(expectField('child'));
  });

  it('resolves the declared package, ignoring an unrelated package named after the instance', async () => {
    const root = await createProject();
    const shadow = join(root, 'node_modules', 'qq-main');
    await writePackage(shadow, 'qq-main');
    await writeSchema(shadow, 'wrong');
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('qq-main')).resolves.toEqual(expectField('account'));
    await expect(catalog.read('@zhin.js/adapter-icqq')).resolves.toEqual(expectField('account'));
    await expect(catalog.read('root/qq-main')).resolves.toEqual(expectField('account'));
  });

  it('reads a batch and omits unresolved plugins without requiring an unrelated package to resolve', async () => {
    const catalog = new PluginSchemaCatalog(await createProject());
    await expect(catalog.readAll(['qq-main', 'sandbox', 'unknown'])).resolves.toEqual({
      'qq-main': expectField('account'),
    });
  });

  it('resolves repeated direct local mounts but never implicitly scans nested plugin declarations', async () => {
    const root = await createProject();
    await writePackage(root, 'schema-project', [{package: './plugins/local', instanceKey: 'first'}, {package: './plugins/local', instanceKey: 'second'}]);
    const parent = join(root, 'plugins/local');
    await writePackage(parent, 'local-parent', [{package: './leaf', instanceKey: 'leaf'}]);
    await writeSchema(parent, 'parent');
    await writePackage(join(parent, 'leaf'), 'local-leaf');
    await writeSchema(join(parent, 'leaf'), 'leaf');
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.readAll(['first', 'second'])).resolves.toEqual({first: expectField('parent'), second: expectField('parent')});
    await expect(catalog.read('root/first/leaf')).resolves.toBeNull();
    await expect(catalog.read('first/leaf')).resolves.toBeNull();
  });

  it('requires exact instance aliases when multiple aliases use one package', async () => {
    const root = await createProject();
    await writePackage(root, 'schema-project', [{package: '@zhin.js/adapter-icqq', instanceKey: 'first'}, {package: '@zhin.js/adapter-icqq', instanceKey: 'second'}], {'@zhin.js/adapter-icqq': '*'});
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('@zhin.js/adapter-icqq')).rejects.toThrow(/多个插件实例/);
    await expect(catalog.read('root/second')).resolves.toEqual(expectField('account'));
  });

  it('does not inject a facade instance that is absent from the application map', async () => {
    const root = await createProject();
    const facade = join(root, 'node_modules/zhin.js');
    await writePackage(facade, 'zhin.js', [{package: './child', instanceKey: 'inherited'}]);
    await writePackage(join(facade, 'child'), 'inherited-child');
    await writeSchema(join(facade, 'child'), 'inherited');
    await expect(new PluginSchemaCatalog(root).read('inherited')).resolves.toBeNull();
  });

  it('rejects duplicate application aliases before selecting a schema', async () => {
    const root = await createProject();
    await writeFile(join(root, 'zhin.config.json'), '{"configVersion":2,"plugins":{"duplicate":"a","duplicate":"b"}}');
    await expect(new PluginSchemaCatalog(root).read('duplicate')).rejects.toThrow(/invalid or unavailable Plugin manifest/);
  });

  it('projects Host fields without needing a valid Plugin manifest', async () => {
    const root = await createProject();
    await writeFile(join(root, 'package.json'), 'invalid');
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('http')).resolves.toMatchObject({
      type: 'object',
      object: { readiness: { type: 'object', object: {
        database: { type: 'boolean', default: true, description: '要求 Database Host 已初始化（不执行实时数据库查询）。' },
        endpoints: { type: 'list', inner: { type: 'object', object: {
          owner: { type: 'string', required: true }, name: { type: 'string', required: true },
        } } },
      } } },
    });
  });

  it('keeps the known Host projection available in batches containing other Host and Plugin forms', async () => {
    const catalog = new PluginSchemaCatalog(await createProject());
    const keys = ['http', 'database', 'ai', 'mcp', 'a2a', 'speech', 'htmlRenderer', 'assistant', 'log_level'];
    await expect(catalog.readAll([...keys, 'qq-main'])).resolves.toMatchObject({
      ...Object.fromEntries(keys.map((key) => [key, { type: key === 'log_level' ? 'union' : 'object' }])),
      'qq-main': expectField('account'),
      ai: { object: { agent: { object: { execApprovalMode: { type: 'string', options: [
        { label: 'ask', value: 'ask' }, { label: 'bypass', value: 'bypass' }, { label: 'auto', value: 'auto' },
      ] } } } } },
    });
    await expect(catalog.read('log_level')).resolves.toMatchObject({
      type: 'union', list: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('uses the root own schema for plugin and root, and reloads changes across reads', async () => {
    const root = await createProject();
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('plugin')).resolves.toBeNull();
    await writeFile(join(root, 'schema.json'), JSON.stringify({
      type: 'object', properties: { threshold: { type: 'integer', minimum: 1 } },
    }));
    for (const name of ['plugin', 'root']) {
      await expect(catalog.read(name)).resolves.toMatchObject({
        object: { threshold: { type: 'number', min: 1 } },
      });
    }
    await writeSchema(root, 'changed');
    await expect(catalog.read('plugin')).resolves.toEqual(expectField('changed'));
  });

  it('rejects undeclared and escaping paths rather than reading arbitrary directories', async () => {
    const root = await createProject();
    const catalog = new PluginSchemaCatalog(root);
    for (const name of ['../outside', 'root/qq-main/../../outside', 'root//qq-main', './plugins/undeclared']) {
      await expect(catalog.read(name)).resolves.toBeNull();
    }
    await writePackage(root, 'schema-project', [
      { package: './../outside', instanceKey: 'outside' },
    ]);
    await expect(catalog.read('outside')).rejects.toThrow('invalid or unavailable Plugin manifest');
  });

  it('preserves native Schema required flags, lists and unions', async () => {
    const root = await createProject();
    const schema = {
      type: 'object', required: true,
      object: {
        token: { type: 'string', required: true },
        optional: { type: 'string', required: false },
        targets: { type: 'list', required: true, inner: { type: 'string', required: true } },
        mode: { type: 'union', list: [{ type: 'string' }, { type: 'number' }] },
        pair: { type: 'tuple', list: [{ type: 'string' }, { type: 'number' }] },
      },
    };
    await writeFile(join(root, 'schema.json'), JSON.stringify(schema));
    await expect(new PluginSchemaCatalog(root).read('plugin')).resolves.toEqual(schema);
  });

  it('keeps cyclic and external references local to the affected field', async () => {
    const root = await createProject();
    await writeFile(join(root, 'schema.json'), JSON.stringify({ type: 'object', properties: {
      okay: { type: 'string' }, external: { $ref: 'https://example.invalid/schema' }, recursive: { $ref: '#/$defs/loop' },
    }, $defs: { loop: { $ref: '#/$defs/loop' } } }));
    await expect(new PluginSchemaCatalog(root).read('plugin')).resolves.toMatchObject({ object: {
      okay: { type: 'string' }, external: { type: 'any', reason: 'external-reference' }, recursive: { type: 'any', reason: 'cyclic-reference' },
    } });
  });

  it.each([false, true])('supports JSON Schema tuple forms, legacy=%j', async legacy => {
    const root = await createProject(), list = [{ type: 'string' }, { type: 'number' }];
    await writeFile(join(root, 'schema.json'), JSON.stringify({ type: 'object', properties: {
      pair: { type: 'array', ...(legacy ? { items: list, additionalItems: false } : { prefixItems: list, items: false }) },
    } }));
    await expect(new PluginSchemaCatalog(root).read('plugin')).resolves.toMatchObject({ object: {
      pair: { type: 'tuple', list, inner: false },
    } });
  });

  it.each([false, true])('keeps unsupported dynamic-key semantics at their own field, nested=%j', async nested => {
    const root = await createProject();
    const constrained = { type: 'object', properties: { token: { type: 'string' } }, patternProperties: { '^extra_': { type: 'string' } } };
    await writeFile(join(root, 'schema.json'), JSON.stringify(nested ? { type: 'object', properties: { config: constrained, okay: { type: 'number' } } } : constrained));
    await expect(new PluginSchemaCatalog(root).read('plugin')).resolves.toMatchObject(nested ? { object: {
      config: { type: 'any', reason: 'unsupported-construct' }, okay: { type: 'number' },
    } } : { type: 'any', reason: 'unsupported-construct' });
  });

  it.each([true, false])('rejects JSON Schema required boolean %j while native flags remain supported', async (required) => {
    const root = await createProject();
    const catalog = new PluginSchemaCatalog(root);
    for (const schema of [
      { type: 'object', properties: { token: { type: 'string' } }, required },
      { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required },
      { type: 'object', properties: {
        nested: { type: 'object', properties: { token: { type: 'string' } }, required },
      } },
    ]) {
      await writeFile(join(root, 'schema.json'), JSON.stringify(schema));
      await expect(catalog.read('plugin')).rejects.toThrow('.required must be a unique string array');
      await expect(catalog.readAll(['plugin'])).rejects.toThrow('.required must be a unique string array');
    }
  });

  it.each(['token', null, 42, {}, [42], ['token', 'token']])(
    'rejects malformed required metadata %j instead of making fields optional', async (required) => {
      const root = await createProject();
      const catalog = new PluginSchemaCatalog(root);
      for (const schema of [
        { type: 'object', properties: { token: { type: 'string' } }, required },
        { type: 'object', properties: {
          nested: { type: 'object', properties: { token: { type: 'string' } }, required },
        } },
        { type: 'object', object: { token: { type: 'string', required } } },
      ]) {
        await writeFile(join(root, 'schema.json'), JSON.stringify(schema));
        await expect(catalog.read('plugin')).rejects.toThrow('.required must be a unique string array');
        await expect(catalog.readAll(['plugin'])).rejects.toThrow('.required must be a unique string array');
      }
    },
  );

  it.each([
    '{', 'null', '[]', 'true', '{"type":"string"}', '{"properties":[]}', '{"$ref":42}',
    '{"properties":{"requiredField":42},"required":["requiredField"]}',
    '{"properties":{"secret":[]}}',
    '{"properties":{"nested":{"type":"object","properties":{"secret":42}}}}',
    '{"properties":{"list":{"type":"array","items":42}}}',
    '{"additionalProperties":42}',
    '{"$defs":{"invalid":[]}}',
  ])(
    'reports malformed schema %s without exposing the absolute project path', async (schema) => {
      const root = await createProject();
      const file = join(root, 'node_modules', '@zhin.js', 'adapter-icqq', 'schema.json');
      await writeFile(file, schema);
      const catalog = new PluginSchemaCatalog(root);
      await expect(catalog.read('qq-main')).rejects.toThrow(/schema.json for qq-main/u);
      await expect(catalog.read('qq-main')).rejects.not.toThrow(root);
      await expect(catalog.readAll(['qq-main'])).rejects.toThrow(/schema.json for qq-main/u);
      await writeFile(join(root, 'schema.json'), schema);
      await expect(catalog.read('plugin')).rejects.toThrow(/schema.json for plugin/u);
    },
  );
});
