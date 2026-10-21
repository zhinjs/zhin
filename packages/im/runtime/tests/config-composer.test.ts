import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigPatchPathError, definePlugin } from '@zhin.js/plugin-runtime';
import { Schema } from '../../../../basic/schema/src/index.js';
import {
  ConfigComposer,
  ConfigPatchPlanner,
  ConfigValidationError,
  NodePackageResolver,
  ProjectGraphService,
  validatePluginConfigSchema,
  parsePluginConfigSchema,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('hierarchical Plugin config', () => {
  it('normalizes defaults with the same validation engine without changing caller input', () => {
    const schema = { type: 'object', properties: { retries: { type: 'integer', default: 3, minimum: 1 } }, additionalProperties: false };
    const input = {};
    expect(parsePluginConfigSchema(schema, input)).toEqual({ value: { retries: 3 }, errors: [] });
    expect(input).toEqual({});
    const invalid = { retries: 0 };
    expect(parsePluginConfigSchema(schema, invalid).errors).toEqual(validatePluginConfigSchema(schema, invalid));
    expect(invalid).toEqual({ retries: 0 });
  });

  it('uses the same absent config defaults and local references for candidate validation and composition', async () => {
    const rootSchema = { type: 'object', required: ['token'],
      $defs: { token: { type: 'string', minLength: 2 } },
      properties: { token: { $ref: '#/$defs/token' } },
    };
    const childSchema = { ...rootSchema, default: { token: 'ok' } };
    const root = await configProject({ rootSchema, childSchema });
    const graph = await new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const composer = new ConfigComposer();
    const composed = await composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, plugin: { token: 'ok' } });
    expect(composed.views.get(graph.root.children[0]!.id)).toEqual({ token: 'ok' });
    const ownRoot = composed.ownSchemas.get(graph.root.id)!;
    const ownChild = composed.ownSchemas.get(graph.root.children[0]!.id)!;
    expect(validatePluginConfigSchema(ownRoot, undefined)).toMatchObject([{ keyword: 'required', params: { missingProperty: 'token' } }]);
    await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' } })).rejects.toBeInstanceOf(ConfigValidationError);
    expect(validatePluginConfigSchema(ownChild, undefined)).toEqual([]);
    expect(validatePluginConfigSchema(ownRoot, { token: 'ok' })).toEqual([]);
    expect(validatePluginConfigSchema(ownRoot, null)).toMatchObject([{ keyword: 'type' }]);
    await writeFile(join(root, 'schema.json'), JSON.stringify({ ...rootSchema, default: { token: 'ok' } }));
    const defaulted = await composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' } });
    expect(defaulted.views.get(graph.root.id)).toEqual({ token: 'ok' });
    expect(validatePluginConfigSchema(defaulted.ownSchemas.get(graph.root.id)!, undefined)).toEqual([]);
    await writeFile(join(root, 'plugins/child/schema.json'), JSON.stringify({ ...rootSchema, default: { token: 'x' } }));
    expect(validatePluginConfigSchema({ ...ownChild, default: { token: 'x' } }, undefined)).toMatchObject([{ keyword: 'minLength' }]);
    await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' } })).rejects.toBeInstanceOf(ConfigValidationError);
    expect(childSchema.default).toEqual({ token: 'ok' });
  });

  it('uses the authoring declaration for defaults, validation and owner metadata', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    await rm(join(root, 'schema.json'));
    await rm(join(root, 'plugins/child/schema.json'));
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const rootSchema = Schema.object({ label: Schema.string().default('root') });
    const childSchema = Schema.object({ count: Schema.number().min(1).default(2), token: Schema.string().secret() });
    const modules = { async load<T>(source: string): Promise<T> {
      return { default: definePlugin({ name: 'fixture', config: source === join(graph.root.children[0]!.package.root, 'plugin.ts') ? childSchema : rootSchema }) } as T;
    } };
    const composer = new ConfigComposer([], modules);
    const composed = await composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { token: '${TOKEN}' } });
    expect(composed.views.get(graph.root.id)).toEqual({ label: 'root' });
    expect(composed.views.get(graph.root.children[0]!.id)).toEqual({ count: 2, token: '${TOKEN}' });
    expect(composed.ownSchemas.get(graph.root.children[0]!.id)!.properties).toMatchObject({ token: { writeOnly: true } });
    await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { count: 0 } })).rejects.toBeInstanceOf(ConfigValidationError);
    await writeFile(join(root, 'schema.json'), '{}');
    await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' } })).rejects.toThrow('declares both plugin config and schema.json');
    const conflict = await composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' } })
      .then(() => undefined, (reason: unknown) => reason);
    expect(conflict).toBeInstanceOf(TypeError);
    expect((conflict as Error).name).toBe('PluginConfigSourceConflictError');
    const conflictMessage = (conflict as Error).message;
    expect(conflictMessage).toContain(join(root, 'schema.json'));
    expect(conflictMessage).toContain(join(graph.root.package.root, graph.root.package.packageJson.zhin.entry));
    expect(conflictMessage).toContain('Zhin does not pick one for you');
    expect(conflictMessage).toContain('delete schema.json');
    expect(conflictMessage).toContain('remove config from definePlugin');
  });

  it('composes child schemas, applies defaults, and exposes owner-only views', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { endpoint: { type: 'string', default: 'local' } },
      },
      childSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { retries: { type: 'integer', default: 3 } },
      },
      nested: true,
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const config = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' } });

    expect(config.document).toEqual({
      plugin: { endpoint: 'local' },
      configVersion: 2, disable_plugins: [], plugins: { child: '@test/child' }, child: { retries: 3 },
    });
    expect(config.views.get(graph.root.id)).toEqual({ endpoint: 'local' });
    expect(config.views.get(graph.root.children[0]!.id)).toEqual({ retries: 3 });
    expect(graph.root.children[0]!.children).toEqual([]);
  });

  it('injects optional commandNamespace into root and child Plugin config views', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const config = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, plugin: { commandNamespace: 'root admin' }, child: { commandNamespace: 'child' } });

    expect(config.views.get(graph.root.id)).toEqual({ commandNamespace: 'root admin' });
    expect(config.views.get(graph.root.children[0]!.id)).toEqual({ commandNamespace: 'child' });
  });

  it('reserves commandNamespace for the framework config contract', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        properties: { commandNamespace: { type: 'string' } },
      },
      childSchema: {},
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });

    await expect(new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' } })).rejects.toMatchObject({
      name: 'ConfigSchemaCollisionError',
      instanceKey: 'commandNamespace',
    });
  });

  it('injects optional disabledCommands and reserves it for the framework', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const config = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { disabledCommands: ['fanyi', 'netease login'] } });
    expect(config.views.get(graph.root.children[0]!.id)).toEqual({ disabledCommands: ['fanyi', 'netease login'] });
    await expect(new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { disabledCommands: 'fanyi' } }))
      .rejects.toMatchObject({ name: 'ConfigValidationError' });

    const reserved = await configProject({ rootSchema: { type: 'object', properties: { disabledCommands: { type: 'array' } } }, childSchema: {} });
    const reservedGraph = await new ProjectGraphService(await NodePackageResolver.create(reserved)).inspect(reserved, { configVersion: 2, plugins: { child: '@test/child' } });
    await expect(new ConfigComposer().compose(reservedGraph, { configVersion: 2, plugins: { child: '@test/child' } })).rejects.toMatchObject({
      name: 'ConfigSchemaCollisionError',
      instanceKey: 'disabledCommands',
    });
  });

  it('preserves an inactive child namespace without mounting or validating its Plugin view', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {retries: {type: 'integer'}},
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' }, disable_plugins: ['child'] });
    const config = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, disable_plugins: ['child'], child: {retries: 3, secret: 'preserved while inactive'} });

    expect(graph.root.children).toEqual([]);
    expect(config.document.child).toEqual({retries: 3, secret: 'preserved while inactive'});
    expect([...config.views.keys()]).toEqual([graph.root.id]);
  });

  it('scopes local refs to each Plugin schema and accepts UI annotations', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        additionalProperties: false,
        $defs: {
          profile: {
            type: 'object',
            additionalProperties: false,
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
          },
        },
        properties: {
          profiles: {
            type: 'object',
            'x-keyPlaceholder': '<profile-name>',
            additionalProperties: { $ref: '#/$defs/profile' },
          },
        },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const composer = new ConfigComposer();

    const config = await composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { profiles: { default: { enabled: true } } } });
    expect(config.views.get(graph.root.children[0]!.id)).toEqual({
      profiles: { default: { enabled: true } },
    });

    await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { profiles: { default: { enabled: 'yes' } } } })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('does not confuse business fields with historical package-owned child declarations', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { nested: { type: 'boolean' } },
      },
      childOwnCollision: true,
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });

    const composed = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { nested: true } });
    expect(composed.views.get(graph.root.children[0]!.id)).toEqual({ nested: true });
  });

  it('projects top-level menu settings only into the root Feature view', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    const declaration = { configVersion: 2, plugins: { child: '@test/child' } };
    const graph = await new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, declaration);
    const menuStyle = { title: '我的菜单', subtitle: '按插件查看', accentColor: '#123456', backgroundImage: 'https://example.com/menu.png' };
    const composer = new ConfigComposer();
    for (const menuKeyword of ['帮助', false, '']) {
      const composed = await composer.compose(graph, { ...declaration, menuKeyword, menuStyle });
      expect(composed.document).toMatchObject({ menuKeyword, menuStyle });
      expect(composed.views.get(graph.root.id)).toEqual({ menuKeyword, menuStyle });
      expect(composed.views.get(graph.root.children[0]!.id)).toEqual({});
      expect(composed.document.plugin).toEqual({});
    }
    for (const invalid of [{ menuKeyword: true }, { menuKeyword: 1 }, { menuStyle: 'image' }, { menuStyle: { title: 1 } }]) {
      await expect(composer.compose(graph, { ...declaration, ...invalid })).rejects.toBeInstanceOf(ConfigValidationError);
    }
    const plan = await new ConfigPatchPlanner().plan(graph, { ...declaration, menuKeyword: '帮助' }, [
      { op: 'set', path: ['menuKeyword'], value: false },
    ]);
    expect(plan.roots).toEqual([graph.root.id]);
    expect(plan.views.get(graph.root.id)).toEqual({ menuKeyword: false });
  });

  it('reserves application menu fields against root business schema collisions', async () => {
    for (const key of ['menuKeyword', 'menuStyle']) {
      const root = await configProject({ rootSchema: { properties: { [key]: {} } }, childSchema: {} });
      const declaration = { configVersion: 2, plugins: { child: '@test/child' } };
      const graph = await new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, declaration);
      await expect(new ConfigComposer().compose(graph, declaration)).rejects.toMatchObject({
        name: 'ConfigSchemaCollisionError', instanceKey: key,
      });
    }
  });

  it('accepts opaque Host keys without projecting them into Plugin views', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { endpoint: { type: 'string', default: 'local' } },
      },
      childSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { retries: { type: 'integer', default: 3 } },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const config = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, http: { port: 8086, token: 'dev' }, database: { dialect: 'sqlite', filename: './data.db' }, ai: { providers: {} }, mcp: { enabled: true, path: '/mcp' }, a2a: { enabled: true }, speech: { stt: { provider: 'ollama' } }, htmlRenderer: { width: 540 }, assistant: { enabled: true }, log_level: 'debug' });

    expect(config.document.http).toEqual({ port: 8086, token: 'dev' });
    expect(config.document.database).toEqual({ dialect: 'sqlite', filename: './data.db' });
    expect(config.document.ai).toEqual({ providers: {} });
    expect(config.document.mcp).toEqual({ enabled: true, path: '/mcp' });
    expect(config.document.a2a).toEqual({ enabled: true });
    expect(config.document.speech).toEqual({ stt: { provider: 'ollama' } });
    expect(config.document.htmlRenderer).toEqual({ width: 540 });
    expect(config.document.assistant).toEqual({ enabled: true });
    expect(config.document.log_level).toBe('debug');
    expect(config.views.get(graph.root.id)).toEqual({ endpoint: 'local' });
    expect(config.views.get(graph.root.children[0]!.id)).toEqual({ retries: 3 });
  });

  it('validates structured decision policy limits through the composed Host Schema', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const composer = new ConfigComposer();
    for (const field of ['topK', 'maxCandidates', 'maxSelections']) {
      const ai = { decisions: { provider: 'root/typesafe', memory: { mode: 'active', [field]: Number.MAX_SAFE_INTEGER } } };
      await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, ai })).resolves.toMatchObject({ document: { ai } });
      await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, ai: { decisions: { provider: 'root/typesafe',
        memory: { mode: 'active', [field]: Number.MAX_SAFE_INTEGER + 1 } } } })).rejects.toBeInstanceOf(ConfigValidationError);
    }
  });

  it('keeps the canonical Host Schema immutable across compositions', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const first = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' } });
    const firstProperties = first.effectiveSchema.properties as Record<string, Record<string, unknown>>;

    expect(Object.isFrozen(firstProperties.http)).toBe(true);
    expect(() => {
      firstProperties.http!.type = 'string';
    }).toThrow(TypeError);

    await expect(new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, http: 'invalid' })).rejects.toBeInstanceOf(
      ConfigValidationError,
    );
  });

  it('validates readiness selectors and rejects misspelled or ambiguous policy fields', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const composer = new ConfigComposer();
    const valid = { endpoints: [{ owner: 'root/sandbox', name: 'sandbox~bot' }], agents: ['zhin'] };
    const config = await composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, http: { readiness: valid } });
    expect(config.document.http).toEqual({ readiness: { ...valid, database: true } });
    for (const readiness of [
      { endpoint: [] }, { database: 'yes' }, { agents: ['zhin', 'zhin'] },
      { endpoints: [{ owner: 'sandbox', name: 'bot' }] },
      { endpoints: [{ owner: 'root/sandbox' }] },
      { endpoints: [{ owner: 'root/sandbox', name: 'slot\0injection' }] },
    ]) {
      await expect(composer.compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, http: { readiness } })).rejects.toBeInstanceOf(ConfigValidationError);
    }
  });

  it('returns structured validation issues', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        properties: { port: { type: 'integer' } },
      },
      childSchema: {},
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });

    await expect(new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, plugin: { port: 'bad' } })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('rejects the removed collaboration Host configuration', async () => {
    const root = await configProject({ rootSchema: {}, childSchema: {} });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });

    await expect(new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, collaboration: { enabled: true } })).rejects.toThrow('undeclared Plugin configuration block');
  });

  it('pinpoints the offending additionalProperty key in validation issues', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { port: { type: 'integer' } },
      },
      childSchema: {},
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });

    const failure = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, plugin: { port: 8080, prto: 8081 } }).then(
      () => { throw new Error('expected ConfigValidationError'); },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConfigValidationError);
    const issues = (failure as ConfigValidationError).issues;
    expect(issues.some((issue) => issue.includes('additionalProperty: prto'))).toBe(true);
  });

  it('annotates the source config file name when provided', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        properties: { port: { type: 'integer' } },
      },
      childSchema: {},
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });

    const failure = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, plugin: { port: 'bad' } }, 'zhin.config.yml').then(
      () => { throw new Error('expected ConfigValidationError'); },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConfigValidationError);
    expect((failure as ConfigValidationError).message).toContain('zhin.config.yml');
  });

  it('injects master/trusted into adapter top-level and endpoints[].properties', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          endpoints: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
        required: ['endpoints'],
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const config = await new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: {
          master: 'u-top',
          trusted: ['t1'],
          endpoints: [{ name: 'bot-a', master: 'u-ep', trusted: ['t2'] }],
        } });
    expect(config.document).toMatchObject({
      child: {
        master: 'u-top',
        trusted: ['t1'],
        endpoints: [{ name: 'bot-a', master: 'u-ep', trusted: ['t2'] }],
      },
    });
    const adapterProps = (config.effectiveSchema.properties as Record<string, any>).child.properties;
    expect(adapterProps.master).toBeTruthy();
    expect(adapterProps.trusted).toBeTruthy();
    expect(adapterProps.endpoints.items.properties.master).toBeTruthy();
    expect(adapterProps.endpoints.items.properties.trusted).toBeTruthy();
  });

  it('plans the owner of nested business values without creating implicit child scopes', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { retries: { type: 'integer', default: 3 }, nested: { type: 'object', properties: { enabled: { type: 'boolean', default: true } } } },
      },
      nested: true,
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const child = graph.root.children[0]!;
    expect(child.children).toEqual([]);
    const planner = new ConfigPatchPlanner();

    const nestedOnly = await planner.plan(graph, { configVersion: 2, plugins: { child: '@test/child' } }, [{
      op: 'set',
      path: ['child', 'nested', 'enabled'],
      value: false,
    }]);
    expect(nestedOnly.roots).toEqual([child.id]);
    expect(nestedOnly.views.get(child.id)).toEqual({ retries: 3, nested: { enabled: false } });

    const collapsed = await planner.plan(graph, nestedOnly.document, [
      { op: 'set', path: ['child', 'retries'], value: 5 },
      { op: 'set', path: ['child', 'nested', 'enabled'], value: true },
    ]);
    expect(collapsed.roots).toEqual([child.id]);
  });

  it('does not create work when defaults make a patch semantically unchanged', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { retries: { type: 'integer', default: 3 } },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const plan = await new ConfigPatchPlanner().plan(graph, { configVersion: 2, plugins: { child: '@test/child' } }, [{
      op: 'set',
      path: ['child', 'retries'],
      value: 3,
    }]);

    expect(plan.roots).toEqual([]);

    const changed = await new ConfigPatchPlanner().plan(graph, { configVersion: 2, plugins: { child: '@test/child' }, child: { retries: 9 } }, [{
      op: 'remove',
      path: ['child', 'retries'],
    }]);
    expect(changed.roots).toEqual([graph.root.children[0]!.id]);
    expect(changed.views.get(graph.root.children[0]!.id)).toEqual({ retries: 3 });
  });

  it('rejects invalid values and unsafe traversal paths before planning', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { retries: { type: 'integer' } },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const planner = new ConfigPatchPlanner();

    await expect(planner.plan(graph, { configVersion: 2, plugins: { child: '@test/child' } }, [{
      op: 'set',
      path: ['child', 'retries'],
      value: 'bad',
    }])).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(planner.plan(graph, { configVersion: 2, plugins: { child: '@test/child' } }, [{
      op: 'set',
      path: ['plugins', '__proto__', 'polluted'],
      value: true,
    }])).rejects.toBeInstanceOf(ConfigPatchPathError);
  });

  it('rejects a compositional root schema instead of silently projecting an empty view', async () => {
    for (const rootSchema of [
      { anyOf: [{ type: 'object', properties: { endpoint: { type: 'string' } } }] },
      { oneOf: [{ type: 'object', properties: { endpoint: { type: 'string' } } }] },
      { allOf: [{ type: 'object', properties: { endpoint: { type: 'string' } } }] },
      { $ref: '#/definitions/config' },
    ]) {
      const root = await configProject({
        rootSchema,
        childSchema: { type: 'object', properties: {} },
      });
      const resolver = await NodePackageResolver.create(root);
      const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
      await expect(new ConfigComposer().compose(graph, { configVersion: 2, plugins: { child: '@test/child' }, plugin: { endpoint: 'local' } }))
        .rejects.toThrow(/root schema must declare properties/);
    }
  });

  it('addresses array elements in patch paths and rejects bad indexes', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: { type: 'object', properties: {} },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: { child: '@test/child' } });
    const planner = new ConfigPatchPlanner();
    const current = { configVersion: 2, plugins: { child: '@test/child' }, http: { endpoints: [{ url: 'a', token: 't0' }, { url: 'b' }] } };

    const updated = await planner.plan(graph, current, [{
      op: 'set',
      path: ['http', 'endpoints', '0', 'url'],
      value: 'a2',
    }]);
    expect(updated.candidate).toEqual({
      configVersion: 2, plugins: { child: '@test/child' }, http: { endpoints: [{ url: 'a2', token: 't0' }, { url: 'b' }] },
    });

    const removed = await planner.plan(graph, current, [{
      op: 'remove',
      path: ['http', 'endpoints', '1'],
    }]);
    expect(removed.candidate).toEqual({
      configVersion: 2, plugins: { child: '@test/child' }, http: { endpoints: [{ url: 'a', token: 't0' }] },
    });

    await expect(planner.plan(graph, current, [{
      op: 'set',
      path: ['http', 'endpoints', 'foo', 'url'],
      value: 'x',
    }])).rejects.toThrow(/requires an array index/);
    await expect(planner.plan(graph, current, [{
      op: 'set',
      path: ['http', 'endpoints', '5', 'url'],
      value: 'x',
    }])).rejects.toThrow(/out of bounds/);
    await expect(planner.plan(graph, current, [{
      op: 'remove',
      path: ['http', 'endpoints', '5'],
    }])).rejects.toThrow(/out of bounds/);
    // A numeric segment cannot index a plain object traversal target either.
    await expect(planner.plan(graph, current, [{
      op: 'set',
      path: ['http', 'endpoints', '0', 'url', '0'],
      value: 'x',
    }])).rejects.toBeInstanceOf(ConfigPatchPathError);
  });
});

interface ConfigProjectInput {
  rootSchema: unknown;
  childSchema: unknown;
  nested?: boolean;
  childOwnCollision?: boolean;
}

async function configProject(input: ConfigProjectInput): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-config-'));
  temporary.push(root);
  await json(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/child': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [],
    },
  });
  await json(join(root, 'schema.json'), input.rootSchema);
  await json(join(root, 'plugins/child/package.json'), {
    name: '@test/child',
    dependencies: input.childOwnCollision || input.nested
      ? { '@test/nested': 'workspace:*' }
      : {},
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: input.childOwnCollision || input.nested
        ? [{ package: '@test/nested', instanceKey: 'nested' }]
        : [],
    },
  });
  await json(join(root, 'plugins/child/schema.json'), input.childSchema);
  if (input.childOwnCollision || input.nested) {
    await json(join(root, 'plugins/nested/package.json'), {
      name: '@test/nested',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    });
    await json(join(root, 'plugins/nested/schema.json'), {
      type: 'object',
      additionalProperties: false,
      properties: { enabled: { type: 'boolean', default: true } },
    });
  }
  return root;
}

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
