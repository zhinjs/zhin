import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('Manifest topology transaction', () => {
  it('adds, removes, and moves child and Feature mounts without rebuilding stable Scopes', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const rootId = rootPluginId();
    const aId = childPluginId(rootId, 'a');
    const bId = childPluginId(rootId, 'b');
    const cInA = childPluginId(aId, 'c');
    const cInB = childPluginId(bId, 'c');
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
      modules.set(source(`plugins/${owner}/commands/status.ts`), {
        default: defineCommand({ execute: ({ owner: contextOwner }) => contextOwner.id }),
      });
    }

    const runtime = new RootRuntime({
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

    await writePluginManifest(project, 'b', {
      plugins: [{ package: '@test/c', instanceKey: 'c' }],
    });
    await hmr.enqueue(source('plugins/b/package.json'));
    expect(runtime.snapshot.tree.get(bId)?.children).toEqual([cInB]);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 1, broken: 0 });
    await expect(commandIndex(runtime.snapshot).execute('b c status')).resolves.toBe('root/b/c');

    await writePluginManifest(project, 'a', {});
    await writePluginManifest(project, 'b', {
      features: [{ package: '@test/command' }],
      plugins: [{ package: '@test/c', instanceKey: 'c' }],
    });
    await Promise.all([
      hmr.enqueue(source('plugins/a/package.json')),
      hmr.enqueue(source('plugins/b/package.json')),
    ]);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 1, broken: 0 });
    expect(commandIndex(runtime.snapshot).has('a status')).toBe(false);
    await expect(commandIndex(runtime.snapshot).execute('b status')).resolves.toBe('root/b');
    expect(modules.loadCount(source('packages/command/index.ts'))).toBe(1);

    const beforeMove = runtime.controller.snapshots.acquire();
    await writePluginManifest(project, 'a', {
      plugins: [{ package: '@test/c', instanceKey: 'c' }],
    });
    await writePluginManifest(project, 'b', {
      features: [{ package: '@test/command' }],
    });
    await Promise.all([
      hmr.enqueue(source('plugins/a/package.json')),
      hmr.enqueue(source('plugins/b/package.json')),
    ]);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 2, broken: 0 });
    expect(runtime.snapshot.tree.get(aId)?.children).toEqual([cInA]);
    expect(runtime.snapshot.tree.get(bId)?.children).toEqual([]);
    await expect(commandIndex(runtime.snapshot).execute('a c status')).resolves.toBe('root/a/c');
    await expect(commandIndex(beforeMove.value).execute('b c status')).resolves.toBe('root/b/c');
    expect(disposed).toEqual([]);
    beforeMove.release();
    await waitForImmediate();
    expect(disposed).toEqual(['c']);

    await writePluginManifest(project, 'a', {});
    await hmr.enqueue(source('plugins/a/package.json'));
    expect(commandIndex(runtime.snapshot).has('a c status')).toBe(false);
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
    await writeRootManifest(project, [
      { package: '@test/a', instanceKey: 'a' },
      { package: '@test/b', instanceKey: 'b' },
      { package: '@test/broken', instanceKey: 'broken' },
    ]);
    await expect(hmr.enqueue(source('package.json'))).rejects.toThrow('broken topology setup');
    expect(runtime.snapshot).toBe(committed);
    expect(setup).toEqual({ root: 1, a: 1, b: 1, c: 2, broken: 1 });
    expect(disposed).toEqual(['c', 'c', 'broken']);

    await writeRootManifest(project, [
      { package: '@test/a', instanceKey: 'a' },
      { package: '@test/b', instanceKey: 'b' },
    ]);
    await runtime.stop();
    expect(disposed).toEqual(['c', 'c', 'broken', 'b', 'a', 'root']);

    function plugin(name: 'root' | 'a' | 'b' | 'c') {
      return {
        default: definePlugin({
          name,
          setup({ lifecycle }) {
            setup[name] += 1;
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
  await writeRootManifest(root, [
    { package: '@test/a', instanceKey: 'a' },
    { package: '@test/b', instanceKey: 'b' },
  ]);
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
    'plugins/a/commands/status.ts',
    'plugins/b/plugin.ts',
    'plugins/b/commands/status.ts',
    'plugins/c/plugin.ts',
    'plugins/c/commands/status.ts',
    'plugins/broken/plugin.ts',
    'packages/command/index.ts',
  ]) await touch(join(root, file));
  return realpath(root);
}

interface PluginManifestOptions {
  readonly features?: readonly { readonly package: string }[];
  readonly plugins?: readonly {
    readonly package: string;
    readonly instanceKey: string;
  }[];
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
      plugins: options.plugins ?? [],
    },
  });
}

async function writeRootManifest(
  root: string,
  plugins: readonly { readonly package: string; readonly instanceKey: string }[],
): Promise<void> {
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: {
      '@test/a': 'workspace:*',
      '@test/b': 'workspace:*',
      '@test/broken': 'workspace:*',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins,
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
