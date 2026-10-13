import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDeliveryTarget, databaseHostToken, databaseRootHostToken, definePlugin, outboundHostToken, outboundRootHostToken, PluginOutboundHost, rootPluginId,
  PluginDatabaseHost, PluginScheduleHost, scheduleHostToken, scheduleRootHostToken,
  type RuntimeSnapshot, type PluginStateStore, type OutboundHost, type DatabaseHost } from '@zhin.js/plugin-runtime';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { createDatabaseHost, installDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { sqliteAvailable } from './sqlite-availability.js';

it('closes captured candidate Host declaration windows when actual Plugin setup fails', async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-state-failed-setup-')));
  const modules = new FixtureModules();
  let database!: PluginDatabaseHost;
  let schedule!: PluginScheduleHost;
  const databasePort: DatabaseHost = {
    dialect: 'test', started: false, define: vi.fn(), tables: () => [], models: { get: () => undefined },
    getRawDatabase: () => undefined, start: async () => undefined, stop: async () => undefined,
  };
  const schedulePort = { register: vi.fn().mockReturnValue(() => undefined), list: () => [] };
  await writeJson(join(project, 'package.json'), { name: '@test/failed-setup',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
  await touch(join(project, 'plugin.ts'));
  modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'failed-setup', setup({ resources }) {
    database = resources.use(databaseHostToken);
    schedule = resources.use(scheduleHostToken);
    database.define('allowed-in-setup', {});
    schedule.register({ id: 'allowed-in-setup', cron: '* * * * * *', execute() {} });
    throw new Error('setup intentionally failed');
  } }) });
  const runtime = new RootRuntime({ projectRoot: project, modules,
    environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources({ resources, admission }) {
      resources.provide(databaseRootHostToken, databasePort);
      resources.provide(databaseHostToken, new PluginDatabaseHost(rootPluginId(), databasePort, admission));
      resources.provide(scheduleRootHostToken, schedulePort);
      resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), schedulePort, admission));
    },
  });
  try {
    await expect(runtime.start()).rejects.toThrow('setup intentionally failed');
    expect(() => database.define('failed-candidate', {})).toThrow('inactive generation');
    expect(() => database.models.get('allowed-in-setup')).toThrow('inactive generation');
    expect(() => schedule.register({ id: 'failed-candidate', cron: '* * * * * *', execute() {} })).toThrow('inactive generation');
    expect(schedulePort.register).toHaveBeenCalledTimes(1);
    expect(databasePort.define).toHaveBeenCalledTimes(1);
  } finally { await runtime.stop(); await rm(project, { recursive: true, force: true }); }
});

const target = createDeliveryTarget({ conversation: { endpoint: { adapter: 'root/icqq', id: 'root/icqq\0adapter\0main' },
  kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' } });

it.skipIf(!sqliteAvailable)('discovers reminder and preferences plugins with owner-bound state across HMR and restart', async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-state-runtime-')));
  const modules = new FixtureModules();
  const sendTarget = vi.fn().mockResolvedValue('reminder-id');
  const scopes = new Map<string, PluginStateStore>();
  const senders = new Map<string, OutboundHost>();
  const databases = new Map<string, PluginDatabaseHost>();
  const schedulers = new Map<string, PluginScheduleHost>();
  await writeJson(join(project, 'package.json'), { name: '@test/root', dependencies: {
    '@test/reminder': 'workspace:*', '@test/preferences': 'workspace:*', '@test/command': 'workspace:*' },
  zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [
    { package: '@test/reminder', instanceKey: 'reminder' }, { package: '@test/preferences', instanceKey: 'preferences' },
  ] } });
  modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
  await touch(join(project, 'plugin.ts'));
  await writeJson(join(project, 'packages/command/package.json'), {
    name: '@test/command', zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
  await touch(join(project, 'packages/command/index.ts'));
  for (const name of ['reminder', 'preferences']) {
    const root = join(project, 'plugins', name);
    await writeJson(join(root, 'package.json'), { name: `@test/${name}`,
      dependencies: { '@test/command': 'workspace:*' }, zhin: {
        protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/command' }],
      } });
    await touch(join(root, 'plugin.ts'));
    await touch(join(root, `commands/${name}/index.ts`));
    modules.set(join(root, 'plugin.ts'), { default: definePlugin({ name,
      setup({ resources }) {
        expect(Reflect.get(resources, 'parent')).toBeUndefined();
        expect(Reflect.ownKeys(resources)).not.toContain('parent');
        expect(resources.has(databaseRootHostToken)).toBe(false);
        expect(resources.has(outboundRootHostToken)).toBe(false);
        expect(() => resources.use(databaseRootHostToken)).toThrow('Missing resource');
        expect(() => resources.use(outboundRootHostToken)).toThrow('Missing resource');
        expect(resources.use(databaseHostToken).owner).toBe(`root/${name}`);
        scopes.set(name, resources.use(databaseHostToken).state);
        senders.set(name, resources.use(outboundHostToken));
        const database = resources.use(databaseHostToken);
        database.define('records', { id: { type: 'integer', primary: true } });
        databases.set(name, database);
        const schedule = resources.use(scheduleHostToken);
        const dispose = schedule.register({ id: 'cleanup', cron: '* * * * * *', execute() {} });
        resources.disposers.add(dispose);
        schedulers.set(name, schedule);
      },
    }) });
  }
  modules.set(join(project, 'plugins/reminder/commands/reminder/index.ts'), { default: defineCommand({
    async execute({ use }) {
      const state = use(databaseHostToken).state.forConversation(target);
      await state.update<number>('count', (current) => (current ?? 0) + 1);
      await state.set('target', target);
      const saved = await state.get('target');
      await use(outboundHostToken).sendTarget!(createDeliveryTarget({ conversation: saved as typeof target }), 'remember');
      return state.get('count');
    },
  }) });
  modules.set(join(project, 'plugins/preferences/commands/preferences/index.ts'), { default: defineCommand({
    async execute({ use }) {
      const store = use(databaseHostToken).state;
      // Same logical key as reminder; owner and user scope must remain isolated.
      const personalTarget = createDeliveryTarget({ conversation: { endpoint: target.endpoint, kind: 'private', id: 'alice' } });
      const state = store.forUser(personalTarget.endpoint, 'alice');
      const count = await state.update<number>('count', (current) => (current ?? 0) + 1);
      await state.set('target', personalTarget);
      const saved = await state.get<typeof personalTarget>('target');
      if (saved) await use(outboundHostToken).sendTarget!(saved, [{ type: 'text', data: { text: 'Preferences saved' } }]);
      return count;
    },
  }) });
  const config = { dialect: 'sqlite', filename: join(project, 'state.sqlite') } as const;
  let database = createDatabaseHost(config);
  const createRuntime = () => new RootRuntime({ projectRoot: project, modules,
    environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources(context) {
      installDatabaseHost(database)(context);
      const host = { send: vi.fn(), sendTarget };
      context.resources.provide(outboundRootHostToken, host);
      context.resources.provide(outboundHostToken, new PluginOutboundHost(rootPluginId(), host, context.admission));
      const scheduler = { register: vi.fn().mockReturnValue(() => undefined), list: () => [] };
      context.resources.provide(scheduleRootHostToken, scheduler);
      context.resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), scheduler, context.admission));
    },
  });
  let runtime = createRuntime();
  try {
    await runtime.start();
    for (const resources of runtime.snapshot.resources.values()) {
      expect(resources.has(databaseRootHostToken.id)).toBe(false);
      expect(resources.has(outboundRootHostToken.id)).toBe(false);
    }
    expect(await commands(runtime.snapshot).execute('reminder')).toBe(1);
    expect(await commands(runtime.snapshot).execute('preferences')).toBe(1);
    expect(await commands(runtime.snapshot).execute('preferences')).toBe(2);
    const previousStore = scopes.get('reminder')!.forConversation(target);
    const retainedSibling = scopes.get('preferences')!.forUser(target.endpoint, 'alice');
    const previousSender = senders.get('reminder')!;
    const previousDatabase = databases.get('reminder')!;
    const previousModel = previousDatabase.models.get('records')!;
    const previousQuery = previousModel.select('id');
    const siblingModel = databases.get('preferences')!.models.get('records')!;
    const previousSchedule = schedulers.get('reminder')!;
    await previousModel.insert({ id: 1 });
    // An already-started read holds the old generation lease while HMR publishes.
    const port = database.state!;
    const originalRead = port.read.bind(port);
    let entered!: () => void;
    let finishRead!: () => void;
    const readEntered = new Promise<void>((resolve) => { entered = resolve; });
    const continueRead = new Promise<void>((resolve) => { finishRead = resolve; });
    const read = vi.spyOn(port, 'read').mockImplementationOnce(async (...args) => {
      entered();
      await continueRead;
      return originalRead(...args);
    });
    const inFlight = previousStore.get('count');
    await readEntered;
    try {
      const hmr = runtime.createHmrCoordinator({ onRestartRequired() {}, onError() {} });
      await hmr.enqueue(join(project, 'plugins/reminder/plugin.ts'));
    } finally {
      finishRead();
      read.mockRestore();
    }
    expect(await inFlight).toBe(1);
    await expect(previousStore.get('count')).rejects.toThrow('inactive generation');
    await expect(previousStore.update('count', () => 999)).rejects.toThrow('inactive generation');
    await expect(previousSender.sendTarget!(target, 'stale reminder')).rejects.toThrow('inactive generation');
    await expect(previousModel.insert({ id: 2 })).rejects.toThrow('inactive generation');
    await expect(Promise.resolve(previousQuery)).rejects.toThrow('inactive generation');
    expect(() => previousDatabase.define('stale-table', {})).toThrow('inactive generation');
    expect(() => previousDatabase.tables()).toThrow('inactive generation');
    expect(() => previousSchedule.register({ id: 'stale-job', cron: '* * * * * *', execute() {} })).toThrow('inactive generation');
    await expect(siblingModel.count!()).resolves.toBe(0);
    expect(await retainedSibling.get('count')).toBe(2);
    expect(await commands(runtime.snapshot).execute('reminder')).toBe(2);
    expect(sendTarget).toHaveBeenCalledWith(target, 'remember', 'root/reminder');
    expect(sendTarget).toHaveBeenCalledWith({ endpoint: target.endpoint, kind: 'private', id: 'alice' },
      [{ type: 'text', data: { text: 'Preferences saved' } }], 'root/preferences');
    expect(new Set(sendTarget.mock.calls.map((call) => call[2]))).toEqual(new Set(['root/reminder', 'root/preferences']));
    await runtime.stop();
    await database.stop();
    database = createDatabaseHost(config);
    runtime = createRuntime();
    await runtime.start();
    expect(await commands(runtime.snapshot).execute('reminder')).toBe(3);
    expect(await commands(runtime.snapshot).execute('preferences')).toBe(3);
  } finally {
    await runtime.stop();
    await database.stop();
    await rm(project, { recursive: true, force: true });
  }
});

function commands(snapshot: RuntimeSnapshot): CommandIndex {
  const index = snapshot.projections.get(commandFeatureId);
  if (!(index instanceof CommandIndex)) throw new Error('Missing discovered command projection');
  return index;
}

class FixtureModules implements ModuleRuntime {
  readonly modules = new Map<string, unknown>();
  set(source: string, value: unknown): void { this.modules.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.modules.has(source)) throw new Error(`Missing module ${source}`);
    return this.modules.get(source) as T;
  }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
