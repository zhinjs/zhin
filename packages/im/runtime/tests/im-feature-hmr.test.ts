import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import adapterFeature, {
  AdapterIndex,
  adapterFeatureId,
  defineAdapter,
} from '@zhin.js/adapter';
import commandFeature, {
  CommandIndex,
  commandFeatureId,
  defineCommand,
} from '@zhin.js/command';
import componentFeature, {
  ComponentIndex,
  componentFeatureId,
  defineComponent,
} from '@zhin.js/component';
import middlewareFeature, {
  MiddlewareIndex,
  defineMiddleware,
  middlewareFeatureId,
} from '@zhin.js/middleware';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('IM Feature slot HMR', () => {
  it('replaces only the changed Feature projection and keeps Adapter endpoints running', async () => {
    const project = await createProject();
    const modules = new FakeModules();
    const pluginSource = join(project, 'plugin.ts');
    const adapterProvider = join(project, 'packages/adapter/index.ts');
    const commandProvider = join(project, 'packages/command/index.ts');
    const middlewareProvider = join(project, 'packages/middleware/index.ts');
    const componentProvider = join(project, 'packages/component/index.ts');
    const adapterSource = join(project, 'adapters/test.ts');
    const commandSource = join(project, 'commands/ping.ts');
    const middlewareSource = join(project, 'middlewares/trace.ts');
    const componentSource = join(project, 'components/status.tsx');
    let setups = 0;
    const endpoints = { creates: 0, starts: 0, opens: 0, closes: 0, stops: 0 };
    modules.set(pluginSource, {
      default: definePlugin({ name: 'root', setup() { setups += 1; } }),
    });
    modules.set(adapterProvider, { default: adapterFeature });
    modules.set(commandProvider, { default: commandFeature });
    modules.set(middlewareProvider, { default: middlewareFeature });
    modules.set(componentProvider, { default: componentFeature });
    modules.set(adapterSource, { default: testAdapter(endpoints) });
    modules.set(commandSource, { default: pingCommand('v1') });
    modules.set(middlewareSource, { default: traceMiddleware('v1') });
    modules.set(componentSource, { default: statusComponent('v1') });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const first = await runtime.start();

    await expect(runPing(first)).resolves.toBe('ping:v1');
    await expect(renderStatus(first)).resolves.toBe('status:v1:1');
    await expect(runTrace(first)).resolves.toEqual(['v1:enter', 'terminal', 'v1:exit']);
    expect(endpoints).toEqual({ creates: 1, starts: 1, opens: 1, closes: 0, stops: 0 });
    expect(setups).toBe(1);

    const hmr = runtime.createHmrCoordinator({
      onRestartRequired: () => undefined,
      onError: (error) => { throw error; },
    });
    modules.set(commandSource, { default: pingCommand('v2') });
    await hmr.enqueue(commandSource);
    const second = runtime.snapshot;

    expect(second.generation).toBe(2);
    await expect(runPing(second)).resolves.toBe('ping:v2');
    expect(second.projections.get(adapterFeatureId)).toBe(first.projections.get(adapterFeatureId));
    expect(second.projections.get(componentFeatureId)).toBe(first.projections.get(componentFeatureId));
    expect(second.projections.get(middlewareFeatureId)).toBe(first.projections.get(middlewareFeatureId));
    expect(endpoints).toEqual({ creates: 1, starts: 1, opens: 1, closes: 0, stops: 0 });
    expect(modules.loadCount(commandSource)).toBe(2);
    expect(modules.loadCount(adapterSource)).toBe(1);
    expect(setups).toBe(1);

    modules.set(middlewareSource, { default: traceMiddleware('v2') });
    await hmr.enqueue(middlewareSource);
    const third = runtime.snapshot;

    expect(third.generation).toBe(3);
    await expect(runTrace(third)).resolves.toEqual(['v2:enter', 'terminal', 'v2:exit']);
    await expect(renderStatus(third)).resolves.toBe('status:v1:1');
    expect(third.projections.get(adapterFeatureId)).toBe(first.projections.get(adapterFeatureId));
    expect(endpoints).toEqual({ creates: 1, starts: 1, opens: 1, closes: 0, stops: 0 });
    expect(modules.loadCount(middlewareSource)).toBe(2);
    expect(modules.loadCount(componentSource)).toBe(1);
    expect(modules.loadCount(middlewareProvider)).toBe(1);
    expect(modules.loadCount(componentProvider)).toBe(1);
    expect(setups).toBe(1);

    modules.set(componentSource, { default: statusComponent('v2') });
    await hmr.enqueue(componentSource);
    const fourth = runtime.snapshot;

    expect(fourth.generation).toBe(4);
    await expect(renderStatus(fourth)).resolves.toBe('status:v2:4');
    await expect(runTrace(fourth)).resolves.toEqual(['v2:enter', 'terminal', 'v2:exit']);
    expect(fourth.projections.get(adapterFeatureId)).toBe(first.projections.get(adapterFeatureId));
    expect(endpoints).toEqual({ creates: 1, starts: 1, opens: 1, closes: 0, stops: 0 });
    expect(modules.loadCount(componentSource)).toBe(2);
    expect(modules.loadCount(middlewareSource)).toBe(2);
    expect(setups).toBe(1);
    await runtime.stop();
    expect(endpoints.stops).toBe(1);
  });
});

function testAdapter(counters: {
  creates: number;
  starts: number;
  opens: number;
  closes: number;
  stops: number;
}) {
  return defineAdapter({
    capabilities: ['inbound'],
    create() {
      counters.creates += 1;
      return {
        start() { counters.starts += 1; },
        open() { counters.opens += 1; },
        close() { counters.closes += 1; },
        stop() { counters.stops += 1; },
      };
    },
  });
}

function pingCommand(version: string) {
  return defineCommand({
    execute: () => `ping:${version}`,
  });
}

function traceMiddleware(version: string) {
  return defineMiddleware<string[]>({
    async handle({ input }, next) {
      input.push(`${version}:enter`);
      await next();
      input.push(`${version}:exit`);
    },
  });
}

function runPing(snapshot: RuntimeSnapshot): Promise<unknown> {
  const index = snapshot.projections.get(commandFeatureId);
  if (!(index instanceof CommandIndex)) throw new Error('Missing Command projection');
  return index.execute('ping');
}

function statusComponent(version: string) {
  return defineComponent({
    render: (_props, context) => `status:${version}:${context.generation}`,
  });
}

async function runTrace(snapshot: RuntimeSnapshot): Promise<readonly string[]> {
  const index = snapshot.projections.get(middlewareFeatureId);
  if (!(index instanceof MiddlewareIndex)) throw new Error('Missing Middleware projection');
  const events: string[] = [];
  await index.run(events, async () => { events.push('terminal'); });
  return events;
}

function renderStatus(snapshot: RuntimeSnapshot): Promise<unknown> {
  const index = snapshot.projections.get(componentFeatureId);
  if (!(index instanceof ComponentIndex)) throw new Error('Missing Component projection');
  return index.render(rootPluginId(), 'status', {});
}

class FakeModules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    this.#loads.set(source, (this.#loads.get(source) ?? 0) + 1);
    return this.#modules.get(source) as T;
  }
  loadCount(source: string): number { return this.#loads.get(source) ?? 0; }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-im-features-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: {
      '@test/adapter': 'workspace:*',
      '@test/command': 'workspace:*',
      '@test/middleware': 'workspace:*',
      '@test/component': 'workspace:*',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [
        { package: '@test/adapter', api: '^1.0.0' },
        { package: '@test/command', api: '^1.0.0' },
        { package: '@test/middleware', api: '^1.0.0' },
        { package: '@test/component', api: '^1.0.0' },
      ],
    },
  });
  await featurePackage(root, 'adapter', '@test/adapter');
  await featurePackage(root, 'command', '@test/command');
  await featurePackage(root, 'middleware', '@test/middleware');
  await featurePackage(root, 'component', '@test/component');
  for (const file of [
    'plugin.ts',
    'packages/adapter/index.ts',
    'packages/command/index.ts',
    'packages/middleware/index.ts',
    'packages/component/index.ts',
    'adapters/test.ts',
    'commands/ping.ts',
    'middlewares/trace.ts',
    'components/status.tsx',
  ]) await touch(join(root, file));
  return realpath(root);
}

async function featurePackage(root: string, directory: string, name: string): Promise<void> {
  await writeJson(join(root, `packages/${directory}/package.json`), {
    name,
    zhin: {
      protocol: 1,
      type: 'feature',
      entry: './index.ts',
      featureApi: '1.0.0',
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
