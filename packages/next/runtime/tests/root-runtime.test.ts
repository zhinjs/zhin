import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createToken, definePlugin, type RuntimeSnapshot } from '@zhin.js/next-kernel';
import commandFeature, {
  CommandIndex,
  commandFeatureId,
  defineCommand,
} from '@zhin.js/next-feature-command';
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
    const oldLease = runtime.controller.snapshots.acquire();

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
    await runtime.stop();
    expect(resourceDisposals).toBe(1);
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
    this.closed = true;
  }
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-runtime-'));
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
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
