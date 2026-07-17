import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
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
  it('replaces Middleware and Component slots independently without Plugin setup', async () => {
    const project = await createProject();
    const modules = new FakeModules();
    const pluginSource = join(project, 'plugin.ts');
    const middlewareProvider = join(project, 'packages/middleware/index.ts');
    const componentProvider = join(project, 'packages/component/index.ts');
    const middlewareSource = join(project, 'middlewares/trace.ts');
    const componentSource = join(project, 'components/status.tsx');
    let setups = 0;
    modules.set(pluginSource, {
      default: definePlugin({ name: 'root', setup() { setups += 1; } }),
    });
    modules.set(middlewareProvider, { default: middlewareFeature });
    modules.set(componentProvider, { default: componentFeature });
    modules.set(middlewareSource, { default: traceMiddleware('v1') });
    modules.set(componentSource, { default: statusComponent('v1') });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const first = await runtime.start();

    await expect(renderStatus(first)).resolves.toBe('status:v1:1');
    await expect(runTrace(first)).resolves.toEqual(['v1:enter', 'terminal', 'v1:exit']);
    expect(setups).toBe(1);

    const hmr = runtime.createHmrCoordinator({
      onRestartRequired: () => undefined,
      onError: (error) => { throw error; },
    });
    modules.set(middlewareSource, { default: traceMiddleware('v2') });
    await hmr.enqueue(middlewareSource);
    const second = runtime.snapshot;

    expect(second.generation).toBe(2);
    await expect(runTrace(second)).resolves.toEqual(['v2:enter', 'terminal', 'v2:exit']);
    await expect(renderStatus(second)).resolves.toBe('status:v1:2');
    expect(modules.loadCount(middlewareSource)).toBe(2);
    expect(modules.loadCount(componentSource)).toBe(1);
    expect(modules.loadCount(middlewareProvider)).toBe(1);
    expect(modules.loadCount(componentProvider)).toBe(1);
    expect(setups).toBe(1);

    modules.set(componentSource, { default: statusComponent('v2') });
    await hmr.enqueue(componentSource);
    const third = runtime.snapshot;

    expect(third.generation).toBe(3);
    await expect(renderStatus(third)).resolves.toBe('status:v2:3');
    await expect(runTrace(third)).resolves.toEqual(['v2:enter', 'terminal', 'v2:exit']);
    expect(modules.loadCount(componentSource)).toBe(2);
    expect(modules.loadCount(middlewareSource)).toBe(2);
    expect(setups).toBe(1);
    await runtime.stop();
  });
});

function traceMiddleware(version: string) {
  return defineMiddleware<string[]>({
    async handle({ input }, next) {
      input.push(`${version}:enter`);
      await next();
      input.push(`${version}:exit`);
    },
  });
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
      '@test/middleware': 'workspace:*',
      '@test/component': 'workspace:*',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [
        { package: '@test/middleware', api: '^1.0.0' },
        { package: '@test/component', api: '^1.0.0' },
      ],
    },
  });
  await featurePackage(root, 'middleware', '@test/middleware');
  await featurePackage(root, 'component', '@test/component');
  for (const file of [
    'plugin.ts',
    'packages/middleware/index.ts',
    'packages/component/index.ts',
    'middlewares/trace.ts',
    'components/status.tsx',
  ]) await touch(join(root, file));
  return root;
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
