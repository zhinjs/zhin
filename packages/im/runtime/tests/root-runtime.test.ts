import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createToken, definePlugin, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import commandFeature, {
  CommandIndex,
  commandFeatureId,
  defineCommand,
} from '@zhin.js/command';
import { RootRuntime, runtimeEnvironmentToken, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('RootRuntime tracer bullet', () => {
  it('loads a static graph, executes a discovered Command, and isolates HMR leases', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const greeting = createToken<string>('test.greeting');
    const pluginSource = join(project, 'plugin.ts');
    const featureSource = join(project, 'packages/command/index.ts');
    const commandSource = join(project, 'commands/gh/issue/list.ts');
    let setupCalls = 0;
    let resourceDisposals = 0;
    modules.set(pluginSource, {
      default: definePlugin({
        name: 'root',
        requires: [greeting, runtimeEnvironmentToken],
        setup() {
          setupCalls += 1;
        },
      }),
    });
    modules.set(featureSource, {
      default: commandFeature,
    });
    modules.set(commandSource, {
      default: defineCommand({
        execute: ({ use }) => `${use(greeting)} ${use(runtimeEnvironmentToken).mode} v1`,
      }),
    });

    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources }) {
        resources.provide(greeting, 'hello', () => {
          resourceDisposals += 1;
        });
      },
    });
    const first = await runtime.start();
    expect('controller' in runtime).toBe(false);
    expect('commit' in runtime.snapshots).toBe(false);
    const oldLease = runtime.snapshots.acquire();

    await expect(commandIndex(first).execute('gh issue list')).resolves.toBe('hello test v1');
    expect(setupCalls).toBe(1);
    expect(runtime.sourceOwnership.recordsFor(commandSource)).toEqual([
      expect.objectContaining({ role: 'capability', owner: 'root' }),
    ]);
    modules.set(commandSource, {
      default: defineCommand({
        execute: ({ use }) => `${use(greeting)} ${use(runtimeEnvironmentToken).mode} v2`,
      }),
    });
    const errors: unknown[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired: () => undefined,
      onError: (error) => {
        errors.push(error);
      },
    });
    await hmr.enqueue(commandSource);
    const second = runtime.snapshot;

    expect(second.generation).toBe(2);
    expect(modules.invalidated).toEqual([commandSource]);
    expect(modules.loadCount(pluginSource)).toBe(1);
    expect(modules.loadCount(featureSource)).toBe(1);
    expect(modules.loadCount(commandSource)).toBe(2);
    expect(setupCalls).toBe(1);
    expect(resourceDisposals).toBe(0);
    expect(errors).toEqual([]);
    await expect(commandIndex(second).execute('gh issue list')).resolves.toBe('hello test v2');
    await expect(commandIndex(oldLease.value).execute('gh issue list')).resolves.toBe(
      'hello test v1',
    );

    modules.set(commandSource, { default: { execute: 'invalid' } });
    await expect(hmr.enqueue(commandSource)).rejects.toBeInstanceOf(TypeError);
    expect(runtime.snapshot).toBe(second);
    expect(runtime.snapshot.generation).toBe(2);
    expect(setupCalls).toBe(1);
    expect(resourceDisposals).toBe(0);
    expect(errors).toHaveLength(1);

    await rm(commandSource);
    await hmr.enqueue(commandSource);
    expect(runtime.snapshot.generation).toBe(3);
    expect(commandIndex(runtime.snapshot).has('gh issue list')).toBe(false);
    expect(setupCalls).toBe(1);
    expect(resourceDisposals).toBe(0);

    oldLease.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(resourceDisposals).toBe(0);
    const stopping = runtime.stop();
    expect(runtime.stop()).toBe(stopping);
    await stopping;
    expect(resourceDisposals).toBe(1);
    expect(modules.closed).toBe(true);
    expect(modules.closeCalls).toBe(1);
  });

  it('replays the same failed stop outcome without closing modules twice', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root' }),
    });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list.ts'), {
      default: defineCommand({ execute: () => 'ok' }),
    });
    modules.closeError = new Error('module close failed');
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();

    const first = runtime.stop();
    expect(runtime.stop()).toBe(first);
    await expect(first).rejects.toThrow('module close failed');
    await expect(runtime.stop()).rejects.toThrow('module close failed');
    expect(modules.closeCalls).toBe(1);
  });

  it('aborts candidate Plugin setup before waiting for Root Stop', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    let entered!: () => void;
    const setupEntered = new Promise<void>((resolve) => { entered = resolve; });
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({
        name: 'root',
        setup({ signal }) {
          entered();
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      }),
    });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list.ts'), {
      default: defineCommand({ execute: () => 'ok' }),
    });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });

    const starting = runtime.start();
    await setupEntered;
    const stopping = runtime.stop();
    await expect(starting).rejects.toThrow('stopping');
    await expect(stopping).resolves.toBeUndefined();
    expect(modules.closed).toBe(true);
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
  readonly invalidated: string[] = [];
  closed = false;
  closeCalls = 0;
  closeError?: Error;

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

  invalidate(source: string): void {
    this.invalidated.push(source);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.closed = true;
    if (this.closeError) throw this.closeError;
  }
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-runtime-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/command': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [{ package: '@test/command' }],
    },
  });
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@test/command',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  await touch(join(root, 'plugin.ts'));
  await touch(join(root, 'packages/command/index.ts'));
  await touch(join(root, 'commands/gh/issue/list.ts'));
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
