import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
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

describe('config document flatten / write namespace', () => {
  it('flattens plugins.<key> to top-level for Console config:get-all', () => {
    const flat = flattenConfigDocument({
      http: { port: 8086 },
      plugins: {
        sandbox: { endpoints: [{ name: 'bot' }] },
        icqq: { name: '123' },
      },
    });
    expect(flat.http).toEqual({ port: 8086 });
    expect(flat.sandbox).toEqual({ endpoints: [{ name: 'bot' }] });
    expect(flat.icqq).toEqual({ name: '123' });
    expect(flat.plugins).toBeUndefined();
  });

  it('prefers top-level host keys over same-named plugins.<key>', () => {
    const flat = flattenConfigDocument({
      ai: { providers: { openai: {} } },
      plugins: {
        ai: { pluginConfig: true },
        sandbox: { endpoints: [] },
      },
    });
    // instanceKey 叫 ai 时不得覆盖顶层 host 的 ai 键
    expect(flat.ai).toEqual({ providers: { openai: {} } });
    expect(flat.sandbox).toEqual({ endpoints: [] });
  });

  it('does not pollute the prototype when flattening documents with __proto__ keys', () => {
    const document = JSON.parse('{"plugins": {"__proto__": {"polluted": true}}}');
    const flat = flattenConfigDocument(document);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(flat, '__proto__')).toBe(false);
  });

  it('addresses host keys at the root and Plugin keys under plugins.*', () => {
    const document = { plugins: { sandbox: {} } };
    expect(configKeyPatch(document, 'http', { port: 9 }).path).toEqual(['http']);
    expect(configKeyPatch(document, 'sandbox', { endpoints: [] }).path)
      .toEqual(['plugins', 'sandbox']);
    expect(configKeyPatch(document, 'new-plugin', { enabled: true }).path)
      .toEqual(['plugins', 'new-plugin']);
  });

  it('rejects __proto__/constructor/prototype as config keys', () => {
    const document: Record<string, unknown> = {};
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => configKeyPatch(document, key, { polluted: true })).toThrow(/Invalid config key/);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('treats prototype-inherited names (toString) as plugin keys, not top-level keys', () => {
    const document: Record<string, unknown> = {};
    expect(configKeyPatch(document, 'toString', { enabled: true }).path)
      .toEqual(['plugins', 'toString']);
  });

  it('rejects plugins arrays instead of promoting legacy configuration', () => {
    const document: Record<string, unknown> = { plugins: ['sandbox', 'icqq'] };
    expect(() => configKeyPatch(document, 'sandbox', { endpoints: [{ name: 'bot' }] }))
      .toThrow(/plugins must be an object keyed by Plugin instanceKey/);
    expect(document.plugins).toEqual(['sandbox', 'icqq']);
  });

  it('serializes concurrent project configuration writes without losing keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-lock-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'plugins:\n  a: {}\n');

    // 无锁时两次 读-改-写 基于同一份旧文档，后写覆盖先写（丢一个键）。
    const configuration = createStore(root, 'zhin.config.yml');
    await Promise.all([
      configuration.setKey('a', { x: 1 }),
      configuration.setKey('b', { y: 2 }),
      configuration.setKey('c', { z: 3 }),
    ]);

    const saved = await readFile(join(root, 'zhin.config.yml'), 'utf8');
    const parsed = parseYaml(saved) as { plugins: Record<string, unknown> };
    expect(parsed.plugins.a).toEqual({ x: 1 });
    expect(parsed.plugins.b).toEqual({ y: 2 });
    expect(parsed.plugins.c).toEqual({ z: 3 });

    // 失败不断链：后续写仍可成功。
    await expect(configuration.setKey('__proto__', { polluted: true }))
      .rejects.toThrow(/Invalid config key/);
    await configuration.setKey('d', { ok: true });
    const after = parseYaml(await readFile(join(root, 'zhin.config.yml'), 'utf8')) as {
      plugins: Record<string, unknown>;
    };
    expect(after.plugins.d).toEqual({ ok: true });
  });

  it('requires a process restart only for Host configuration keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-impact-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'plugins:\n  sandbox: {}\n');
    const configuration = createStore(root, 'zhin.config.yml');

    await expect(configuration.setKey('sandbox', { endpoints: [] }))
      .resolves.toEqual({ restartRequired: false });
    await expect(configuration.setKey('http', { port: 9090 }))
      .resolves.toEqual({ restartRequired: true });
    await expect(configuration.removeKey('sandbox'))
      .resolves.toEqual({ restartRequired: false });
    await expect(configuration.removeKey('http'))
      .resolves.toEqual({ restartRequired: true });
  });

  it('exposes and replaces JSON source without translating formats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-json-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.json'), '{"http":{"port":1000}}\n');

    const configuration = createStore(root, 'zhin.config.json');
    const current = await configuration.readSource();
    expect(current.format).toBe('json');
    expect(current.configKeys).toEqual(['http']);
    const source = '{\n  "http": { "port": 2000 }\n}\n';
    await expect(configuration.replaceSource(source, current.revision)).resolves.toEqual({
      revision: expect.any(String),
      restartRequired: true,
    });

    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual({
      http: { port: 2000 },
    });
  });

  it('replaces Plugin-only source without requiring a process restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-plugin-source-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'plugins:\n  sandbox:\n    enabled: false\n');
    const configuration = createStore(root, 'zhin.config.yml');
    const current = await configuration.readSource();

    await expect(configuration.replaceSource(
      'plugins:\n  sandbox:\n    enabled: true\n',
      current.revision,
    )).resolves.toEqual({
      revision: expect.any(String),
      restartRequired: false,
    });
  });

  it('rejects stale whole-document replacements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-conflict-'));
    tempRoots.push(root);
    const file = join(root, 'zhin.config.yml');
    await writeFile(file, 'http:\n  port: 1000\n');
    const configuration = createStore(root, 'zhin.config.yml');
    const current = await configuration.readSource();
    await writeFile(file, 'http:\n  port: 2000\n');

    await expect(configuration.replaceSource('http:\n  port: 3000\n', current.revision))
      .rejects.toThrow(/changed since it was read/);
  });
});

describe('Console schema validation', () => {
  it('reports the exact missing required field, including nested objects and array items', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-required-paths-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'plugin: {}\n');
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
    await writeFile(join(root, 'zhin.config.yml'), '{}\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'console-project',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [{ package: './child', instanceKey: 'child' }] },
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
    await writeFile(join(root, 'zhin.config.yml'), 'plugin: {}\n');
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
    await writeFile(join(root, 'zhin.config.yml'), 'plugin: {}\n');
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
