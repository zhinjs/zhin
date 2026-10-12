import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginSchemaCatalog } from '../../../src/plugin-runtime/console/plugin-schema-catalog.js';
import { Schema } from '../../../../../basic/schema/src/index.js';

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
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins },
  }));
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
  return { type: 'object', object: { [field]: { type: 'string', key: field, required: true } } };
}

describe('PluginSchemaCatalog', () => {
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

  it('rejects unsupported committed schemas before displaying a partial form', async () => {
    const root = await realpath(await createProject());
    const catalog = new PluginSchemaCatalog(root, () => new Map([[root, {
      type: 'object', properties: { value: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    }]]));
    await expect(catalog.read('plugin')).rejects.toThrow('not supported by Console forms');
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

  it('resolves multiple local mounts and nested local and npm children from their declaring package', async () => {
    const root = await createProject();
    await writePackage(root, 'schema-project', [
      { package: './plugins/local', instanceKey: 'first' },
      { package: './plugins/local', instanceKey: 'second' },
    ]);
    const parent = join(root, 'plugins', 'local');
    await writePackage(parent, 'local-parent', [
      { package: './plugins/leaf', instanceKey: 'leaf' },
      { package: '@test/remote', instanceKey: 'remote' },
    ], { '@test/remote': '*' });
    await writeSchema(parent, 'parent');
    const leaf = join(parent, 'plugins', 'leaf');
    await writePackage(leaf, 'local-leaf');
    await writeSchema(leaf, 'leaf');
    const remote = join(parent, 'node_modules', '@test', 'remote');
    await writePackage(remote, '@test/remote');
    await writeSchema(remote, 'nested');
    const rootRemote = join(root, 'node_modules', '@test', 'remote');
    await writePackage(rootRemote, '@test/remote');
    await writeSchema(rootRemote, 'wrong');
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.readAll(['first', 'second'])).resolves.toEqual({
      first: expectField('parent'), second: expectField('parent'),
    });
    await expect(catalog.read('root/first/leaf')).resolves.toEqual(expectField('leaf'));
    await expect(catalog.read('second/remote')).resolves.toEqual(expectField('nested'));
  });

  it('resolves local children declared by a mounted npm package and gives exact instance keys precedence', async () => {
    const root = await createProject();
    const parent = join(root, 'node_modules', '@zhin.js', 'adapter-icqq');
    await writePackage(parent, '@zhin.js/adapter-icqq', [
      { package: './plugins/local', instanceKey: 'child' },
    ]);
    const child = join(parent, 'plugins', 'local');
    await writePackage(child, 'nested-local');
    await writeSchema(child, 'nested-local');
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('root/qq-main/child')).resolves.toEqual(expectField('nested-local'));
    await writePackage(root, 'schema-project', [
      { package: 'collision', instanceKey: 'alias' },
      { package: './plugins/exact', instanceKey: 'collision' },
    ], { collision: '*' });
    const alias = join(root, 'node_modules', 'collision');
    await writePackage(alias, 'collision');
    await writeSchema(alias, 'alias');
    const exact = join(root, 'plugins', 'exact');
    await writePackage(exact, 'exact');
    await writeSchema(exact, 'exact');
    await expect(catalog.read('collision')).resolves.toEqual(expectField('exact'));
  });

  it('resolves inherited facade defaults from the facade, with explicit instance overrides winning', async () => {
    const root = await createProject();
    await writePackage(root, 'schema-project', [
      { package: './plugins/override', instanceKey: 'default' },
    ], { 'zhin.js': '*' });
    const override = join(root, 'plugins', 'override');
    await writePackage(override, 'override');
    await writeSchema(override, 'override');
    const facade = join(root, 'node_modules', 'zhin.js');
    await writePackage(facade, 'zhin.js', [
      { package: './plugins/default', instanceKey: 'default' },
      { package: './plugins/inherited', instanceKey: 'inherited' },
    ], { '@zhin.js/core': '*' });
    await writePackage(join(facade, 'node_modules', '@zhin.js', 'core'), '@zhin.js/core');
    for (const field of ['default', 'inherited']) {
      const child = join(facade, 'plugins', field);
      await writePackage(child, field);
      await writeSchema(child, field);
    }
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('default')).resolves.toEqual(expectField('override'));
    await expect(catalog.read('inherited')).resolves.toEqual(expectField('inherited'));
  });

  it('does not resolve disabled platform inheritance, even when its packages are malformed', async () => {
    const root = await createProject();
    const local = join(root, 'plugins', 'local');
    await writePackage(local, 'local');
    await writeSchema(local, 'local');
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'schema-project', dependencies: { 'zhin.js': '*', '@zhin.js/core': '*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', platformFeatures: false,
        plugins: [{ package: './plugins/local', instanceKey: 'local' }] },
    }));
    for (const name of ['zhin.js', '@zhin.js/core']) {
      const installed = join(root, 'node_modules', name);
      await mkdir(installed, { recursive: true });
      await writeFile(join(installed, 'package.json'), 'invalid');
    }
    await expect(new PluginSchemaCatalog(root).read('local')).resolves.toEqual(expectField('local'));
  });

  it('rejects effective inherited duplicates but permits declared overrides to shadow duplicate defaults', async () => {
    const root = await createProject();
    await writePackage(root, 'schema-project', [], { 'zhin.js': '*' });
    const facade = join(root, 'node_modules', 'zhin.js');
    await writePackage(facade, 'zhin.js', [
      { package: './plugins/first', instanceKey: 'duplicate' },
      { package: './plugins/second', instanceKey: 'duplicate' },
    ], { '@zhin.js/core': '*' });
    await writePackage(join(facade, 'node_modules', '@zhin.js', 'core'), '@zhin.js/core');
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('duplicate')).rejects.toMatchObject({
      cause: { message: 'Duplicate child instanceKey in schema-project' },
    });
    const override = { package: './plugins/override', instanceKey: 'duplicate' };
    await writePackage(root, 'schema-project', [override], { 'zhin.js': '*' });
    const child = join(root, 'plugins', 'override');
    await writePackage(child, 'override');
    await writeSchema(child, 'override');
    await expect(catalog.read('duplicate')).resolves.toEqual(expectField('override'));
    await writePackage(root, 'schema-project', [override, override], { 'zhin.js': '*' });
    await expect(catalog.read('duplicate')).rejects.toMatchObject({
      cause: { message: 'Duplicate child instanceKey in schema-project' },
    });
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

  it.each(['$ref', 'anyOf', 'oneOf', 'allOf', 'prefixItems'])(
    'rejects unsupported %s even beside supported properties and at nested locations', async (keyword) => {
      const root = await createProject();
      const catalog = new PluginSchemaCatalog(root);
      const unsupported = keyword === '$ref' ? '#/$defs/token' : [{ type: 'string' }];
      const simple = { type: 'object', properties: { token: { type: 'string' } } };
      for (const schema of [
        { ...simple, [keyword]: unsupported },
        { ...simple, properties: { token: { type: 'string', [keyword]: unsupported } } },
        { ...simple, properties: { targets: { type: 'array', items: { [keyword]: unsupported } } } },
        { type: 'object', object: { token: { type: 'string', [keyword]: unsupported } } },
      ]) {
        await writeFile(join(root, 'schema.json'), JSON.stringify(schema));
        await expect(catalog.read('plugin')).rejects.toThrow(`${keyword} is not supported by Console forms`);
        await expect(catalog.readAll(['plugin'])).rejects.toThrow(`${keyword} is not supported by Console forms`);
      }
    },
  );

  it('rejects JSON Schema tuple prefixItems instead of converting the array to an unconstrained list', async () => {
    const root = await createProject();
    await writeFile(join(root, 'schema.json'), JSON.stringify({
      type: 'object', properties: {
        pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
      },
    }));
    await expect(new PluginSchemaCatalog(root).read('plugin')).rejects.toThrow(
      'schema.json for plugin.properties.pair.prefixItems is not supported by Console forms',
    );
  });

  it('rejects legacy tuple items instead of presenting arbitrary list values as valid', async () => {
    const root = await createProject();
    await writeFile(join(root, 'schema.json'), JSON.stringify({
      type: 'object', properties: {
        pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
      },
    }));
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('plugin')).rejects.toThrow(
      'schema.json for plugin.properties.pair.items tuple schemas are not supported by Console forms',
    );
    await expect(catalog.readAll(['plugin'])).rejects.toThrow('.items tuple schemas are not supported');
  });

  it.each([false, true])('rejects patternProperties alongside ordinary fields, nested=%j', async (nested) => {
    const root = await createProject();
    const constrained = {
      type: 'object', properties: { token: { type: 'string' } },
      patternProperties: { '^extra_': { type: 'string' } },
    };
    await writeFile(join(root, 'schema.json'), JSON.stringify(nested
      ? { type: 'object', properties: { config: constrained } } : constrained));
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('plugin')).rejects.toThrow('patternProperties is not supported by Console forms');
    await expect(catalog.readAll(['plugin'])).rejects.toThrow('patternProperties is not supported by Console forms');
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
    '{', 'null', '[]', 'true', '{"type":"string"}', '{"properties":[]}', '{"$ref":"#/$defs/config"}',
    '{"properties":{"requiredField":42},"required":["requiredField"]}',
    '{"properties":{"secret":[]}}',
    '{"properties":{"secret":false}}',
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
