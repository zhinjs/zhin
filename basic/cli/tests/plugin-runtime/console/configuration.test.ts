import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { calendarConfig } from '../../../../../plugins/utils/calendar/src/config.js';
import { createConfigDocument } from '@zhin.js/config-file';
import {
  ConsoleConfigurationStore,
} from '../../../src/plugin-runtime/console/configuration.js';
import {
  configKeyPatch,
  flattenConfigDocument,
} from '../../../src/plugin-runtime/console/configuration-projection.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('application configuration projection and writes', () => {
  it('edits one actual calendar choice using the original validator and revision without removing other data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-calendar-form-')); tempRoots.push(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'calendar-form',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    const child = join(root, 'calendar');
    await mkdir(child);
    await writeFile(join(child, 'package.json'), JSON.stringify({ name: '@zhin.js/plugin-calendar',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(child, 'schema.json'), JSON.stringify(calendarConfig.toJsonSchema()));
    const before = { configVersion: 2, plugins: { alpha: './calendar', beta: './calendar' },
      alpha: { provider: 'caldav', caldav: { password: '${CALDAV_PASSWORD}' },
        google: { refresh_token: '${GOOGLE_REFRESH}' }, microsoft: { client_secret: '${MS_SECRET}' } },
      beta: { provider: 'none', 'legacy.key': { untouched: true } }, plugin: { 'literal.key': [1, 2] } };
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(before));
    const store = new ConsoleConfigurationStore({ projectRoot: root,
      document: createConfigDocument(join(root, 'zhin.config.json')),
      environmentForPlugin: () => ({ has: () => true }) });
    const source = await store.readSource();
    expect(await store.readSchema('alpha')).toMatchObject({ object: { provider: { type: 'string', options: expect.any(Array) } } });
    const next = structuredClone(before); next.alpha.provider = 'google';
    const input = structuredClone(next.alpha);
    expect(await store.validatePluginConfig('alpha', input)).toMatchObject({ schemaAvailable: true, valid: true, missingEnv: [] });
    expect(input).toEqual(next.alpha);
    expect(await store.validatePluginConfig('alpha', { ...input, 'unknown.key': true })).toMatchObject({ valid: false });
    await store.replaceSource(JSON.stringify(next), source.revision);
    expect(JSON.parse((await store.readSource()).source)).toEqual(next);
    await expect(store.replaceSource(source.source, source.revision)).rejects.toThrow('changed since it was read');
    expect(JSON.parse((await store.readSource()).source)).toEqual(next);
  });
  it('keeps declarations out of the legacy key-oriented Console business view', () => {
    const flat = flattenConfigDocument({configVersion: 2, plugins: {sandbox: '@zhin.js/adapter-sandbox'}, disable_plugins: ['sandbox'], http: {port: 8086}, sandbox: {endpoints: [{id: 'bot'}]}});
    expect(flat).toEqual({http: {port: 8086}, sandbox: {endpoints: [{id: 'bot'}]}});
  });

  it('rejects Host collisions, undeclared aliases and prototype keys without mutating the document', () => {
    const document = {configVersion: 2, plugins: {sandbox: 'sandbox'}};
    expect(configKeyPatch(document, 'sandbox', {}).path).toEqual(['sandbox']);
    expect(configKeyPatch(document, 'http', {}).path).toEqual(['http']);
    for (const key of ['new-plugin', '__proto__', 'constructor', 'prototype', 'plugins', 'disable_plugins']) {
      expect(() => configKeyPatch(document, key, {})).toThrow(/Unknown configuration key/);
    }
    expect(() => flattenConfigDocument({configVersion: 2, plugins: {ai: 'reminder'}, ai: {}})).toThrow(/reserved/);
    expect(() => flattenConfigDocument(JSON.parse('{"configVersion":2,"plugins":{"__proto__":"plugin"}}'))).toThrow(/reserved/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects old formats and package objects rather than guessing a version', () => {
    expect(() => configKeyPatch({plugins: {sandbox: {}}}, 'sandbox', {})).toThrow(/configVersion/);
    expect(() => configKeyPatch({configVersion: 2, plugins: ['sandbox']}, 'sandbox', {})).toThrow(/alias-to-package|map instance/);
    expect(() => flattenConfigDocument({configVersion: 2, plugins: {sandbox: {package: 'sandbox'}}})).toThrow(/package/);
  });

  it('serializes concurrent business updates and recovers after a rejected write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-lock-')); tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {a: a, b: b, c: c, d: d}\na: {}\n');
    const store = createStore(root, 'zhin.config.yml');
    await Promise.all([store.setKey('a', {x: 1}), store.setKey('b', {y: 2}), store.setKey('c', {z: 3})]);
    await expect(store.setKey('__proto__', {})).rejects.toThrow(/Unknown configuration key/);
    await store.setKey('d', {ok: true});
    const saved = parseYaml(await readFile(join(root, 'zhin.config.yml'), 'utf8'));
    expect(saved).toMatchObject({plugins: {a: 'a', b: 'b', c: 'c', d: 'd'}, a: {x: 1}, b: {y: 2}, c: {z: 3}, d: {ok: true}});
  });

  it('keeps numeric instance declaration source order on unrelated structured and raw writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-numeric-order-')); tempRoots.push(root);
    const file = join(root, 'zhin.config.json');
    await writeFile(file, '{"configVersion":2,"plugins":{"10":"reminder","2":"reminder"},"10":{},"2":{}}\n');
    const store = createStore(root, 'zhin.config.json');
    await store.setKey('http', {port: 9090});
    await store.setKey('10', {zone: 'UTC'});
    const source = await store.readSource();
    expect(source.source.indexOf('"10"')).toBeLessThan(source.source.indexOf('"2"'));
    expect(source.configPaths).toMatchObject({'10': ['10'], '2': ['2']});
    await store.replaceSource(source.source, source.revision);
    expect((await store.readSource()).source).toBe(source.source);
  });

  it('only requests process restart for Host changes and preserves instance declarations when clearing config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-impact-')); tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {sandbox: sandbox}\n');
    const store = createStore(root, 'zhin.config.yml');
    await expect(store.setKey('sandbox', {endpoints: []})).resolves.toEqual({restartRequired: false});
    await expect(store.setKey('http', {port: 9090})).resolves.toEqual({restartRequired: true});
    await expect(store.removeKey('sandbox')).resolves.toEqual({restartRequired: false});
    expect(parseYaml((await store.readSource()).source).plugins).toEqual({sandbox: 'sandbox'});
    await expect(store.removeKey('http')).resolves.toEqual({restartRequired: true});
  });

  it('replaces source with revision checking, rejecting obsolete formats without writing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-source-')); tempRoots.push(root);
    const file = join(root, 'zhin.config.json');
    await writeFile(file, '{"configVersion":2,"plugins":{},"http":{"port":1000}}\n');
    const store = createStore(root, 'zhin.config.json');
    const current = await store.readSource();
    await expect(store.replaceSource('{}', current.revision)).rejects.toThrow(/configVersion/);
    expect((await store.readSource()).revision).toBe(current.revision);
    await expect(store.replaceSource('{"configVersion":2,"plugins":{},"http":{"port":2000}}\n', current.revision)).resolves.toMatchObject({restartRequired: true});
    await expect(store.replaceSource(current.source, current.revision)).rejects.toThrow(/changed since it was read/);
  });

  it('loads only the selected production environment without loading a disabled inline entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-env-mode-')); tempRoots.push(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({name: 'env-fixture', zhin: {protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false}}));
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({configVersion: 2, plugins: {missing: 'missing'}, disable_plugins: ['missing']}));
    await writeFile(join(root, '.env.development'), 'ZHIN_CONSOLE_DEV_ONLY=test-value\n');
    await writeFile(join(root, '.env.production'), 'zhin_console_prod_only=test-value\n');
    const store = new ConsoleConfigurationStore({projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.json')), environmentName: 'production'});
    expect(await store.validatePluginConfig('missing', {token: '${ZHIN_CONSOLE_DEV_ONLY}', prod: '${zhin_console_prod_only}'})).toMatchObject({missingEnv: ['ZHIN_CONSOLE_DEV_ONLY']});
    await writeFile(join(root, 'schema.json'), JSON.stringify({type: 'object', properties: {token: {type: 'string', default: '${ZHIN_CONSOLE_DEV_ONLY}'}}}));
    expect(await store.validatePluginConfig('plugin', {})).toMatchObject({missingEnv: ['ZHIN_CONSOLE_DEV_ONLY']});
  });
});

describe('Console schema validation', () => {
  it('reports the exact missing required field, including nested objects and array items', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-required-paths-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\nplugin: {}\n');
    await writeFile(join(root, 'schema.json'), JSON.stringify({
      type: 'object', required: ['token'], properties: {
        token: { type: 'string' },
        credentials: { type: 'object', required: ['api/key~'], properties: { 'api/key~': { type: 'string' } } },
        endpoints: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
      },
    }));
    const result = await createStore(root, 'zhin.config.yml').validatePluginConfig('plugin', {
      credentials: {}, endpoints: [{}],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map(error => error.path)).toEqual(['$.token', '$.credentials.api/key~', '$.endpoints.0.id']);
  });

  it('validates absent root and embedded plugin config using object defaults without mutating declarations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-absent-config-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {child: ./child}\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'console-project',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [] },
    }));
    const child = join(root, 'child');
    await mkdir(child);
    await writeFile(join(child, 'package.json'), JSON.stringify({ name: 'console-child',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    }));
    const schema = { type: 'object', required: ['token'],
      $defs: { token: { type: 'string', minLength: 2 } },
      properties: { token: { $ref: '#/$defs/token' } },
    };
    const store = createStore(root, 'zhin.config.yml');
    for (const [name, directory] of [['plugin', root], ['child', child]] as const) {
      const file = join(directory, 'schema.json');
      await writeFile(file, JSON.stringify(schema));
      expect(await store.validatePluginConfig(name, undefined)).toMatchObject({ valid: false, errors: [{ path: '$.token' }] });
      await writeFile(file, JSON.stringify({ ...schema, default: { token: 'ok' } }));
      expect(await store.validatePluginConfig(name, undefined)).toMatchObject({ valid: true });
      expect(await store.validatePluginConfig(name, null)).toMatchObject({ valid: false });
      await writeFile(file, JSON.stringify({ ...schema, default: { token: 'x' } }));
      expect(await store.validatePluginConfig(name, undefined)).toMatchObject({ valid: false, errors: [{ path: '$.token' }] });
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ default: { token: 'x' } });
    }
  });

  it('uses the Runtime standard validator for strings, lists, step, unknown fields and references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-standard-validation-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\nplugin: {}\n');
    await writeFile(join(root, 'schema.json'), JSON.stringify({
      type: 'object', additionalProperties: false,
      $defs: { code: { type: 'string', minLength: 2, maxLength: 3, pattern: '^[A-Z]+$' } },
      properties: {
        code: { $ref: '#/$defs/code' },
        items: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
        count: { type: 'number', multipleOf: 1 },
      },
    }));
    const store = createStore(root, 'zhin.config.yml');
    const valid = { code: 'AB', items: ['x'], count: 2 };
    expect(await store.validatePluginConfig('plugin', valid)).toMatchObject({ valid: true });
    for (const value of [{ ...valid, code: 'a' }, { ...valid, code: 'ABCD' },
      { ...valid, items: [] }, { ...valid, items: ['x', 'y', 'z'] }, { ...valid, count: 2.5 },
      { ...valid, unknown: true }]) {
      expect(await store.validatePluginConfig('plugin', value)).toMatchObject({ valid: false });
    }
    expect(valid).toEqual({ code: 'AB', items: ['x'], count: 2 });
  });
  it('enforces root project integer bounds and rejects container type errors without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-schema-validation-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\nplugin: {}\n');
    await writeFile(join(root, 'schema.json'), JSON.stringify({
      type: 'object', properties: {
        threshold: { type: 'integer', minimum: 1, maximum: 5 },
        items: { type: 'array', items: { type: 'string' } },
        nested: { type: 'object', properties: { active: { type: 'boolean' } } },
      },
    }));
    const store = createStore(root, 'zhin.config.yml');
    for (const threshold of [0, 6, 1.5]) {
      expect(await store.validatePluginConfig('plugin', { threshold })).toMatchObject({ valid: false });
    }
    expect(await store.validatePluginConfig('plugin', { threshold: 3 })).toMatchObject({ valid: true });
    expect(await store.validatePluginConfig('plugin', { items: 1, nested: 'bad' })).toMatchObject({
      valid: false, errors: [{path: '$.items', message: '类型应为 list'}, {path: '$.nested', message: '类型应为 object'}],
    });
  });
});

function createStore(root: string, fileName: string): ConsoleConfigurationStore {
  return new ConsoleConfigurationStore({
    projectRoot: root,
    document: createConfigDocument(join(root, fileName)),
  });
}
