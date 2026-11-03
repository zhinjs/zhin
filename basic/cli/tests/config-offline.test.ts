import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ConfigFileDocument } from '@zhin.js/config-file';
import { patchOfflineConfiguration, validateOfflineConfiguration } from '../src/utils/config-offline.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-offline-'));
  roots.push(root);
  const file = join(root, 'zhin.config.yml');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'offline-schema-fixture', version: '1.0.0', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.mjs', platformFeatures: false } }));
  const schema = { type: 'object', additionalProperties: false, required: ['count'], properties: {
    count: { type: 'integer', minimum: 1 },
    rows: { type: 'array', items: { type: 'string' } },
    'dot.key': { type: 'string' },
  } };
  await writeFile(join(root, 'plugin.mjs'), `import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./declaration-imported', import.meta.url), 'yes');
export default { config: { toJsonSchema() { return ${JSON.stringify(schema)}; } },
  setup() { writeFileSync(new URL('./setup-called', import.meta.url), 'bad'); throw new Error('setup must not run'); } };`);
  const source = '# retained comment\nconfigVersion: 2\nplugins: {}\nplugin:\n  count: 2\n  rows: [one, two, three]\n';
  await writeFile(file, source);
  return { root, file, source };
}

describe('explicit offline configuration writes', () => {
  it('preserves a real committed file if the commit acknowledgement is lost', async () => {
    const { root, file } = await fixture();
    const prepare = ConfigFileDocument.prototype.prepare;
    const rollback = vi.fn();
    const commit = vi.fn();
    let expectedRevision: string | undefined;
    vi.spyOn(ConfigFileDocument.prototype, 'prepare').mockImplementation(async function (current, patches) {
      expectedRevision = current.revision;
      const prepared = await prepare.call(this, current, patches);
      commit.mockImplementation(async () => { await prepared.commit(); throw new Error('synthetic lost commit acknowledgement'); });
      return { document: prepared.document, pluginOrder: prepared.pluginOrder, commit, rollback };
    });
    const result = await patchOfflineConfiguration(root, [{ op: 'set', path: ['plugin', 'count'], value: 3 }], 'development');
    expect(result).toMatchObject({ status: 'unconfirmed', expectedRevision, application: 'not-requested' });
    expect(parseYaml(await readFile(file, 'utf8')).plugin.count).toBe(3);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });
  it('loads the real inline declaration and validates the complete candidate without running setup', async () => {
    const { root, file } = await fixture();
    const result = await patchOfflineConfiguration(root, [{ op: 'set', path: ['plugin', 'count'], value: 3 }], 'development');
    expect(result).toMatchObject({ status: 'saved', application: 'not-requested' });
    expect(await readFile(file, 'utf8')).toContain('count: 3');
    expect(await readFile(file, 'utf8')).toContain('# retained comment');
    expect(await readFile(join(root, 'declaration-imported'), 'utf8')).toBe('yes');
    await expect(readFile(join(root, 'setup-called'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an inline-schema violation before saving, including missing required fields', async () => {
    const { root, file, source } = await fixture();
    await expect(patchOfflineConfiguration(root, [{ op: 'set', path: ['plugin', 'count'], value: 0 }], 'development')).rejects.toThrow(/minimum|>= 1/);
    await expect(patchOfflineConfiguration(root, [{ op: 'remove', path: ['plugin', 'count'] }], 'development')).rejects.toThrow(/required/);
    expect(await readFile(file, 'utf8')).toBe(source);
  });

  it('preserves the single schema authority instead of ignoring conflicting schema.json', async () => {
    const { root, file, source } = await fixture();
    await writeFile(join(root, 'schema.json'), JSON.stringify({ type: 'object' }));
    await expect(patchOfflineConfiguration(root, [{ op: 'set', path: ['plugin', 'count'], value: 3 }], 'development')).rejects.toThrow(/both plugin config and schema.json/);
    expect(await readFile(file, 'utf8')).toBe(source);
  });

  it('fails closed when declaration loading fails, rather than treating the plugin as schema-less', async () => {
    const { root, file, source } = await fixture();
    await writeFile(join(root, 'plugin.mjs'), 'throw new Error("declaration unavailable");');
    await expect(patchOfflineConfiguration(root, [{ op: 'set', path: ['plugin', 'count'], value: 3 }], 'development')).rejects.toThrow(/declaration unavailable/);
    expect(await readFile(file, 'utf8')).toBe(source);
  });

  it('removes array elements with splice and accepts literal dotted keys via structural paths', async () => {
    const { root, file } = await fixture();
    await patchOfflineConfiguration(root, [{ op: 'remove', path: ['plugin', 'rows', '1'] }, { op: 'set', path: ['plugin', 'dot.key'], value: 'literal' }], 'development');
    const text = await readFile(file, 'utf8');
    expect(parseYaml(text).plugin.rows).toEqual(['one', 'three']);
    expect(text).toContain('dot.key: literal');
  });

  it.each(['01', '3', '-'])('rejects invalid array index %s before any write', async index => {
    const { root, file, source } = await fixture();
    await expect(patchOfflineConfiguration(root, [{ op: 'remove', path: ['plugin', 'rows', index] }], 'development')).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(source);
  });

  it('retains original CAS ownership when a declaration import changes the source', async () => {
    const { root, file, source } = await fixture();
    const module = await readFile(join(root, 'plugin.mjs'), 'utf8');
    const external = source.replace('count: 2', 'count: 9');
    await writeFile(join(root, 'plugin.mjs'), module.replace("export default", `writeFileSync(new URL('./zhin.config.yml', import.meta.url), ${JSON.stringify(external)});\nexport default`));
    await expect(patchOfflineConfiguration(root, [{ op: 'set', path: ['plugin', 'count'], value: 3 }], 'development')).rejects.toThrow(/changed since it was read/);
    expect(await readFile(file, 'utf8')).toBe(external);
  });

  it('exposes the actual composed schema without running a Runtime', async () => {
    const { root } = await fixture();
    const composed = await validateOfflineConfiguration(root, { configVersion: 2, plugins: {}, plugin: { count: 2 } }, 'production');
    expect(composed.effectiveSchema).toMatchObject({ properties: { plugin: { properties: { count: { type: 'integer', minimum: 1 } } } } });
  });

  it('rejects missing or empty model environment values with the same evidence as Host preflight', async () => {
    const { root } = await fixture();
    const ai = { providers: { local: { sdk: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', apiKey: '${ZHIN_OFFLINE_TEST_KEY}', models: ['test'] } },
      agents: { zhin: { provider: 'local', model: 'test' } } };
    for (const value of [undefined, '']) {
      vi.stubEnv('ZHIN_OFFLINE_TEST_KEY', value);
      await expect(validateOfflineConfiguration(root, { configVersion: 2, plugins: {}, plugin: { count: 2 }, ai }, 'development'))
        .rejects.toThrow(/environment references are unavailable: ZHIN_OFFLINE_TEST_KEY/);
    }
  });

  it('retains canonical interpolation fallback semantics without reading a remote secret', async () => {
    const { root } = await fixture();
    vi.stubEnv('ZHIN_OFFLINE_TEST_KEY', undefined);
    const ai = { providers: { local: { sdk: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', apiKey: '${ZHIN_OFFLINE_TEST_KEY:-synthetic-fallback}', models: ['test'] } },
      agents: { zhin: { provider: 'local', model: 'test' } } };
    await expect(validateOfflineConfiguration(root, { configVersion: 2, plugins: {}, plugin: { count: 2 }, ai }, 'development')).resolves.toBeDefined();
  });

  it('validates canonical catalog presets and env:// with the selected environment overlay', async () => {
    const { root } = await fixture();
    vi.stubEnv('ZHIN_OFFLINE_TEST_KEY', undefined);
    const ai = { modelCatalog: {
      connections: { main: { sdk: 'openai-compatible', revision: 1, baseUrl: 'https://synthetic.invalid/v1', secretRef: 'env://ZHIN_OFFLINE_TEST_KEY' } },
      models: { chat: { connectionId: 'main', model: 'test', capabilities: { input: ['text'] } } },
      presets: { main: { modelId: 'chat' } },
    }, modelPolicy: { defaults: { chat: 'main' } }, agents: { zhin: { preset: 'main' } } };
    const document = { configVersion: 2, plugins: {}, plugin: { count: 2 }, ai };
    await expect(validateOfflineConfiguration(root, document, 'production')).rejects.toThrow(/environment references are unavailable/);
    await writeFile(join(root, '.env.production'), 'ZHIN_OFFLINE_TEST_KEY=synthetic-environment-value\n');
    await expect(validateOfflineConfiguration(root, document, 'production')).resolves.toBeDefined();
  });

  it.each([undefined, {}, { enabled: false, providers: {} }])('allows IM-only/disabled AI configuration without requiring models: %j', async ai => {
    const { root } = await fixture();
    await expect(validateOfflineConfiguration(root, { configVersion: 2, plugins: {}, plugin: { count: 2 }, ...(ai ? { ai } : {}) }, 'development')).resolves.toBeDefined();
  });
});
