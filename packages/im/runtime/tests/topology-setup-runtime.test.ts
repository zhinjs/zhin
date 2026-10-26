import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { defineFeatureProvider, type FeatureProvider } from '@zhin.js/feature-kit';
import { createToken, definePlugin } from '@zhin.js/plugin-runtime';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const installationToken = createToken<{ sequence: number }>('test.installation');

it('rebuilds Root installation when its mounted Features change, through normal lease disposal', async () => {
  const f = await fixture(false);
  const hmr = f.runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('Unexpected restart'); }, onError() {} });
  try {
    await f.runtime.start();
    expect(f.installed()).toBe(1);
    expect(index(f.runtime).has('host-status')).toBe(false);
    const beforeMount = f.runtime.snapshots.acquire();
    await f.rootManifest(true);
    await hmr.enqueue(join(f.directory, 'package.json'));
    expect(f.installed()).toBe(2);
    expect(await index(f.runtime).execute('host-status')).toBe('installation:2');
    expect(index(f.runtime).has('child-inline')).toBe(true);
    expect(beforeMount.value.resources.get(beforeMount.value.root)?.get(installationToken.id)).toEqual({ sequence: 1 });
    expect(f.disposed).toEqual([]);
    beforeMount.release();
    await waitForImmediate();
    expect(f.disposed).toEqual([1]);

    await f.rootManifest(false);
    await hmr.enqueue(join(f.directory, 'package.json'));
    expect(f.installed()).toBe(3);
    expect(index(f.runtime).has('host-status')).toBe(false);
    expect(await index(f.runtime).execute('child-inline')).toBe('child:3');
    await f.rootManifest(true);
    await hmr.enqueue(join(f.directory, 'package.json'));
    expect(f.installed()).toBe(4);
    expect(await index(f.runtime).execute('host-status')).toBe('installation:4');
  } finally { await hmr.stop(); await f.runtime.stop(); await rm(f.directory, { recursive: true, force: true }); }
});

it('revalidates retained setup slots on provider refresh and rolls back rejection without replacing their Scopes', async () => {
  const f = await fixture(true);
  const hmr = f.runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('Unexpected restart'); }, onError() {} });
  try {
    await f.runtime.start();
    const first = f.runtime.snapshot;
    const beforeRefresh = f.runtime.snapshots.acquire();
    const validated: string[] = [];
    await f.provider('next.ts', defineFeatureProvider({ ...commandFeature, authoring: {
      ...commandFeature.authoring,
      validate(value, context) { validated.push(`${context.owner}:${context.localName}`); return commandFeature.authoring.validate(value, context); },
    } }));
    await hmr.enqueue(join(f.directory, 'packages/command/package.json'));
    expect(f.installed()).toBe(1);
    expect(f.childSetups()).toBe(1);
    expect(f.disposed).toEqual([]);
    expect(f.runtime.snapshot.resources.get(first.root)?.get(installationToken.id))
      .toBe(first.resources.get(first.root)?.get(installationToken.id));
    expect(validated).toEqual(expect.arrayContaining(['root:host-status', 'root/child:child-inline']));
    for (const current of [index(f.runtime), beforeRefresh.value.projections.get(commandFeatureId) as CommandIndex]) {
      expect(await current.execute('host-status')).toBe('installation:1');
      expect(await current.execute('child-inline')).toBe('child:1');
      expect(await current.execute('child-file')).toBe('file');
    }
    const committed = f.runtime.snapshot;
    await f.provider('reject.ts', defineFeatureProvider({ ...commandFeature, authoring: {
      ...commandFeature.authoring,
      validate(value, context) {
        if (context.localName === 'host-status') throw new Error('Host definition rejected by new provider');
        return commandFeature.authoring.validate(value, context);
      },
    } }));
    await expect(hmr.enqueue(join(f.directory, 'packages/command/package.json'))).rejects.toThrow('Host definition rejected');
    expect(f.runtime.snapshot).toBe(committed);
    expect(await index(f.runtime).execute('host-status')).toBe('installation:1');
    expect(f.installed()).toBe(1);
    expect(f.childSetups()).toBe(1);
    beforeRefresh.release();
    await waitForImmediate();
    expect(f.disposed).toEqual([]);
  } finally { await hmr.stop(); await f.runtime.stop(); await rm(f.directory, { recursive: true, force: true }); }
  expect(f.disposed).toEqual([1]);
});

function index(runtime: RootRuntime): CommandIndex {
  const commands = runtime.snapshot.projections.get(commandFeatureId);
  if (!(commands instanceof CommandIndex)) throw new Error('Missing command projection');
  return commands;
}
class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  async load<T>(source: string): Promise<T> {
    if (!this.values.has(source)) throw new Error(`Missing fixture module ${source}`);
    return this.values.get(source) as T;
  }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}
async function fixture(rootMounted: boolean) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'zhin-topology-setup-')));
  const modules = new Modules();
  let installed = 0;
  let childSetups = 0;
  const disposed: number[] = [];
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const rootManifest = (mounted: boolean) => write(join(directory, 'package.json'), { name: '@test/root',
    dependencies: { '@test/child': 'workspace:*', '@test/command': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: mounted ? [{ package: '@test/command' }] : [] },
  });
  await rootManifest(rootMounted);
  await write(join(directory, 'plugin.ts'), '');
  modules.values.set(join(directory, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
  await write(join(directory, 'packages/child/package.json'), { name: '@test/child', dependencies: { '@test/command': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/command' }] },
  });
  await write(join(directory, 'packages/child/plugin.ts'), '');
  modules.values.set(join(directory, 'packages/child/plugin.ts'), { default: definePlugin({ name: 'child', setup({ addCommand }) {
    const sequence = ++childSetups;
    addCommand('child-inline', defineCommand({ execute: () => `child:${sequence}` }));
  } }) });
  await write(join(directory, 'packages/child/commands/child-file/index.ts'), '');
  modules.values.set(join(directory, 'packages/child/commands/child-file/index.ts'), { default: defineCommand({ execute: () => 'file' }) });
  const provider = async (entry: string, definition: FeatureProvider) => {
    await write(join(directory, `packages/command/${entry}`), '');
    modules.values.set(join(directory, `packages/command/${entry}`), { default: definition });
    await write(join(directory, 'packages/command/package.json'), { name: '@test/command',
      zhin: { protocol: 1, type: 'feature', entry: `./${entry}` },
    });
  };
  await provider('index.ts', commandFeature);
  const runtime = new RootRuntime({ projectRoot: directory, modules, config: { configVersion: 2, plugins: { child: '@test/child' } },
    environment: { name: 'test', mode: 'test', platform: 'node' }, installResources(context) {
      const sequence = ++installed;
      context.resources.provide(installationToken, { sequence });
      context.lifecycle.add(() => { disposed.push(sequence); });
      if (context.hasFeature?.(commandFeatureId)) context.addFeature(commandFeatureId, 'host-status', defineCommand({ execute: () => `installation:${sequence}` }));
    },
  });
  return { directory, runtime, rootManifest, provider, installed: () => installed, childSetups: () => childSetups, disposed };
}
