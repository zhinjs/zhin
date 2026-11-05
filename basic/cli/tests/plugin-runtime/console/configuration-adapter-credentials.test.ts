import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { REDACTED_CONFIG_VALUE } from '../../../src/plugin-runtime/console/configuration-redaction.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const credentialFields = [
  ['lark', 'encryptKey'], ['lark', 'verificationToken'], ['kook', 'verify_token'], ['kook', 'encrypt_key'],
  ['slack', 'appToken'], ['wechat-mp', 'encodingAESKey'], ['wecom', 'encodingAESKey'],
] as const;

async function fixture(adapter: string, key: string) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-adapter-credentials-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'credential-fixture',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await mkdir(join(root, 'adapter'));
  await writeFile(join(root, 'adapter/package.json'), JSON.stringify({ name: 'credential-adapter',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  // Use the published adapter schema, including the actual endpoints array boundary.
  const schema = await readFile(new URL(`../../../../../plugins/adapters/${adapter}/schema.json`, import.meta.url), 'utf8');
  await writeFile(join(root, 'adapter/schema.json'), schema);
  const sentinel = `synthetic-${adapter}-${key}-private`;
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify({ configVersion: 2, plugins: { adapter: './adapter' },
    adapter: { endpoints: [{ id: 'test', [key]: sentinel }] } }));
  const document = createConfigDocument(file);
  const store = new ConsoleConfigurationStore({ projectRoot: root, document, environmentForPlugin: () => ({ has: () => true }) });
  return { file, document, store, sentinel, path: ['adapter', 'endpoints', '0', key] };
}

describe('adapter credential configuration boundaries', () => {
  it.each(credentialFields)('redacts %s.%s in project reads', async (adapter, key) => {
    const f = await fixture(adapter, key);
    expect(await f.store.readProject({ path: f.path })).toMatchObject({ value: REDACTED_CONFIG_VALUE, redacted: true });
    const nested = await f.store.readProject({ path: ['adapter'] });
    expect(nested).toMatchObject({ value: { endpoints: [{ id: 'test', [key]: REDACTED_CONFIG_VALUE }] } });
    expect(JSON.stringify(await f.store.readProject())).not.toContain(f.sentinel);
    // Revealing values remains a separate explicit administration operation.
    expect(await f.store.readProject({ path: f.path, reveal: true })).toMatchObject({ value: f.sentinel, redacted: false });
  });

  it.each(credentialFields)('redacts %s.%s in project conflict evidence', async (adapter, key) => {
    const f = await fixture(adapter, key);
    const before = await readFile(f.file, 'utf8');
    const conflict = await f.store.patchProject({ expectedRevision: 'stale', patches: [{ op: 'set', path: f.path, value: 'replacement' }] });
    expect(conflict).toMatchObject({ status: 'conflict', current: [{ path: f.path, value: REDACTED_CONFIG_VALUE }] });
    expect(JSON.stringify(conflict)).not.toContain(f.sentinel);
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });

  it.each(credentialFields)('rejects chat reads and writes of %s.%s before preparing a mutation', async (adapter, key) => {
    const f = await fixture(adapter, key);
    const before = await readFile(f.file, 'utf8');
    const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    expect(await f.store.readChat(f.path, 'fields')).toMatchObject({ fields: [] });
    for (const action of [
      () => f.store.readChat(f.path, 'get'),
      () => f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: f.path, value: 'replacement' }] }),
      () => f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'remove', path: f.path }] }),
    ]) {
      const error: unknown = await action().then(() => undefined, (caught: unknown) => caught);
      expect(error).toMatchObject({ kind: 'sensitive' });
      expect(JSON.stringify(error) + String(error)).not.toContain(f.sentinel);
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });

  it('keeps ordinary token budgets and non-credential keys readable and editable', async () => {
    const f = await fixture('slack', 'appToken');
    const value = { maxTokens: 100, tokenLimit: 200, tokenizer: 'default', key: 'ordinary', publicKey: 'public' };
    await writeFile(join(dirname(f.file), 'adapter/schema.json'), JSON.stringify({ type: 'object', additionalProperties: false,
      properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, { type: typeof item }])) }));
    await writeFile(f.file, JSON.stringify({ configVersion: 2, plugins: { adapter: './adapter' }, adapter: value }));
    expect(await f.store.readProject({ path: ['adapter'] })).toMatchObject({ value });
    for (const [key, item] of Object.entries(value)) {
      expect(await f.store.readChat(['adapter', key], 'get')).toMatchObject({ value: item });
    }
    const { revision } = await f.store.readSource();
    expect(await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['adapter', 'maxTokens'], value: 300 }] }))
      .toMatchObject({ status: 'saved' });
    expect(await f.store.readChat(['adapter', 'maxTokens'], 'get')).toMatchObject({ value: 300 });
  });
});
