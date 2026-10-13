import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { childPluginId, rootPluginId, definePlugin, databaseHostToken, databaseRootHostToken, PluginDatabaseHost,
  scheduleHostToken, scheduleRootHostToken, PluginScheduleHost, outboundHostToken, outboundRootHostToken, PluginOutboundHost,
  pluginVerificationToken, type ScheduleHost, type ScheduleJobRegistration, type PluginVerificationHost } from '../../../../packages/im/plugin-runtime/src/index.js';
import commandFeature, { commandFeatureId, CommandIndex } from '../../../../packages/im/command/src/index.js';
import scheduleFeature from '@zhin.js/schedule-feature';
import { RootRuntime, type ModuleRuntime } from '../../../../packages/im/runtime/src/index.js';
import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { sqliteAvailable } from '../../../../basic/cli/tests/plugin-runtime/sqlite-availability.js';
import plugin from '../plugin.js';
import poll from '../schedules/poll/index.js';
import after from '../commands/remind/after/index.js';
import at from '../commands/remind/at/index.js';
import every from '../commands/remind/every/index.js';
import list from '../commands/remind/list/index.js';
import cancel from '../commands/remind/cancel/index.js';
import { reminderServiceToken } from '../src/runtime.js';
import { REMINDER_STATE_KEY, parseReminderInstant, type ReminderBook, type ReminderService } from '../src/service.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';

const target = { endpoint: { adapter: 'sandbox', id: 'main' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' } as const;
const alice: import('../../../../packages/im/command/src/index.js').CommandMessage = { conversation: target, sender: { id: 'alice' }, content: '' };
const temporary: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('persistent reminder through real Runtime discovery', () => {
  it.skipIf(!sqliteAvailable)('isolates two instances/senders/exact conversations and survives HMR plus database restart', async () => {
    const f = await fixture();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start();
      expect(f.active.size).toBe(2);
      const created = await f.command('a remind after 60 hello world');
      expect(created).toContain('UTC');
      expect(await f.command('b remind list')).toContain('没有提醒');
      expect(await f.command('a remind list', { ...alice, sender: { id: 'bob' } })).toContain('没有提醒');
      expect(await f.command('a remind list', { ...alice, conversation: { ...target, threadId: 'other' } })).toContain('没有提醒');
      expect(await f.command('a remind list', { ...alice, conversation: { ...target, endpoint: { ...target.endpoint, id: 'another-bot' } } })).toContain('没有提醒');
      expect(await f.command('a remind list', { ...alice, conversation: { ...target, parent: { ...target.parent, id: 'another-guild' } } })).toContain('没有提醒');
      const task = (await f.service('alpha').list({ senderId: 'alice', target }))[0]!;
      expect(await f.command(`a remind cancel ${task.id}`, { ...alice, sender: { id: 'bob' } })).toContain('未找到');
      const hmr = f.runtime.createHmrCoordinator({ onError: error => { throw error; }, onRestartRequired: () => { throw new Error('Unexpected restart'); } });
      try { await hmr.enqueue(join(f.project, 'plugins/reminder/schedules/poll/index.ts')); } finally { await hmr.stop(); }
      expect(f.active.size).toBe(2);
      expect(() => f.jobs[0]!.execute()).toThrow('inactive generation');
      expect(await f.command('a remind list')).toContain(task.id);
      await f.runtime.stop(); await f.db.stop(); await f.db.start(); await f.restart();
      clock.mockReturnValue(task.nextRunAt + 600_000);
      await Promise.all([...f.active].map(job => job.execute()));
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.send).toHaveBeenCalledWith(target, '⏰ 提醒：hello world', childPluginId(rootPluginId(), 'alpha'));
      await Promise.all([...f.active].map(job => job.execute()));
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(await f.command('a remind list')).toContain('已完成');
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('skips overdue cycles, prevents overlap, stops failed/unknown deliveries and persists pre-send crash disposition', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); await f.command('a remind every 60 periodic');
      clock.mockReturnValue(1_800_000_600_000); await f.jobs[0]!.execute();
      expect(f.send).not.toHaveBeenCalled();
      const actor = { senderId: 'alice', target };
      const periodic = (await f.service('alpha').list(actor))[0]!;
      expect(periodic.nextRunAt).toBeGreaterThan(Date.now());
      let complete!: (value: string) => void;
      f.send.mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; }));
      clock.mockReturnValue(periodic.nextRunAt);
      const inflight = f.jobs[0]!.execute();
      await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
      await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(1);
      expect((await f.service('alpha').list(actor))[0]!.status).toBe('unknown');
      await f.command(`a remind cancel ${periodic.id}`); complete('message-1'); await inflight;
      expect((await f.service('alpha').list(actor))[0]!.status).toBe('cancelled');
      await f.command('a remind after 1 uncertain'); clock.mockReturnValue(Date.now() + 1000);
      f.send.mockRejectedValueOnce(new EndpointDeliveryError('deliveryUnknown', 'unknown', 'unknown'));
      await f.jobs[0]!.execute(); await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(2);
      expect(await f.command('a remind list')).toContain('未确认');
      await f.command('a remind after 1 rejected'); clock.mockReturnValue(Date.now() + 1000);
      f.send.mockRejectedValueOnce(new EndpointDeliveryError('rejected', 'not sent', 'rejected'));
      await f.jobs[0]!.execute(); expect(await f.command('a remind list')).toContain('投递失败');
      // Simulate durable claim followed by process loss before platform send.
      const state = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
      await state.state.update<ReminderBook>(REMINDER_STATE_KEY, book => ({ version: 1, tasks: book!.tasks.map(task => task.status === 'unknown' ? { ...task, claimId: 'crashed' } : task) }));
      await f.runtime.stop(); await f.restart(); await [...f.active][0]!.execute();
      expect(f.send).toHaveBeenCalledTimes(3);
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('rejects bad candidate configuration, advertises side effects without running verification, and explicitly verifies persistence only', async () => {
    const f = await fixture();
    try {
      await f.runtime.start(); const before = f.runtime.snapshot;
      await expect(f.runtime.patchConfig([{ op: 'set', path: ['plugins', 'alpha', 'timezone'], value: 'invalid/timezone' }])).rejects.toThrow('IANA');
      expect(f.runtime.snapshot).toBe(before); expect(f.active.size).toBe(2);
      await expect(f.runtime.patchConfig([{ op: 'set', path: ['plugins', 'alpha', 'maxTasks'], value: 33 }])).rejects.toThrow();
      const host = before.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(pluginVerificationToken.id) as PluginVerificationHost;
      expect(host.checks()[0]!.effects.join()).toContain('不发送'); expect(f.send).not.toHaveBeenCalled();
      const exchange = vi.spyOn(f.db.state!, 'compareExchange');
      expect(await host.run('local-state')).toMatchObject({ status: 'passed' });
      const probe = exchange.mock.calls.find(call => call[2].startsWith('verification/') && call[4] !== undefined)!;
      expect(probe[5]).toBeGreaterThan(Date.now());
      expect(probe[5]).toBeLessThanOrEqual(Date.now() + 60_000);
      expect(exchange.mock.calls.some(call => call[2] === probe[2] && call[4] === undefined)).toBe(true);
      exchange.mockRestore();
      expect(await f.command('a remind list')).toContain('没有提醒'); expect(f.send).not.toHaveBeenCalled();
      expect(await f.command('a remind at 2026-02-30T10:00:00Z invalid')).toMatchObject({ status: 'invalid' });
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('marks a missing receipt unknown, keeps help read-only and explains non-message execution', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start();
      expect(await f.command('a remind after --help')).toContain('seconds');
      expect(await f.command('a remind list')).toContain('没有提醒');
      const index = f.runtime.snapshot.projections.get(commandFeatureId) as CommandIndex;
      expect(await index.execute('a remind list')).toContain('真实会话');
      await f.command('a remind after 1 receipt-missing'); clock.mockReturnValue(Date.now() + 1000);
      f.send.mockResolvedValueOnce(null);
      await f.jobs[0]!.execute(); await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(1);
      expect(await f.command('a remind list')).toContain('未返回确认的消息 ID');
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('never retries a claim persisted immediately before process loss and rejects corrupted state', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); await f.command('a remind after 1 claim-before-send');
      clock.mockReturnValue(Date.now() + 1000);
      const port = f.db.state!;
      const compareExchange = port.compareExchange.bind(port);
      const crash = vi.spyOn(port, 'compareExchange').mockImplementation(async (...args) => {
        const committed = await compareExchange(...args);
        if (committed && args[2] === REMINDER_STATE_KEY && JSON.stringify(args[4]).includes('"status":"unknown"')) f.service('alpha').stop();
        return committed;
      });
      await f.jobs[0]!.execute(); expect(f.send).not.toHaveBeenCalled();
      crash.mockRestore();
      await f.runtime.stop(); await f.db.stop(); await f.db.start(); await f.restart();
      await [...f.active][0]!.execute(); expect(f.send).not.toHaveBeenCalled();
      expect(await f.command('a remind list')).toContain('未确认');
      const state = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
      await state.state.set(REMINDER_STATE_KEY, { version: 1, tasks: [{ status: 'pending', nextRunAt: Date.now() }] });
      await expect([...f.active][0]!.execute()).rejects.toThrow('持久状态格式无效'); expect(f.send).not.toHaveBeenCalled();
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('enforces sender/global quotas and bounded dispatch batches, then evicts completed history', async () => {
    const f = await fixture({ maxTasks: 2, maxTasksPerSender: 1, batchSize: 1 });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start();
      expect(await f.command('a remind after 1 first')).toContain('已创建');
      expect(await f.command('a remind after 1 second')).toContain('上限');
      expect(await f.command('a remind after 1 bob', { ...alice, sender: { id: 'bob' } })).toContain('已创建');
      expect(await f.command('a remind after 1 charlie', { ...alice, sender: { id: 'charlie' } })).toContain('上限');
      clock.mockReturnValue(Date.now() + 1000);
      await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(1);
      await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(2);
      expect(await f.command('a remind after 1 next')).toContain('已创建');
      const state = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
      expect((await state.state.get<ReminderBook>(REMINDER_STATE_KEY))!.tasks).toHaveLength(2);
      expect(await f.command('a remind at 2020-01-01T00:00Z past')).toContain('未来一年');
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('refuses installation without persistent state rather than silently saving in memory', async () => {
    const f = await fixture({}, false);
    try { await expect(f.runtime.start()).rejects.toThrow('configured database'); expect(f.active.size).toBe(0); }
    finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it('requires explicit offset and rejects calendar overflow', () => {
    expect(() => parseReminderInstant('2027-01-01T12:00')).toThrow('ISO');
    expect(() => parseReminderInstant('2027-02-30T12:00Z')).toThrow('无效');
    expect(parseReminderInstant('2027-01-01T12:00+08:00')).toBe(Date.parse('2027-01-01T04:00Z'));
  });
});

async function fixture(settings: Record<string, unknown> = {}, persistence = true) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-reminder-'))); temporary.push(project);
  const modules = new Map<string, unknown>();
  const write = async (relative: string, value: unknown, module = false) => {
    const path = join(project, relative); await mkdir(dirname(path), { recursive: true }); await writeFile(path, module ? '' : JSON.stringify(value)); if (module) modules.set(path, value);
  };
  const features = [{ package: '@test/command' }, { package: '@test/schedule' }];
  await write('package.json', { name: '@test/root', dependencies: { '@test/reminder': '*', '@test/command': '*', '@test/schedule': '*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features, plugins: ['alpha', 'beta'].map(instanceKey => ({ package: '@test/reminder', instanceKey })) } });
  await write('plugin.ts', { default: definePlugin({ name: 'root' }) }, true);
  for (const [name, value] of [['command', commandFeature], ['schedule', scheduleFeature]] as const) {
    await write(`packages/${name}/package.json`, { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
    await write(`packages/${name}/index.ts`, { default: value }, true);
  }
  await write('plugins/reminder/package.json', { name: '@test/reminder', dependencies: { '@test/command': '*', '@test/schedule': '*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features } });
  await write('plugins/reminder/plugin.ts', { default: plugin }, true);
  for (const [name, value] of Object.entries({ after, at, every, list, cancel })) await write(`plugins/reminder/commands/remind/${name}/index.ts`, { default: value }, true);
  await write('plugins/reminder/schedules/poll/index.ts', { default: poll }, true);
  const db = createDatabaseHost({ dialect: 'sqlite', filename: join(project, 'state.sqlite') }); await db.start();
  const jobs: ScheduleJobRegistration[] = []; const active = new Set<ScheduleJobRegistration>();
  const schedule: ScheduleHost = { register(job) { jobs.push(job); active.add(job); return () => { active.delete(job); }; }, list: () => [...active] };
  const send = vi.fn<NonNullable<import('../../../../packages/im/plugin-runtime/src/index.js').OutboundRootHost['sendTarget']>>().mockResolvedValue('message-id');
  const outbound = { send: vi.fn().mockResolvedValue(null), sendTarget: send };
  const loader: ModuleRuntime = { async load<T>(source: string): Promise<T> { if (!modules.has(source)) throw new Error(`Missing fixture module ${source}`); return modules.get(source) as T; }, async close() {} };
  const makeRuntime = () => new RootRuntime({ projectRoot: project, modules: loader, config: { plugins: { alpha: { commandNamespace: 'a', ...settings }, beta: { commandNamespace: 'b' } } }, environment: { name: 'test', mode: 'test', platform: 'node' }, installResources({ resources, admission }) {
    const database = persistence ? db : { ...db, state: undefined };
    resources.provide(databaseRootHostToken, database); resources.provide(databaseHostToken, new PluginDatabaseHost(rootPluginId(), database, admission));
    resources.provide(scheduleRootHostToken, schedule); resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), schedule, admission));
    resources.provide(outboundRootHostToken, outbound); resources.provide(outboundHostToken, new PluginOutboundHost(rootPluginId(), outbound, admission));
  } });
  let runtime = makeRuntime();
  const restart = async () => { runtime = makeRuntime(); await runtime.start(); };
  const command = async (text: string, source = alice): Promise<unknown> => {
    const index = runtime.snapshot.projections.get(commandFeatureId); if (!(index instanceof CommandIndex)) throw new Error('Missing CommandIndex');
    const result = await index.dispatch(text, { ...source, content: text }); return result.status === 'executed' ? result.value : result;
  };
  const service = (name: string): ReminderService => runtime.snapshot.resources.get(childPluginId(rootPluginId(), name))!.get(reminderServiceToken.id) as ReminderService;
  return { project, get runtime() { return runtime; }, restart, db, jobs, active, send, command, service };
}
