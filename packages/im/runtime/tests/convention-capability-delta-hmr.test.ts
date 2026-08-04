import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import adapterFeature, { adapterFeatureId } from '@zhin.js/adapter';
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

describe('Convention Capability delta HMR', () => {
  it('adds an unowned Command without rerunning Plugin setup or Adapter projection', async () => {
    const fixture = await createRuntime(['existing']);
    const source = join(fixture.root, 'commands/added.ts');
    await touch(source);
    fixture.modules.set(source, { default: command('added') });

    await fixture.hmr.enqueue(source);

    expect(fixture.runtime.snapshot.generation).toBe(2);
    await expect(commands(fixture.runtime.snapshot).execute('added')).resolves.toBe('added');
    expect(fixture.setups()).toBe(1);
    expect(fixture.runtime.snapshot.projections.get(adapterFeatureId)).toBe(fixture.adapter);
    await fixture.runtime.stop();
  });

  it('removes a deleted Command Slot without rerunning Plugin setup or Adapter projection', async () => {
    const fixture = await createRuntime(['remove']);
    const source = join(fixture.root, 'commands/remove.ts');
    await rm(source);
    fixture.modules.delete(source);

    await fixture.hmr.enqueue(source);

    expect(fixture.runtime.snapshot.generation).toBe(2);
    expect(commands(fixture.runtime.snapshot).has('remove')).toBe(false);
    expect(fixture.setups()).toBe(1);
    expect(fixture.runtime.snapshot.projections.get(adapterFeatureId)).toBe(fixture.adapter);
    await fixture.runtime.stop();
  });

  it('moves a Command from its old Slot ID to a newly discovered Slot ID', async () => {
    const fixture = await createRuntime(['old']);
    const oldSource = join(fixture.root, 'commands/old.ts');
    const nextSource = join(fixture.root, 'commands/new.ts');
    await rm(oldSource);
    await touch(nextSource);
    fixture.modules.delete(oldSource);
    fixture.modules.set(nextSource, { default: command('new') });

    // Filesystem rename notifications may report only the removed path. The
    // convention delta therefore has to discover `new.ts` from `old.ts`.
    await fixture.hmr.enqueue(oldSource);

    expect(fixture.runtime.snapshot.generation).toBe(2);
    expect(commands(fixture.runtime.snapshot).has('old')).toBe(false);
    await expect(commands(fixture.runtime.snapshot).execute('new')).resolves.toBe('new');
    expect(fixture.setups()).toBe(1);
    expect(fixture.runtime.snapshot.projections.get(adapterFeatureId)).toBe(fixture.adapter);
    await fixture.runtime.stop();
  });
});

function command(value: string) {
  return defineCommand({ execute: () => value });
}

function commands(snapshot: RuntimeSnapshot): CommandIndex {
  const index = snapshot.projections.get(commandFeatureId);
  if (!(index instanceof CommandIndex)) throw new Error('Missing Command projection');
  return index;
}

async function createRuntime(names: readonly string[]) {
  const root = await createProject(names);
  const modules = new FakeModules();
  let setupCalls = 0;
  modules.set(join(root, 'plugin.ts'), {
    default: definePlugin({
      name: 'root',
      setup() { setupCalls += 1; },
    }),
  });
  modules.set(join(root, 'packages/command/index.ts'), { default: commandFeature });
  modules.set(join(root, 'packages/adapter/index.ts'), { default: adapterFeature });
  for (const name of names) {
    modules.set(join(root, `commands/${name}.ts`), { default: command(name) });
  }
  const runtime = new RootRuntime({
    projectRoot: root,
    modules,
    environment: { name: 'test', mode: 'test', platform: 'node' },
  });
  await runtime.start();
  const adapter = runtime.snapshot.projections.get(adapterFeatureId);
  if (!adapter) throw new Error('Missing Adapter projection');
  const hmr = runtime.createHmrCoordinator({
    onRestartRequired(plan) { throw new Error(plan.reasons.join(', ')); },
    onError(error) { throw error; },
  });
  return { root, modules, runtime, hmr, adapter, setups: () => setupCalls };
}

class FakeModules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  delete(source: string): void {
    this.#modules.delete(source);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }

  affectedSources(source: string): readonly string[] {
    return [source];
  }

  invalidate(): void {}

  async close(): Promise<void> {}
}

async function createProject(names: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-convention-delta-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: {
      '@test/adapter': 'workspace:*',
      '@test/command': 'workspace:*',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [{ package: '@test/adapter' }, { package: '@test/command' }],
    },
  });
  await writeJson(join(root, 'packages/adapter/package.json'), {
    name: '@test/adapter',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@test/command',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  await Promise.all([
    touch(join(root, 'plugin.ts')),
    touch(join(root, 'packages/adapter/index.ts')),
    touch(join(root, 'packages/command/index.ts')),
    ...names.map((name) => touch(join(root, `commands/${name}.ts`))),
  ]);
  return realpath(root);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
