import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  ConsoleConfigurationStore,
} from '../../../src/plugin-runtime/console/configuration.js';
import {
  flattenConfigDocument,
  writeConfigKey,
} from '../../../src/plugin-runtime/console/configuration-document.js';

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

  it('writes host keys to top-level and plugins under plugins.*', () => {
    const document: Record<string, unknown> = { plugins: { sandbox: {} } };
    writeConfigKey(document, 'http', { port: 9 });
    writeConfigKey(document, 'sandbox', { endpoints: [] });
    writeConfigKey(document, 'new-plugin', { enabled: true });
    expect(document.http).toEqual({ port: 9 });
    expect((document.plugins as Record<string, unknown>).sandbox).toEqual({ endpoints: [] });
    expect((document.plugins as Record<string, unknown>)['new-plugin']).toEqual({ enabled: true });
  });

  it('rejects __proto__/constructor/prototype as config keys', () => {
    const document: Record<string, unknown> = {};
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => writeConfigKey(document, key, { polluted: true })).toThrow(/Invalid config key/);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(document.plugins).toBeUndefined();
  });

  it('treats prototype-inherited names (toString) as plugin keys, not top-level keys', () => {
    const document: Record<string, unknown> = {};
    writeConfigKey(document, 'toString', { enabled: true });
    // 'toString' in document 为 true（原型链），但不得写到顶层
    expect(Object.prototype.hasOwnProperty.call(document, 'toString')).toBe(false);
    expect((document.plugins as Record<string, unknown>).toString).toEqual({ enabled: true });
  });

  it('rejects plugins arrays instead of promoting legacy configuration', () => {
    const document: Record<string, unknown> = { plugins: ['sandbox', 'icqq'] };
    expect(() => writeConfigKey(document, 'sandbox', { endpoints: [{ name: 'bot' }] }))
      .toThrow(/plugins must be an object keyed by Plugin instanceKey/);
    expect(document.plugins).toEqual(['sandbox', 'icqq']);
  });

  it('serializes concurrent project configuration writes without losing keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-lock-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'plugins:\n  a: {}\n');

    // 无锁时两次 读-改-写 基于同一份旧文档，后写覆盖先写（丢一个键）。
    const configuration = new ConsoleConfigurationStore(root);
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

  it('preserves JSON syntax when replacing config through the YAML editor contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-json-'));
    tempRoots.push(root);
    await writeFile(join(root, 'zhin.config.json'), '{"http":{"port":1000}}\n');

    const configuration = new ConsoleConfigurationStore(root);
    await configuration.writeYaml('http:\n  port: 2000\n');

    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual({
      http: { port: 2000 },
    });
  });

  it('rejects multiple Root configuration files instead of selecting one implicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-console-config-multiple-'));
    tempRoots.push(root);
    await writeFile(join(root, 'config.json'), '{}\n');
    await writeFile(join(root, 'zhin.config.yml'), '{}\n');

    const configuration = new ConsoleConfigurationStore(root);
    await expect(configuration.readDocument()).rejects.toThrow(/Multiple Root config files found/);
  });
});
