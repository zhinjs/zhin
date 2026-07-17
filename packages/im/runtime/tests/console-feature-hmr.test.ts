import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClientBuildModuleRuntime,
  TypeScriptClientBuilder,
} from '../../../console/pagemanager/src/client-build/index.js';
import { definePlugin, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import layoutFeature, {
  LayoutIndex,
  layoutFeatureId,
} from '@zhin.js/layout';
import pageFeature, {
  PageIndex,
  pageFeatureId,
} from '@zhin.js/page';
import {
  RootRuntime,
  type ModuleRuntime,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Console Feature slot HMR', () => {
  it('atomically replaces Page/Layout artifacts without executing client code or Plugin setup', async () => {
    const project = await createProject();
    const modules = new FakeModules();
    const pluginSource = join(project, 'plugin.ts');
    const pageProvider = join(project, 'packages/page/index.ts');
    const layoutProvider = join(project, 'packages/layout/index.ts');
    const pageSource = join(project, 'pages/status.tsx');
    const navSource = join(project, 'pages/$nav.tsx');
    let setups = 0;
    modules.set(pluginSource, {
      default: definePlugin({ name: 'root', setup() { setups += 1; } }),
    });
    modules.set(pageProvider, { default: pageFeature });
    modules.set(layoutProvider, { default: layoutFeature });
    modules.setClient(pageSource, artifact('/status-v1.js', 'v1', { title: 'Status v1' }));
    modules.setClient(navSource, artifact('/nav-v1.js', 'v1'));
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const first = await runtime.start();

    expect(pageIndex(first).list()[0]).toMatchObject({
      title: 'Status v1',
      module: '/status-v1.js',
      route: '/p-status',
    });
    expect(layoutIndex(first).resolve(first.root, 'nav')?.module).toBe('/nav-v1.js');
    expect(modules.serverLoadCount(pageSource)).toBe(0);
    expect(setups).toBe(1);

    const errors: unknown[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired: () => undefined,
      onError: (error) => { errors.push(error); },
    });
    modules.setClient(pageSource, artifact('/status-v2.js', 'v2', { title: 'Status v2' }));
    await hmr.enqueue(pageSource);
    const second = runtime.snapshot;

    expect(pageIndex(second).list()[0]).toMatchObject({ title: 'Status v2', module: '/status-v2.js' });
    expect(layoutIndex(second).resolve(second.root, 'nav')?.module).toBe('/nav-v1.js');
    expect(modules.clientLoadCount(pageSource)).toBe(2);
    expect(modules.clientLoadCount(navSource)).toBe(1);
    expect(setups).toBe(1);

    modules.setClient(navSource, new Error('Layout compile failed'));
    await expect(hmr.enqueue(navSource)).rejects.toThrow('Layout compile failed');
    expect(runtime.snapshot).toBe(second);
    expect(layoutIndex(runtime.snapshot).resolve(second.root, 'nav')?.module).toBe('/nav-v1.js');
    expect(errors).toHaveLength(1);

    modules.setClient(navSource, artifact('/nav-v2.js', 'v2'));
    await hmr.enqueue(navSource);
    const third = runtime.snapshot;
    expect(layoutIndex(third).resolve(third.root, 'nav')?.module).toBe('/nav-v2.js');
    expect(pageIndex(third).list()[0]?.module).toBe('/status-v2.js');
    expect(modules.loadCount(pluginSource)).toBe(1);
    expect(modules.loadCount(pageProvider)).toBe(1);
    expect(modules.loadCount(layoutProvider)).toBe(1);
    expect(setups).toBe(1);

    await runtime.stop();
  });

  it('uses the TypeScript AST adapter and keeps the old Page on compile failure', async () => {
    const project = await createProject();
    const server = new FakeModules();
    const pluginSource = join(project, 'plugin.ts');
    const pageProvider = join(project, 'packages/page/index.ts');
    const layoutProvider = join(project, 'packages/layout/index.ts');
    const pageSource = join(project, 'pages/status.tsx');
    server.set(pluginSource, { default: definePlugin({ name: 'root' }) });
    server.set(pageProvider, { default: pageFeature });
    server.set(layoutProvider, { default: layoutFeature });
    await writeFile(pageSource, pageModule('Status v1'));
    await writeFile(join(project, 'pages/$nav.tsx'), 'export default function Nav() { return null; }\n');
    const modules = new ClientBuildModuleRuntime(server, new TypeScriptClientBuilder({
      projectRoot: project,
      outDir: join(project, 'dist/client'),
      publicBase: '/assets/client',
    }));
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();
    expect(pageIndex(runtime.snapshot).list()[0]).toMatchObject({ title: 'Status v1' });
    const committed = runtime.snapshot;
    const errors: unknown[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired: () => undefined,
      onError: (error) => { errors.push(error); },
    });

    await writeFile(pageSource, [
      "import { definePage } from '@zhin.js/console-contract';",
      "const title = 'dynamic';",
      'export const meta = definePage({ title });',
      'export default function Status() { return null; }',
    ].join('\n'));
    await expect(hmr.enqueue(pageSource)).rejects.toThrow('static property assignments');
    expect(runtime.snapshot).toBe(committed);

    await writeFile(pageSource, pageModule('Status v2'));
    await hmr.enqueue(pageSource);
    expect(pageIndex(runtime.snapshot).list()[0]).toMatchObject({
      title: 'Status v2',
      module: expect.stringMatching(/^\/assets\/client\//u),
    });
    expect(server.serverLoadCount(pageSource)).toBe(0);
    expect(errors).toHaveLength(1);
    await runtime.stop();
  });
});

function pageModule(title: string): string {
  return [
    "import { definePage } from '@zhin.js/console-contract';",
    `export const meta = definePage({ title: '${title}' });`,
    'export default function Status() { return null; }',
    '',
  ].join('\n');
}

function artifact(module: string, hash: string, metadata?: unknown) {
  return Object.freeze({ module, hash, metadata });
}

function pageIndex(snapshot: RuntimeSnapshot): PageIndex {
  return projection(snapshot, pageFeatureId, PageIndex);
}

function layoutIndex(snapshot: RuntimeSnapshot): LayoutIndex {
  return projection(snapshot, layoutFeatureId, LayoutIndex);
}

function projection<T>(
  snapshot: RuntimeSnapshot,
  id: Parameters<RuntimeSnapshot['projections']['get']>[0],
  constructor: { readonly prototype: T },
): T {
  const value = snapshot.projections.get(id);
  if (!value || typeof value !== 'object'
    || !Object.prototype.isPrototypeOf.call(constructor.prototype, value)) {
    throw new Error(`Missing projection: ${id}`);
  }
  return value as T;
}

class FakeModules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #client = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();
  readonly #clientLoads = new Map<string, number>();

  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  setClient(source: string, value: unknown): void { this.#client.set(source, value); }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Client source executed in Node: ${source}`);
    this.#loads.set(source, (this.#loads.get(source) ?? 0) + 1);
    return this.#modules.get(source) as T;
  }

  async loadClientModule<T>(source: string, _request: ClientModuleRequest): Promise<T> {
    this.#clientLoads.set(source, (this.#clientLoads.get(source) ?? 0) + 1);
    const value = this.#client.get(source);
    if (value instanceof Error) throw value;
    if (!value) throw new Error(`Missing client artifact: ${source}`);
    return value as T;
  }

  loadCount(source: string): number { return this.#loads.get(source) ?? 0; }
  serverLoadCount(source: string): number { return this.#loads.get(source) ?? 0; }
  clientLoadCount(source: string): number { return this.#clientLoads.get(source) ?? 0; }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-console-features-'));
  temporary.push(root);
  const features = ['page', 'layout'];
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: Object.fromEntries(features.map((name) => [`@test/${name}`, 'workspace:*'])),
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: features.map((name) => ({ package: `@test/${name}`, api: '^1.0.0' })),
    },
  });
  for (const name of features) await featurePackage(root, name);
  for (const file of [
    'plugin.ts',
    'packages/page/index.ts',
    'packages/layout/index.ts',
    'pages/status.tsx',
    'pages/$nav.tsx',
  ]) await touch(join(root, file));
  return root;
}

async function featurePackage(root: string, name: string): Promise<void> {
  await writeJson(join(root, `packages/${name}/package.json`), {
    name: `@test/${name}`,
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
