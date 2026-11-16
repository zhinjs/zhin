import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  PluginScheduleHost, applyConfigPatches, bindGenerationAdmission, definePlugin, rootPluginId, scheduleHostToken, scheduleRootHostToken,
  type ConfigDocumentPort, type ConfigDocumentSnapshot, type ConfigPatch, type PreparedConfigDocument, type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { createHttpRouter, httpHostToken } from '@zhin.js/host-http';
import scheduleFeature, { defineSchedule } from '../../../schedule-feature/src/index.js';
import { createScheduleHost } from '../../src/instance/schedule-host-installer.js';
import { applyPluginToggle } from '../../src/instance/plugin-apply-channel.js';

/**
 * zhinjs/zhin#1250: a hot disable through the instance's `plugins.apply` handler retires the
 * HTTP routes the plugin registered in `setup` (attached to its lifecycle) and the schedules of
 * its `schedules/` convention directory, with the real HTTP router and process schedule host;
 * a hot enable brings both back.
 */
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('retires and restores a plugin\'s HTTP routes and schedules on hot disable / enable', async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-hot-toggle-resources-')));
  temporary.push(project);
  const modules = new Map<string, unknown>();
  const add = async (relative: string, value: unknown) => {
    const path = join(project, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '');
    modules.set(path, value);
  };
  const json = async (relative: string, value: unknown) => {
    const path = join(project, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value));
  };
  await json('package.json', { name: '@test/root', dependencies: { '@test/game': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [], platformFeatures: false } });
  await json('packages/schedule/package.json', { name: '@test/schedule', zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
  await json('plugins/game/package.json', { name: '@test/game', dependencies: { '@test/schedule': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', platformFeatures: false, features: [{ package: '@test/schedule' }] } });
  await add('plugin.ts', { default: definePlugin({ name: 'root' }) });
  await add('packages/schedule/index.ts', { default: scheduleFeature });
  const disposed: string[] = [];
  await add('plugins/game/plugin.ts', { default: definePlugin({ name: 'game', setup(context) {
    const http = context.resources.use(httpHostToken);
    context.lifecycle.add(http.route('GET', '/game/board', () => new Response('board')));
    context.lifecycle.add(() => { disposed.push('route'); });
  } }) });
  await add('plugins/game/schedules/tick/index.ts', { default: defineSchedule({ cron: '0 * * * * *', description: 'game tick', execute: () => undefined }) });

  const scheduleHost = createScheduleHost();
  const router = createHttpRouter({ builtinRoutes: false });
  const document = new MemoryDocument(join(project, 'zhin.config.json'), { configVersion: 2, plugins: { game: '@test/game' }, game: {} });
  const loader: ModuleRuntime = { async load<T>(source: string): Promise<T> {
    if (!modules.has(source)) throw new Error(`Missing test module ${source}`);
    return modules.get(source) as T;
  }, async close() {} };
  const runtime = new RootRuntime({ projectRoot: project, modules: loader, config: document,
    environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources({ resources, admission }) {
      resources.provide(httpHostToken, bindGenerationAdmission(router, admission));
      resources.provide(scheduleRootHostToken, scheduleHost);
      resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), scheduleHost, admission));
    } });
  // Reading the body ends the request's operation lease on the generation that answered it.
  const board = async () => { const response = await router.handle(new Request('http://127.0.0.1/game/board')); await response.text(); return response.status; };
  const routes = () => router.listRoutes().map(route => `${route.method} ${route.pattern}`);
  try {
    await runtime.start();
    expect(routes()).toEqual(['GET /game/board']);
    expect(await board()).toBe(200);
    expect(scheduleHost.list()).toHaveLength(1);

    document.replace({ ...document.document, disable_plugins: ['game'] });
    await expect(applyPluginToggle(runtime, { instanceKey: 'game', enabled: false, revision: document.revisionId }))
      .resolves.toEqual({ outcome: 'applied', generation: 2 });
    expect(disposed).toEqual(['route']);
    expect(routes()).toEqual([]);
    expect(await board()).toBe(404);
    expect(scheduleHost.list()).toHaveLength(0);

    document.replace({ ...document.document, disable_plugins: [] });
    await expect(applyPluginToggle(runtime, { instanceKey: 'game', enabled: true, revision: document.revisionId }))
      .resolves.toEqual({ outcome: 'applied', generation: 3 });
    expect(routes()).toEqual(['GET /game/board']);
    expect(await board()).toBe(200);
    expect(scheduleHost.list()).toHaveLength(1);
  } finally {
    await runtime.stop();
    await scheduleHost.stop();
  }
});

class MemoryDocument implements ConfigDocumentPort {
  readonly sources: readonly string[];
  document: RuntimeConfigDocument;
  revision = 0;
  constructor(source: string, document: RuntimeConfigDocument) { this.sources = [source]; this.document = structuredClone(document); }
  get revisionId(): string { return String(this.revision); }
  async read(): Promise<ConfigDocumentSnapshot> { return { document: structuredClone(this.document), revision: String(this.revision) }; }
  replace(document: RuntimeConfigDocument): void { this.document = structuredClone(document); this.revision += 1; }
  async prepare(current: ConfigDocumentSnapshot, patches: readonly ConfigPatch[]): Promise<PreparedConfigDocument> {
    const document = applyConfigPatches(current.document, patches);
    return { document, commit: async () => { this.replace(document); return this.read(); }, rollback: async () => undefined };
  }
}
