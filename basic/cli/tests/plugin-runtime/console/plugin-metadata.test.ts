import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/config-file';
import { RootRuntime } from '@zhin.js/runtime';
import { buildManagedPluginList, buildPluginDetail } from '../../../src/plugin-runtime/console/plugin-projection.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const manifest = { protocol: 1, type: 'plugin', entry: './plugin.ts', platformFeatures: false };
const environment = { name: 'test', mode: 'test' as const, platform: 'node' };

async function json(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

async function project(config: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-console-metadata-')));
  roots.push(root);
  await json(join(root, 'package.json'), {
    name: '@test/root', type: 'module', dependencies: { '@test/child': '*', '@test/missing': '*' }, zhin: manifest,
  });
  await json(join(root, 'zhin.config.json'), { configVersion: 2, ...config });
  await writeFile(join(root, 'plugin.ts'), 'throw new Error("Root entry must not execute during static projection")');
  return root;
}

async function child(root: string, metadata?: { displayName?: string; icon?: string }, installed = false) {
  const directory = installed ? join(root, 'node_modules/@test/child') : join(root, 'plugins/child');
  await json(join(directory, 'package.json'), { name: '@test/child', type: 'module', zhin: { ...manifest, ...(metadata ? { metadata } : {}) } });
  // Both executable schema and entry are deliberately unusable. Projection may
  // resolve the manifest and stat entry candidates, but must not execute either.
  await writeFile(join(directory, 'plugin.ts'), 'throw new Error("Child entry must never execute during static projection")');
  await writeFile(join(directory, 'schema.ts'), 'throw new Error("Schema must never execute during static projection")');
  await writeFile(join(directory, 'schema.json'), 'invalid schema JSON must not be read');
  return directory;
}

describe('Console plugin metadata projection', () => {
  it('reads disabled and pending manifest metadata without entry/schema evaluation and retains missing-package fallback', async () => {
    const root = await project({
      plugins: { disabled: '@test/child', pending: '@test/child', missing: '@test/missing' },
      disable_plugins: ['disabled', 'missing'],
    });
    await child(root, { displayName: 'Static child', icon: 'Bell' }, true);
    const list = await buildManagedPluginList(root, join(root, '.zhin/plugin-lifecycle.json'));
    expect(list).toEqual([
      { name: 'disabled', status: 'inactive', description: 'Static child · 已停用', features: [],
        packageName: '@test/child', instanceKey: 'disabled', manageable: true,
        metadata: { displayName: 'Static child', icon: 'Bell' }, displayName: 'Static child', icon: 'Bell' },
      { name: 'pending', status: 'inactive', description: 'Static child · 等待 Host 加载', features: [],
        packageName: '@test/child', instanceKey: 'pending', manageable: true,
        metadata: { displayName: 'Static child', icon: 'Bell' }, displayName: 'Static child', icon: 'Bell' },
      { name: 'missing', status: 'inactive', description: '@test/missing · 已停用', features: [],
        packageName: '@test/missing', instanceKey: 'missing', manageable: true },
    ]);
  });

  it('keeps disabled throwing entries out of Runtime loads while displaying local manifest metadata', async () => {
    const root = await project({ plugins: { disabled: './plugins/child' }, disable_plugins: ['disabled'] });
    await child(root, { displayName: 'Disabled local' });
    const loads: string[] = [];
    const runtime = new RootRuntime({ projectRoot: root, config: createConfigDocument(join(root, 'zhin.config.json')), environment,
      modules: { async load<T>(source: string): Promise<T> {
        loads.push(source);
        if (source !== join(root, 'plugin.ts')) throw new Error('Disabled entry imported');
        return { default: definePlugin({ name: 'root' }) } as T;
      }, async close() {} },
    });
    try {
      await runtime.start();
      const beforeProjection = [...loads];
      const list = await buildManagedPluginList(root, join(root, '.zhin/plugin-lifecycle.json'), runtime.snapshot);
      expect(list[0]).toMatchObject({ displayName: 'Disabled local', description: 'Disabled local · 已停用' });
      expect(loads).toEqual(beforeProjection);
      expect(loads.length).toBeGreaterThan(0);
      expect(loads.every(source => source === join(root, 'plugin.ts'))).toBe(true);
    } finally { await runtime.stop(); }
  });

  it('preserves source order for numeric aliases in the managed list', async () => {
    const root = await project({});
    await writeFile(join(root, 'zhin.config.json'), '{"configVersion":2,"plugins":{"10":"@test/missing","2":"@test/missing"},"disable_plugins":["10","2"]}');
    const list = await buildManagedPluginList(root, join(root, '.zhin/plugin-lifecycle.json'));
    expect(list.map(item => item.instanceKey)).toEqual(['10', '2']);
    expect(list.every(item => !('metadata' in item) && !('displayName' in item) && !('icon' in item))).toBe(true);
  });

  it('projects loaded manifest/code metadata from the committed snapshot and refreshes it after manifest HMR', async () => {
    const root = await project({ plugins: { child: './plugins/child' } });
    const directory = await child(root, { displayName: 'Before' });
    // Loaded schema validation is unrelated to projection; remove the invalid
    // schema fixture before starting this enabled plugin.
    await rm(join(directory, 'schema.json'));
    await rm(join(directory, 'schema.ts'));
    const runtime = new RootRuntime({ projectRoot: root, config: createConfigDocument(join(root, 'zhin.config.json')), environment,
      modules: { async load<T>(source: string): Promise<T> {
        const definition = source === join(root, 'plugin.ts') ? definePlugin({ name: 'root' })
          : definePlugin({ name: 'child', metadata: { icon: 'Bell', order: 5 } });
        return { default: definition } as T;
      }, async close() {} },
    });
    const lifecycle = join(root, '.zhin/plugin-lifecycle.json');
    try {
      await runtime.start();
      const [before] = await buildManagedPluginList(root, lifecycle, runtime.snapshot);
      expect(before).toMatchObject({ description: 'Before', displayName: 'Before', icon: 'Bell', metadata: { displayName: 'Before', icon: 'Bell', order: 5 } });
      const node = [...runtime.snapshot.tree.values()].find(node => node.instanceKey === 'child')!;
      expect(buildPluginDetail(node)).toMatchObject({ displayName: 'Before', icon: 'Bell' });
      await json(join(directory, 'package.json'), { name: '@test/child', type: 'module', zhin: { ...manifest, metadata: { displayName: 'After' } } });
      // A changed disk manifest must not override still-committed loaded metadata.
      expect((await buildManagedPluginList(root, lifecycle, runtime.snapshot))[0]?.displayName).toBe('Before');
      const coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('Unexpected restart'); }, onError(error) { throw error; } });
      try { await coordinator.enqueue(join(directory, 'package.json')); }
      finally { await coordinator.stop(); }
      expect((await buildManagedPluginList(root, lifecycle, runtime.snapshot))[0]).toMatchObject({
        description: 'After', displayName: 'After', icon: 'Bell', metadata: { displayName: 'After', icon: 'Bell', order: 5 },
      });
    } finally { await runtime.stop(); }
  });
});
