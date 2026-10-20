import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { defineFeatureProvider } from '@zhin.js/feature-kit';
import {
  childPluginId,
  definePlugin,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import commandFeature, {
  CommandIndex,
  commandFeatureId,
  defineCommand,
} from '@zhin.js/command';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Application and Feature topology transaction', () => {
  it('reprojects a retained Feature when an owner changes even if it has no slots', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    for (const name of ['', 'plugins/a/', 'plugins/b/']) {
      modules.set(join(project, name, 'plugin.ts'), { default: definePlugin({ name: name.split('/')[1] || 'root' }) });
    }
    let projections = 0;
    let disposed = 0;
    modules.set(join(project, 'packages/command/index.ts'), { default: defineFeatureProvider({
      protocol: 1, id: commandFeatureId,
      authoring: { conventions: [], validate(value) { return value; } },
      runtime: { retain: 'when-owner-unchanged', project() {
        return { value: { sequence: ++projections }, dispose() { disposed++; } };
      } },
    }) });
    const runtime = new RootRuntime({ projectRoot: project, modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: { configVersion: 2, plugins: { a: '@test/a' } },
    });
    const hmr = runtime.createHmrCoordinator({ onRestartRequired() {}, onError() {} });
    try {
      await runtime.start();
      const first = runtime.snapshot.projections.get(commandFeatureId);
      await runtime.patchConfig([{ op: 'set', path: ['plugins', 'b'], value: '@test/b' }]);
      expect(runtime.snapshot.projections.get(commandFeatureId)).toBe(first);
      expect(projections).toBe(1);
      expect(disposed).toBe(0);
      await writePluginManifest(project, 'b', { features: [{ package: '@test/command' }] });
      await hmr.enqueue(join(project, 'plugins/b/package.json'));
      expect(projections).toBe(2);
      await writeJson(join(project, 'plugins/a/package.json'), { name: '@test/a',
        dependencies: { '@test/command': 'workspace:*' },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/command' }], metadata: { displayName: 'Changed owner' } },
      });
      await hmr.enqueue(join(project, 'plugins/a/package.json'));
      expect(projections).toBe(3);
      expect(runtime.snapshot.capabilities.size).toBe(0);
    } finally { await hmr.stop(); await runtime.stop(); }
    expect(disposed).toBe(3);
  });

  it('adds, removes, and renames root instances and moves Features without rebuilding stable Scopes', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const rootId = rootPluginId();
    const aId = childPluginId(rootId, 'a');
    const bId = childPluginId(rootId, 'b');
    const cId = childPluginId(rootId, 'c');
    const movedC = childPluginId(rootId, 'moved');
    const setup = { root: 0, a: 0, b: 0, c: 0, broken: 0 };
    const disposed: string[] = [];
    const source = (path: string) => join(project, path);
    modules.set(source('plugin.ts'), plugin('root'));
    modules.set(source('plugins/a/plugin.ts'), plugin('a'));
    modules.set(source('plugins/b/plugin.ts'), plugin('b'));
    modules.set(source('plugins/c/plugin.ts'), plugin('c'));
    modules.set(source('plugins/broken/plugin.ts'), {
      default: definePlugin({
        name: 'broken',
        setup({ lifecycle }) {
          setup.broken += 1;
          lifecycle.add(() => { disposed.push('broken'); });
          throw new Error('broken topology setup');
        },
      }),
    });
    modules.set(source('packages/command/index.ts'), { default: commandFeature });
    for (const owner of ['a', 'b', 'c']) {
      modules.set(source(`plugins/${owner}/commands/${owner}/status/index.ts`), {
        default: defineCommand({ execute: ({ owner: contextOwner }) => contextOwner.id }),
      });
    }

    const runtime = new RootRuntime({
      config: { configVersion: 2, plugins: { a: '@test/a', b: '@test/b' } },
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired() {},
      onError() {},
    });

    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 0, broken: 0 });
    await expect(commandIndex(runtime.snapshot).execute('a status')).resolves.toBe('root/a');

    await runtime.patchConfig([{ op: 'set', path: ['plugins', 'c'], value: '@test/c' }]);
    expect(runtime.snapshot.tree.get(rootId)?.children).toEqual([aId, bId, cId]);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 1, broken: 0 });
    await expect(commandIndex(runtime.snapshot).execute('c status')).resolves.toBe('root/c');
    await expect(commandIndex(runtime.snapshot).execute('c inline')).resolves.toBe('inline:c');

    await writePluginManifest(project, 'a', {});
    await writePluginManifest(project, 'b', {
      features: [{ package: '@test/command' }],
    });
    await Promise.all([
      hmr.enqueue(source('plugins/a/package.json')),
      hmr.enqueue(source('plugins/b/package.json')),
    ]);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 1, broken: 0 });
    expect(commandIndex(runtime.snapshot).has('a status')).toBe(false);
    await expect(commandIndex(runtime.snapshot).execute('b status')).resolves.toBe('root/b');
    expect(modules.loadCount(source('packages/command/index.ts'))).toBe(1);

    const beforeMove = runtime.snapshots.acquire();
    await runtime.patchConfig([
      { op: 'remove', path: ['plugins', 'c'] },
      { op: 'set', path: ['plugins', 'moved'], value: '@test/c' },
    ]);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 2, broken: 0 });
    expect(runtime.snapshot.tree.get(rootId)?.children).toEqual([aId, bId, movedC]);
    expect(runtime.snapshot.tree.get(bId)?.children).toEqual([]);
    await expect(commandIndex(runtime.snapshot).execute('c status')).resolves.toBe('root/moved');
    await expect(commandIndex(runtime.snapshot).execute('c inline')).resolves.toBe('inline:c');
    await expect(commandIndex(beforeMove.value).execute('c status')).resolves.toBe('root/c');
    expect(disposed).toEqual([]);
    beforeMove.release();
    await waitForImmediate();
    expect(disposed).toEqual(['c']);

    await runtime.patchConfig([{ op: 'remove', path: ['plugins', 'moved'] }]);
    expect(commandIndex(runtime.snapshot).has('c status')).toBe(false);
    await waitForImmediate();
    expect(disposed).toEqual(['c', 'c']);

    await writePluginManifest(project, 'b', {});
    await hmr.enqueue(source('plugins/b/package.json'));
    expect(runtime.snapshot.projections.has(commandFeatureId)).toBe(false);
    expect(modules.loadCount(source('packages/command/index.ts'))).toBe(1);

    await writePluginManifest(project, 'b', {
      features: [{ package: '@test/command' }],
    });
    await hmr.enqueue(source('plugins/b/package.json'));
    await expect(commandIndex(runtime.snapshot).execute('b status')).resolves.toBe('root/b');
    expect(modules.loadCount(source('packages/command/index.ts'))).toBe(2);

    const beforeNoop = runtime.snapshot;
    await writePluginManifest(project, 'b', {
      features: [{ package: '@test/command' }],
    });
    await hmr.enqueue(source('plugins/b/package.json'));
    expect(runtime.snapshot).toBe(beforeNoop);

    await touch(source('packages/command/next.ts'));
    modules.set(source('packages/command/next.ts'), { default: commandFeature });
    await writeJson(source('packages/command/package.json'), {
      name: '@test/command',
      zhin: { protocol: 1, type: 'feature', entry: './next.ts' },
    });
    await hmr.enqueue(source('packages/command/package.json'));
    await expect(commandIndex(runtime.snapshot).execute('b status')).resolves.toBe('root/b');
    expect(modules.loadCount(source('packages/command/next.ts'))).toBe(1);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 2, broken: 0 });

    const committed = runtime.snapshot;
    await expect(runtime.patchConfig([{ op: 'set', path: ['plugins', 'broken'], value: '@test/broken' }]))
      .rejects.toThrow('broken topology setup');
    expect(runtime.snapshot).toBe(committed);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 2, broken: 1 });
    expect(disposed).toEqual(['c', 'c', 'broken']);

    await runtime.stop();
    expect(disposed).toEqual(['c', 'c', 'broken', 'b', 'a', 'root']);

    function plugin(name: 'root' | 'a' | 'b' | 'c') {
      return {
        default: definePlugin({
          name,
          setup({ lifecycle, addCommand }) {
            setup[name] += 1;
            if (name === 'c') {
              addCommand('c/inline', defineCommand({ execute: () => `inline:${name}` }));
            }
            lifecycle.add(() => { disposed.push(name); });
          },
        }),
      };
    }
  });
});

function commandIndex(snapshot: RuntimeSnapshot): CommandIndex {
  const index = snapshot.projections.get(commandFeatureId);
  if (!(index instanceof CommandIndex)) throw new Error('Missing Command projection');
  return index;
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    this.#loads.set(source, (this.#loads.get(source) ?? 0) + 1);
    return this.#modules.get(source) as T;
  }

  loadCount(source: string): number {
    return this.#loads.get(source) ?? 0;
  }

  affectedSources(source: string): readonly string[] {
    return [source];
  }

  invalidate(): void {}

  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-topology-'));
  temporary.push(root);
  await writeRootManifest(root);
  await writePluginManifest(root, 'a', {
    features: [{ package: '@test/command' }],
  });
  await writePluginManifest(root, 'b', {});
  await writePluginManifest(root, 'c', {
    features: [{ package: '@test/command' }],
  });
  await writeJson(join(root, 'plugins/broken/package.json'), {
    name: '@test/broken',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  });
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@test/command',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  for (const file of [
    'plugin.ts',
    'plugins/a/plugin.ts',
    'plugins/a/commands/a/status/index.ts',
    'plugins/b/plugin.ts',
    'plugins/b/commands/b/status/index.ts',
    'plugins/c/plugin.ts',
    'plugins/c/commands/c/status/index.ts',
    'plugins/broken/plugin.ts',
    'packages/command/index.ts',
  ]) await touch(join(root, file));
  return realpath(root);
}

interface PluginManifestOptions {
  readonly features?: readonly { readonly package: string }[];
}

async function writePluginManifest(
  root: string,
  name: 'a' | 'b' | 'c',
  options: PluginManifestOptions,
): Promise<void> {
  await writeJson(join(root, `plugins/${name}/package.json`), {
    name: `@test/${name}`,
    dependencies: {
      ...(name === 'c' ? {} : { '@test/c': 'workspace:*' }),
      '@test/command': 'workspace:*',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: options.features ?? [],
    },
  });
}

async function writeRootManifest(
  root: string,
): Promise<void> {
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: {
      '@test/a': 'workspace:*',
      '@test/b': 'workspace:*',
      '@test/c': 'workspace:*',
      '@test/broken': 'workspace:*',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
    },
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
