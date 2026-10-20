import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HOST_CONFIG_KEYS, HOST_CONFIG_SCHEMA } from '@zhin.js/runtime';
import { createConfigDocument } from '@zhin.js/config-file';
import { dispatchRuntimeConsoleRpc } from '@zhin.js/host-http';
import { jsonSchemaToConsoleSchema } from '../../../src/plugin-runtime/console/console-schema.js';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { PluginSchemaCatalog } from '../../../src/plugin-runtime/console/plugin-schema-catalog.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-schema-coverage-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'schema-coverage', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: {} }));
  return root;
}

describe('complete Console configuration projection through real authorities', () => {
  it('projects actual Host references, scalar blocks and open keys without dropping fields', () => {
    const schema = jsonSchemaToConsoleSchema(HOST_CONFIG_SCHEMA);
    expect(Object.keys(schema!.object as object)).toEqual(Object.keys(HOST_CONFIG_SCHEMA.properties));
    expect(schema).toMatchObject({ object: {
      menuKeyword: { type: 'union', mode: 'anyOf', list: [{ type: 'string' }, { type: 'const', value: false }] },
      log_level: { type: 'union', list: [{ type: 'string' }, { type: 'number' }] },
      http: { additional: { type: 'any' } },
      ai: { object: { decisions: { object: { skills: { type: 'object', object: { mode: { type: 'string' }, timeoutMs: { type: 'number', integer: true } } } } } } },
    } });
  });

  it('keeps all canonical Host keys discoverable and resolves schema:get with Host $defs', async () => {
    const root = await project();
    const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.json')) });
    const source = await store.readSource();
    expect(source.configKeys).toEqual(expect.arrayContaining([...HOST_CONFIG_KEYS]));
    for (const key of HOST_CONFIG_KEYS) expect(source.configPaths?.[key]).toEqual([key]);
    expect(source.configKeys).not.toEqual(expect.arrayContaining(['plugins', 'disable_plugins', 'configVersion']));
    const replies = await dispatchRuntimeConsoleRpc({ type: 'schema:get', requestId: 1, pluginName: 'ai' }, {
      authScope: 'full', listPages: async () => [], getSchema: name => store.readSchema(name),
    });
    expect(replies).toContainEqual(expect.objectContaining({ requestId: 1, data: expect.objectContaining({ object: expect.objectContaining({ decisions: expect.objectContaining({ object: expect.objectContaining({ skills: expect.objectContaining({ type: 'object' }) }) }) }) }) }));
    expect(await store.readSchema('log_level')).toMatchObject({ type: 'union' });
  });

  it('projects standard constructs from actual published plugin schema files through the catalog', async () => {
    const root = await project(), catalog = new PluginSchemaCatalog(root);
    const plugins = resolve(import.meta.dirname, '../../../../../plugins');
    let count = 0;
    const artifacts: Array<{ key: string; packageName: string; path: string; rawSchema: Record<string, unknown>; projectedSchema: Record<string, unknown> }> = [];
    for (const group of ['adapters', 'features', 'games', 'services', 'utils']) {
      for (const directory of await readdir(join(plugins, group), { withFileTypes: true })) {
        if (!directory.isDirectory()) continue;
        let text: string;
        try { text = await readFile(join(plugins, group, directory.name, 'schema.json'), 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        await writeFile(join(root, 'schema.json'), text);
        const raw = JSON.parse(text) as Record<string, unknown>;
        const form = await catalog.read('plugin') as Record<string, unknown>;
        expect(form, `${group}/${directory.name}`).toBeTruthy();
        if (raw.properties) {
          const fields = (value: Record<string, unknown>): string[] => value.type === 'intersect'
            ? (value.list as Record<string, unknown>[]).flatMap(fields) : Object.keys(value.object as object ?? {});
          expect(fields(form), `${group}/${directory.name}`).toEqual(expect.arrayContaining(Object.keys(raw.properties as object)));
        }
        expect(await catalog.readJson('plugin')).toEqual(raw);
        artifacts.push({ key: `schema-${count}`, packageName: directory.name, path: `plugins/${group}/${directory.name}/schema.json`, rawSchema: raw, projectedSchema: form });
        count++;
      }
    }
    expect(count).toBeGreaterThan(20);
    if (process.env.ZHIN_SCHEMA_FORM_FIXTURE) {
      const pluginMap: Record<string, string> = {};
      for (const artifact of artifacts) {
        const directory = join(root, 'fixtures', artifact.key); await mkdir(directory, { recursive: true });
        pluginMap[artifact.key] = `./fixtures/${artifact.key}`;
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `fixture-${artifact.key}`, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
        await writeFile(join(directory, 'schema.json'), JSON.stringify(artifact.rawSchema));
      }
      await rm(join(root, 'schema.json'));
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: pluginMap }));
      const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.json')), environmentForPlugin: () => ({ has: () => true }) });
      const source = await store.readSource();
      const context = { authScope: 'full' as const, listPages: async () => [], getSchema: (name?: string) => store.readSchema(name), getAllSchemas: () => store.readAllSchemas() };
      const host = [];
      for (const key of HOST_CONFIG_KEYS) {
        const replies = await dispatchRuntimeConsoleRpc({ type: 'schema:get', pluginName: key, requestId: key }, context);
        host.push({ key, rawSchema: key === 'plugin' ? await catalog.readJson(key) : { ...HOST_CONFIG_SCHEMA.properties[key as keyof typeof HOST_CONFIG_SCHEMA.properties], $defs: HOST_CONFIG_SCHEMA.$defs }, projectedSchema: replies[0]?.data });
      }
      const all = await dispatchRuntimeConsoleRpc({ type: 'schema:get-all', requestId: 'all' }, context);
      const output = `${process.env.ZHIN_SCHEMA_FORM_FIXTURE}.tmp`;
      await writeFile(output, JSON.stringify({ provenance: 'Actual repository schema artifacts + temporary ConsoleConfigurationStore + dispatchRuntimeConsoleRpc. No user config, environment file, platform or network operation.', source, host, plugins: artifacts, schemaGetAllReply: all[0] }, null, 2));
      await rename(output, process.env.ZHIN_SCHEMA_FORM_FIXTURE);
    }
  });

  it('preserves mixed objects, branches, tuples, constants, local refs and per-field fallback reasons', async () => {
    const root = await project(); await mkdir(join(root, 'node_modules'), { recursive: true });
    const schema = { type: 'object', additionalProperties: { type: 'integer' }, $defs: {
      secret: { type: 'string', writeOnly: true, minLength: 2 }, loop: { $ref: '#/$defs/loop' },
    }, properties: {
      reference: { $ref: '#/$defs/secret', title: 'Token' },
      recursive: { $ref: '#/$defs/loop' }, external: { $ref: 'https://example.invalid/config.json' },
      choice: { oneOf: [{ type: 'null' }, { type: 'string', title: 'Literal', pattern: '^a' }] },
      tuple: { type: 'array', prefixItems: [{ const: 'fixed' }, { type: 'number' }], items: false },
      intersection: { allOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object', properties: { b: { type: 'boolean' } } }] },
    } };
    await writeFile(join(root, 'schema.json'), JSON.stringify(schema));
    const catalog = new PluginSchemaCatalog(root);
    expect(await catalog.read('plugin')).toMatchObject({ type: 'object', additional: { type: 'number', integer: true }, object: {
      reference: { type: 'string', title: 'Token', secret: true, component: 'password', min: 2 },
      recursive: { type: 'any', reason: expect.any(String) }, external: { type: 'any', reason: expect.any(String) },
      choice: { type: 'union', mode: 'oneOf', list: [{ type: 'null' }, { type: 'string', title: 'Literal', pattern: '^a' }] },
      tuple: { type: 'tuple', list: [{ type: 'const', value: 'fixed' }, { type: 'number' }], inner: false },
      intersection: { type: 'intersect', list: [expect.objectContaining({ object: { a: expect.any(Object) } }), expect.objectContaining({ object: { b: expect.any(Object) } })] },
    } });
    expect(await catalog.readJson('plugin')).toEqual(schema);
  });
});
