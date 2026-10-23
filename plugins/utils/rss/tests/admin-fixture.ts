import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { childPluginId, rootPluginId, definePlugin, databaseHostToken, databaseRootHostToken, PluginDatabaseHost,
  scheduleHostToken, scheduleRootHostToken, PluginScheduleHost, outboundHostToken, outboundRootHostToken, PluginOutboundHost,
  pluginTaskProviderToken, type PluginTaskProvider, type PluginTaskSnapshot, type ScheduleHost, type ScheduleJobRegistration,
  type OutboundRootHost } from '../../../../packages/im/plugin-runtime/src/index.js';
import { RootRuntime, type ModuleRuntime } from '../../../../packages/im/runtime/src/index.js';
import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import plugin from '../plugin.js';
import { createAdministratorRssState } from '../src/storage.js';
import remove from '../commands/rss-remove/[url]/index.js';
import list from '../commands/rss-list/index.js';
import { rssRuntimeToken, type RssRuntime } from '../src/runtime.js';
import type { RssConfig } from '../src/feed.js';

export const target = { endpoint: { adapter: 'sandbox', id: 'root/sandbox\0zhin.adapter\0main~123' }, kind: 'channel', id: 'room',
  parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' } as const;

export async function rssFixture(options: { persistence?: boolean; outbound?: boolean; scheduler?: boolean; exactSend?: boolean; rssConfig?: Partial<RssConfig> } = {}) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-admin-rss-')));
  const modules = new Map<string, unknown>();
  const write = async (relative: string, value: unknown, module = false) => {
    const path = join(project, relative); await mkdir(dirname(path), { recursive: true }); await writeFile(path, module ? '' : JSON.stringify(value));
    if (module) modules.set(path, value);
  };
  await write('package.json', { name: '@test/root', dependencies: { '@test/rss': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [], plugins: [] } });
  await write('plugin.ts', { default: definePlugin({ name: 'root' }) }, true);
  await write('plugins/rss/package.json', { name: '@test/rss', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [] } });
  await write('plugins/rss/plugin.ts', { default: plugin }, true);
  await write('plugins/rss/schema.json', JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8')));
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(project, 'state.sqlite') });
  const jobs: ScheduleJobRegistration[] = [], active = new Set<ScheduleJobRegistration>();
  const schedule: ScheduleHost = { register(job) { jobs.push(job); active.add(job); return () => { active.delete(job); }; }, list: () => [...active] };
  const send = vi.fn<NonNullable<OutboundRootHost['sendTarget']>>().mockResolvedValue('platform-id');
  const outbound: OutboundRootHost = { send: vi.fn().mockResolvedValue('chat-id'), ...(options.exactSend === false ? {} : { sendTarget: send }) };
  const loader: ModuleRuntime = { async load<T>(source: string): Promise<T> {
    if (!modules.has(source)) throw new Error(`Missing fixture module ${source}`); return modules.get(source) as T;
  }, async close() {} };
  const makeRuntime = () => new RootRuntime({ projectRoot: project, modules: loader,
    config: { configVersion: 2, plugins: { alpha: '@test/rss', beta: '@test/rss' }, ...(options.rssConfig ? { alpha: options.rssConfig, beta: options.rssConfig } : {}) },
    environment: { name: 'test', mode: 'test', platform: 'node' }, installResources({ resources, admission, handoff }) {
      const db = options.persistence === false ? { ...database, state: undefined } : database;
      resources.provide(databaseRootHostToken, db); resources.provide(databaseHostToken, new PluginDatabaseHost(rootPluginId(), db, admission));
      handoff.add({ activateNext: () => database.start() });
      if (options.scheduler !== false) {
        resources.provide(scheduleRootHostToken, schedule); resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), schedule, admission));
      }
      if (options.outbound !== false) {
        resources.provide(outboundRootHostToken, outbound); resources.provide(outboundHostToken, new PluginOutboundHost(rootPluginId(), outbound, admission));
      }
    } });
  let runtime = makeRuntime();
  const provider = (name = 'alpha') => runtime.snapshot.resources.get(childPluginId(rootPluginId(), name))?.get(pluginTaskProviderToken.id) as PluginTaskProvider | undefined;
  const storage = (name = 'alpha') => runtime.snapshot.resources.get(childPluginId(rootPluginId(), name))!.get(databaseHostToken.id) as PluginDatabaseHost;
  const state = (name = 'alpha') => createAdministratorRssState(storage(name));
  const rss = (name = 'alpha') => runtime.snapshot.resources.get(childPluginId(rootPluginId(), name))!.get(rssRuntimeToken.id) as RssRuntime;
  const tick = (name = 'alpha') => {
    const job = [...active].find(job => job.owner === childPluginId(rootPluginId(), name) && job.id.endsWith('rss/poll_feeds'));
    if (!job) throw new Error('Missing owner RSS poll registration'); return Promise.resolve(job.execute());
  };
  const hmr = async (invalid = false) => {
    const errors: unknown[] = [];
    if (invalid) modules.set(join(project, 'plugins/rss/plugin.ts'), { default: definePlugin({ name: 'rss', setup(context) {
      // Exercise cleanup of the actual staged RSS provider and cron registrations,
      // rather than rejecting before this plugin has created any resources.
      plugin.setup?.(context);
      throw new Error('candidate rejected after RSS setup');
    } }) });
    const coordinator = runtime.createHmrCoordinator({ onError: error => { errors.push(error); }, onRestartRequired: () => { throw new Error('Unexpected restart'); } });
    try { await coordinator.enqueue(join(project, 'plugins/rss/plugin.ts')); }
    catch (error) { if (!invalid) throw error; errors.push(error); }
    finally {
      await coordinator.stop(); modules.set(join(project, 'plugins/rss/plugin.ts'), { default: plugin });
    }
    return errors;
  };
  const chat = async (definition: typeof list | typeof remove, params: Record<string, string> = {}) => definition.execute({
    owner: {} as never, generation: runtime.snapshot.generation, config: {}, args: [], params,
    input: { conversation: { kind: 'group', id: 'chat' }, clientAdapter: 'sandbox', endpointId: 'chat-account', sender: { id: 'alice', name: 'Alice' } },
    use: (token: unknown) => { if (token === rssRuntimeToken) return rss(); throw new Error('unexpected token'); },
  } as never);
  return { project, get runtime() { return runtime; }, database, active, jobs, send, provider, state, storage, rss, tick, hmr, chat,
    async restart() { await runtime.stop(); await database.stop(); runtime = makeRuntime(); await runtime.start(); },
    async close() { await runtime.stop(); await database.stop(); await rm(project, { recursive: true, force: true }); },
  };
}
export async function createTask(provider: PluginTaskProvider, url = 'https://example.test/feed.xml', destination: typeof target | object = target): Promise<PluginTaskSnapshot> {
  return provider.create({ requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target: destination as typeof target, parameters: { url } });
}
export async function changeTask(provider: PluginTaskProvider, action: 'pause' | 'resume' | 'cancel' | 'update', id?: string, url?: string): Promise<PluginTaskSnapshot> {
  const snapshot = await provider.read();
  return provider.change({ requestId: randomUUID(), expectedRevision: snapshot.revision, id: id ?? snapshot.tasks[0]!.id, action,
    ...(url === undefined ? {} : { parameters: { url } }) });
}
