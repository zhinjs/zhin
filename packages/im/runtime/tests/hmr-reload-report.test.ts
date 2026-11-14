import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { RootHost, type HmrReloadReport, type ModuleRuntime } from '../src/index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose(); });

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-hmr-report-')));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const manifest = (name: string) => JSON.stringify({ name, type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, features: [] } });
  for (const name of ['child', 'adapter']) {
    await mkdir(join(root, 'plugins', name), { recursive: true });
    await writeFile(join(root, 'plugins', name, 'package.json'), manifest(name));
    await writeFile(join(root, 'plugins', name, 'plugin.js'), 'export default {};');
  }
  await writeFile(join(root, 'package.json'), manifest('report-root'));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await writeFile(join(root, 'AGENTS.md'), '# bot\n');
  const modules: ModuleRuntime = {
    load: async <T>(source: string) => {
      const name = source.includes('/plugins/child/') ? 'child' : source.includes('/plugins/adapter/') ? 'adapter' : 'report-root';
      return { default: definePlugin({ name }) } as T;
    },
    invalidate: () => {},
    // `watch: []` never subscribes; reloadSources() still needs a watcher-capable runtime.
    watch: () => () => undefined,
    close: async () => {},
  };
  const reports: HmrReloadReport[] = [];
  const host = new RootHost({ projectRoot: root, modules, watch: [],
    config: { configVersion: 2, plugins: { child: './plugins/child', adapter: './plugins/adapter' } },
    environment: { name: 'test', mode: 'test', platform: 'node' },
    onReload: (_plan, _generation, _duration, report) => { if (report) reports.push(report); },
    onRestartRequired: (plan) => { throw new Error(`Unexpected restart: ${plan.reasons.join()}`); },
  });
  cleanups.push(() => host.stop());
  await host.start();
  return { root, host, reports };
}

it('reports a Root-owned non-capability file change as a whole-Root rebuild with every replaced plugin (#1250)', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'AGENTS.md'), '# bot v2\n');
  expect(await f.host.reloadSources([join(f.root, 'AGENTS.md')])).toBe('reloaded');
  expect(f.reports).toHaveLength(1);
  expect(f.reports[0]).toMatchObject({
    kind: 'reloaded', rebuilt: 'root',
    reason: `changed Root Plugin files are not a convention capability: ${join(f.root, 'AGENTS.md')}`,
  });
  // The sibling "adapter" plugin is set up again although nothing of it changed.
  expect(f.reports[0]?.plugins).toEqual(expect.arrayContaining(['root', 'root/adapter', 'root/child']));
});

it('reports a child entry change as a subtree rebuild of that plugin only (#1250)', async () => {
  const f = await fixture();
  expect(await f.host.reloadSources([join(f.root, 'plugins/child/plugin.js')])).toBe('reloaded');
  expect(f.reports).toEqual([{ kind: 'reloaded', rebuilt: 'subtree', plugins: ['root/child'], capabilities: [] }]);
});
