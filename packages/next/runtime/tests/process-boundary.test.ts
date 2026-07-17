import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin } from '@zhin.js/next-kernel';
import commandFeature from '@zhin.js/next-feature-command';
import {
  PackageCompatibilityError,
  RootProcessRestartExecutor,
  RootRuntime,
  type ModuleRuntime,
  type ProcessInvalidationPlan,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Root/process boundary', () => {
  it('escalates Root runtime contract changes without publishing a generation', async () => {
    const project = await createProject();
    const modules = new FakeModules();
    const pluginSource = join(project, 'plugin.ts');
    modules.set(pluginSource, { default: definePlugin({ name: 'root' }) });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const started = await runtime.start();
    const restarts: ProcessInvalidationPlan[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired(plan) { restarts.push(plan); },
      onError() {},
    });

    await writeRootManifest(project, { runtime: 'isolated' });
    await hmr.enqueue(join(project, 'package.json'));

    expect(runtime.snapshot).toBe(started);
    expect(runtime.snapshot.generation).toBe(1);
    expect(restarts).toEqual([expect.objectContaining({
      kind: 'process',
      reasons: ['Plugin execution runtime changed: @test/root'],
    })]);
    await runtime.stop();
  });

  it('escalates mounted package export-map changes as runtime ABI changes', async () => {
    const project = await createProject();
    const modules = new FakeModules();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root' }),
    });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();
    const restarts: ProcessInvalidationPlan[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired(plan) { restarts.push(plan); },
      onError() {},
    });

    await writeRootManifest(project, {
      runtime: 'trusted',
      exports: { '.': './plugin.ts' },
    });
    await hmr.enqueue(join(project, 'package.json'));

    expect(runtime.snapshot.generation).toBe(1);
    expect(restarts[0]?.reasons).toContain('package runtime ABI changed: @test/root');
    await runtime.stop();
  });

  it('escalates a mounted Feature API contract change', async () => {
    const project = await createProject();
    await writeFeatureRootManifest(project, '^1.0.0');
    await writeFeatureManifest(project, '1.0.0');
    await touch(join(project, 'packages/command/index.ts'));
    const modules = new FakeModules();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root' }),
    });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();
    const restarts: ProcessInvalidationPlan[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired(plan) { restarts.push(plan); },
      onError() {},
    });

    await writeFeatureRootManifest(project, '^2.0.0');
    await writeFeatureManifest(project, '2.0.0');
    await Promise.all([
      hmr.enqueue(join(project, 'package.json')),
      hmr.enqueue(join(project, 'packages/command/package.json')),
    ]);

    expect(runtime.snapshot.generation).toBe(1);
    expect(restarts[0]?.reasons).toContain(
      'Feature API contract changed: @test/command',
    );
    await runtime.stop();
  });

  it('rejects an incompatible Feature API candidate before provider import or restart', async () => {
    const project = await createProject();
    await writeFeatureRootManifest(project, '^1.0.0');
    await writeFeatureManifest(project, '1.0.0');
    await touch(join(project, 'packages/command/index.ts'));
    const modules = new FakeModules();
    const providerSource = join(project, 'packages/command/index.ts');
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root' }),
    });
    modules.set(providerSource, { default: commandFeature });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const started = await runtime.start();
    const restarts: ProcessInvalidationPlan[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired(plan) { restarts.push(plan); },
      onError() {},
    });

    await writeFeatureManifest(project, '2.0.0');
    await expect(hmr.enqueue(join(project, 'packages/command/package.json')))
      .rejects.toBeInstanceOf(PackageCompatibilityError);

    expect(runtime.snapshot).toBe(started);
    expect(restarts).toEqual([]);
    expect(modules.loadCount(providerSource)).toBe(1);
    await runtime.stop();
  });

  it('stops one Root exactly once before invoking the Host restart adapter', async () => {
    const events: string[] = [];
    const received: ProcessInvalidationPlan[] = [];
    const executor = new RootProcessRestartExecutor(
      { async stop() { events.push('root:stop'); } },
      {
        async restart(plan) {
          events.push('host:restart');
          received.push(plan);
        },
      },
    );
    const firstPlan = processPlan('first');
    const secondPlan = processPlan('second');

    const first = executor.execute(firstPlan);
    const second = executor.execute(secondPlan);
    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(events).toEqual(['root:stop', 'host:restart']);
    expect(received).toEqual([firstPlan]);
    expect(received[0]).not.toBe(firstPlan);
  });
});

class FakeModules implements ModuleRuntime {
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
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-process-'));
  temporary.push(root);
  await writeRootManifest(root, { runtime: 'trusted' });
  await touch(join(root, 'plugin.ts'));
  return root;
}

async function writeRootManifest(
  root: string,
  options: {
    readonly runtime: 'trusted' | 'isolated';
    readonly exports?: unknown;
  },
): Promise<void> {
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    type: 'module',
    exports: options.exports ?? './plugin.ts',
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      runtime: options.runtime,
    },
  });
}

async function writeFeatureRootManifest(root: string, api: string): Promise<void> {
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    type: 'module',
    dependencies: { '@test/command': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      runtime: 'trusted',
      features: [{ package: '@test/command', api }],
    },
  });
}

async function writeFeatureManifest(root: string, featureApi: string): Promise<void> {
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@test/command',
    type: 'module',
    zhin: {
      protocol: 1,
      type: 'feature',
      entry: './index.ts',
      featureApi,
    },
  });
}

function processPlan(reason: string): ProcessInvalidationPlan {
  return {
    kind: 'process',
    changed: [`/${reason}.json`],
    reasons: [reason],
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
