import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RootRuntime } from '@zhin.js/runtime';
import { CONFIG_EXIT_CODES, createConfigCommand } from '../src/commands/config.js';
import { createOfflineConfigurationStore } from '../src/utils/config-offline.js';

const roots: string[] = [];
const previousExitCode = process.exitCode;
afterEach(async () => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-config-offline-')));
  roots.push(root);
  const file = join(root, 'zhin.config.yml');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'offline-fixture', version: '1.0.0', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.mjs', platformFeatures: false } }));
  await writeFile(join(root, 'plugin.mjs'), `import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./declaration-imported', import.meta.url), 'yes');
export default { setup() { writeFileSync(new URL('./setup-called', import.meta.url), 'bad'); throw new Error('setup must not run'); } };`);
  const source = '# retained comment\nconfigVersion: 2\nplugins: {}\nlog_level: info\nhttp:\n  token: stored-http-token\n';
  await writeFile(file, source);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetch = vi.fn(async () => { throw new Error('offline must not use the network'); });
  vi.stubGlobal('fetch', fetch);
  return { root, file, source, output, fetch };
}
async function run(...args: string[]) {
  process.exitCode = undefined;
  await createConfigCommand().parseAsync(['node', 'zhin', '--json', '--offline', ...args]);
}
const last = (output: ReturnType<typeof vi.spyOn>) => JSON.parse(String(output.mock.calls.at(-1)?.[0]));

it('--offline saves through the shared patchProject authority without a Runtime, setup or network', async () => {
  const { root, file, output, fetch } = await fixture();
  const start = vi.spyOn(RootRuntime.prototype, 'start');
  await run('set', 'log_level', 'debug');
  expect(last(output)).toMatchObject({ status: 'saved', application: 'not-requested', message: expect.stringContaining('--watch config') });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
  const saved = await readFile(file, 'utf8');
  expect(saved).toContain('log_level: debug');
  expect(saved).toContain('# retained comment');
  expect(start).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  // Declaration loading may execute module top-level code (documented); setup never runs.
  expect(await readFile(join(root, 'declaration-imported'), 'utf8')).toBe('yes');
  await expect(readFile(join(root, 'setup-called'))).rejects.toMatchObject({ code: 'ENOENT' });
  await run('unset', 'log_level');
  expect(await readFile(file, 'utf8')).not.toContain('log_level');
});

it('--offline rejects invalid values and declaration writes (exit 5) without changing the file', async () => {
  const { file, source, output } = await fixture();
  await run('set', 'log_level', '{"not":"a level"}');
  expect(last(output)).toMatchObject({ status: 'invalid', errors: [expect.objectContaining({ path: expect.stringContaining('log_level') })] });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.invalid);
  await run('set', 'plugins.extra', '"extra"');
  expect(last(output)).toMatchObject({ status: 'invalid' });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.invalid);
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('--offline reads mask secrets by schema unless --reveal', async () => {
  const { output } = await fixture();
  await run('get', 'http.token');
  expect(last(output)).toBe('[redacted]');
  await run('list');
  expect(JSON.stringify(last(output))).not.toContain('stored-http-token');
  await run('get', 'http.token', '--reveal');
  expect(last(output)).toBe('stored-http-token');
});

it('two concurrent offline writers on one revision: one saves, the other is a conflict', async () => {
  const { root } = await fixture();
  const first = createOfflineConfigurationStore(root, 'development');
  const second = createOfflineConfigurationStore(root, 'development');
  const { revision } = await first.readProject({ reveal: true });
  const results = await Promise.all([
    first.patchProject({ expectedRevision: revision, patches: [{ op: 'set', path: ['log_level'], value: 'debug' }] }),
    second.patchProject({ expectedRevision: revision, patches: [{ op: 'set', path: ['log_level'], value: 'warn' }] }),
  ]);
  expect(results.map(result => result.status).sort()).toEqual(['conflict', 'saved']);
  // A later (online or offline) read observes the desired value that won.
  const winner = results.find(result => result.status === 'saved');
  const read = await second.readProject({ path: ['log_level'] });
  expect(read).toMatchObject({ exists: true, revision: (winner as { revision: string }).revision });
});
