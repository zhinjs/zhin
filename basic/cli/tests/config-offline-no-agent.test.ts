import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOfflineConfigurationStore } from '../src/utils/config-offline.js';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/ai-config-loader.js', () => ({ loadAiConfigUtils: lookup }));

it('keeps disabled AI outside IM-only offline composition but still rejects an active domain or a structured AI write without its package', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'offline-without-agent-')));
  const cli = join(root, 'node_modules/@zhin.js/cli');
  await mkdir(join(cli, 'lib/utils'), { recursive: true });
  await writeFile(join(cli, 'package.json'), JSON.stringify({ name: '@zhin.js/cli', type: 'module' }));
  await symlink(new URL('../node_modules/fs-extra', import.meta.url).pathname, join(root, 'node_modules/fs-extra'), 'dir');
  // The actual loader resolves from this isolated CLI/project, not the monorepo
  // that has Agent installed. Its normal project and fallback lookups both miss.
  const loader = join(cli, 'lib/utils/ai-config-loader.js');
  await writeFile(loader, stripTypeScriptTypes(await readFile(new URL('../src/utils/ai-config-loader.ts', import.meta.url), 'utf8')));
  const readInstalled = () => {
    // A real Node child avoids Vitest/tsx's workspace resolution hooks that
    // intentionally make the monorepo's optional Agent available to tests.
    const code = `const loader = await import(${JSON.stringify(pathToFileURL(loader).href)}); process.stdout.write(JSON.stringify(loader.loadAiConfigUtils(${JSON.stringify(root)}) === null));`;
    expect(execFileSync(process.execPath, ['--input-type=module', '--eval', code], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test' },
    })).toBe('true');
    return null;
  };
  readInstalled();
  lookup.mockImplementation(readInstalled);
  const file = join(root, 'zhin.config.json');
  const initial = { configVersion: 2, plugins: {}, ai: { enabled: false }, log_level: 'info' };
  await writeFile(file, JSON.stringify(initial));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'offline-im-only', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.mjs', platformFeatures: false } }));
  await writeFile(join(root, 'plugin.mjs'), 'export default {};');
  try {
    const store = createOfflineConfigurationStore(root, 'test');
    const original = await store.readSource();
    const saved = await store.patchProject({ expectedRevision: original.revision, patches: [{ op: 'set', path: ['log_level'], value: 'debug' }] });
    expect(saved.status).toBe('saved'); expect(lookup).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ...initial, log_level: 'debug' });
    const before = await readFile(file, 'utf8'), revision = (await store.readSource()).revision;
    for (const ai of [{ enabled: true }, { enabled: false, providers: { old: { apiKey: '${UNREAD_SECRET}' } } }]) {
      const rejected = await store.patchProject({ expectedRevision: revision, patches: [{ op: 'set', path: ['ai'], value: ai }] });
      expect(lookup).toHaveBeenCalled();
      expect(lookup.mock.results.at(-1)?.value).toBeNull();
      expect(rejected).toMatchObject({ status: 'invalid', errors: [{ message: 'AI configuration validation requires the installed Agent package' }] });
      expect(await readFile(file, 'utf8')).toBe(before);
    }
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(await store.patchProject({ expectedRevision: original.revision, patches: [{ op: 'set', path: ['log_level'], value: 'warn' }] })).toMatchObject({ status: 'conflict' });
    expect(await readFile(file, 'utf8')).toBe(before);
  } finally { lookup.mockReset(); await rm(root, { recursive: true, force: true }); }
});
