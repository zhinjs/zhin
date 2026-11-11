import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { definePlugin, rootPluginId } from '@zhin.js/plugin-runtime';
import { createConfigDocument, type ModuleRuntime } from '@zhin.js/runtime';
import { RootHost } from '../../src/instance/root-host.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose(); });

async function fixture(watch: readonly ('source' | 'config')[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-host-watch-')));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const configFile = join(root, 'zhin.config.json');
  const child = join(root, 'plugins/child');
  await mkdir(child, { recursive: true });
  const pluginFile = join(child, 'plugin.js');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'watch-fixture', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', features: [] } }));
  await writeFile(join(child, 'package.json'), JSON.stringify({ name: 'watch-child', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', features: [] } }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await writeFile(pluginFile, 'export default {};');
  const writeConfig = (menuKeyword: string) => writeFile(configFile,
    JSON.stringify({ configVersion: 2, plugins: { child: './plugins/child' }, menuKeyword }));
  await writeConfig('菜单');
  let listener: ((path: string) => void) | undefined;
  let watches = 0;
  const modules: ModuleRuntime = {
    load: async <T>(source: string) => ({ default: definePlugin({ name: source === pluginFile ? 'child' : 'watch-fixture' }) }) as T,
    invalidate: () => {},
    watch: callback => { watches++; listener = callback; return () => { listener = undefined; }; },
    close: async () => {},
  };
  let complete!: () => void;
  const reloaded = new Promise<void>(resolve => { complete = resolve; });
  const observed: string[][] = [];
  const errors: unknown[] = [];
  const host = new RootHost({ projectRoot: root, modules, config: createConfigDocument(configFile), watch,
    onReload: plan => { observed.push([...plan.changed]); complete(); }, onError: error => { errors.push(error); complete(); },
    onRestartRequired: plan => { errors.push(plan); complete(); } });
  cleanups.push(() => host.stop());
  await host.start();
  return { host, configFile, pluginFile, writeConfig, emit: (path: string) => listener?.(path),
    reloaded, observed, errors, watches: () => watches,
    keyword: () => (host.runtime.snapshot.config.get(rootPluginId()) as { menuKeyword?: string }).menuKeyword };
}

it('config-only watch ignores source events, applies config and still allows explicit source reload', async () => {
  const f = await fixture(['config']);
  f.emit(f.pluginFile);
  await f.writeConfig('help');
  f.emit(f.configFile);
  await f.reloaded;
  expect(f.errors).toEqual([]);
  expect(f.observed).toEqual([[f.configFile]]);
  expect(f.keyword()).toBe('help');
  const outcome = await f.host.reloadSources([f.pluginFile]);
  expect(f.errors).toEqual([]);
  expect(outcome).toBe('reloaded');
  expect(f.observed.at(-1)).toEqual([f.pluginFile]);
});

it('source-only watch does not adopt an unrequested configuration edit during source reload', async () => {
  const f = await fixture(['source']);
  await f.writeConfig('help');
  f.emit(f.configFile);
  f.emit(f.pluginFile);
  await f.reloaded;
  expect(f.errors).toEqual([]);
  expect(f.observed).toEqual([[f.pluginFile]]);
  expect(f.keyword()).toBe('菜单');
});

it('registers no watcher when no scope is selected, while explicit config application works', async () => {
  const f = await fixture([]);
  expect(f.watches()).toBe(0);
  await f.writeConfig('help');
  expect(f.keyword()).toBe('菜单');
  await f.host.runtime.applyConfiguration();
  expect(f.keyword()).toBe('help');
  expect(f.watches()).toBe(0);
});
