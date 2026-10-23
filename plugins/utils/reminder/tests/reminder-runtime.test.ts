import { createReminderState } from '../src/storage.js';
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
import configSchema from '../schema.json' with { type: 'json' };
import poll from '../schedules/poll/index.js';
import after from '../commands/remind/after/index.js';
import at from '../commands/remind/at/index.js';
import every from '../commands/remind/every/index.js';
import list from '../commands/remind/list/index.js';
import cancel from '../commands/remind/cancel/index.js';
import create from '../commands/remind/create/index.js';
import { reminderServiceToken } from '../src/runtime.js';
import { REMINDER_STATE_KEY, parseReminderInstant, type ReminderBook, type ReminderService } from '../src/service.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { randomUUID } from 'node:crypto';
import { pluginTaskProviderToken, type PluginTaskProvider, type PluginTaskSnapshot } from '../../../../packages/im/plugin-runtime/src/index.js';
import { ADMIN_REMINDER_STATE_KEY, type AdminReminderBook } from '../src/admin-tasks.js';

const target = { endpoint: { adapter: 'sandbox', id: 'main' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' } as const;
const alice: import('../../../../packages/im/command/src/index.js').CommandMessage = { conversation: target, sender: { id: 'alice' }, content: '' };
const temporary: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('persistent reminder through real Runtime discovery', () => {
  it.skipIf(!sqliteAvailable)('summarizes long administrator task titles without truncating reminder content', async () => {
    const f = await fixture(); vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha'); const text = '🌟'.repeat(250);
      const snapshot = await provider.create({ requestId: randomUUID(), expectedRevision: (await provider.read()).revision,
        target, parameters: { text, at: new Date(Date.now() + 60_000).toISOString() } });
      expect(snapshot.tasks[0]!.title.length).toBeLessThanOrEqual(200);
      expect(snapshot.tasks[0]!.title).toMatch(/^(?:🌟)+…$/u);
      expect(snapshot.tasks[0]!.parameters.text).toBe(text);
      expect((await provider.read()).tasks[0]!.parameters.text).toBe(text);
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('rotates pools across batch-one ticks while periodic chat reminders remain continuously due', async () => {
    const f = await fixture({ batchSize: 1, maxTasks: 32, missedGraceSeconds: 60 });
    const start = 1_800_000_000_000; const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha');
      for (let i = 0; i < 32; i++) await f.command(`a remind every 60 chat-${i}`, { ...alice, sender: { id: `sender-${Math.floor(i / 8)}` } });
      const created = await provider.create({ requestId: randomUUID(), expectedRevision: (await provider.read()).revision,
        target, parameters: { text: 'administrator-fairness', at: new Date(start + 60_000).toISOString() } });
      for (let tick = 0; tick < 24; tick++) {
        clock.mockReturnValue(start + 60_000 + tick * 5000);
        const before = f.send.mock.calls.length;
        await f.jobs[0]!.execute();
        expect(f.send.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (tick === 1) expect(f.send.mock.calls[1]![1]).toBe('⏰ 提醒：administrator-fairness');
      }
      expect(f.send.mock.calls[0]![1]).toBe('⏰ 提醒：chat-0');
      expect(f.send.mock.calls.filter(call => call[1] === '⏰ 提醒：administrator-fairness')).toHaveLength(1);
      expect((await provider.read()).tasks.find(task => task.id === created.tasks[0]!.id)!.state).toBe('succeeded');
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('keeps administrator tasks separate, reconciles durable receipts and rejects concurrent stale mutations', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha');
      const initial = await provider.read(); expect(initial).toEqual(await provider.read()); expect(initial.revision).toBe('0');
      const requestId = randomUUID(); const parameters = { text: '管理员提醒', at: new Date(Date.now() + 60_000).toISOString() };
      const input = { requestId, expectedRevision: initial.revision, target, parameters };
      const created = await provider.create(input);
      expect(created.tasks[0]).toMatchObject({ id: requestId, ownership: 'administrator', target, state: 'scheduled', timezone: 'UTC' });
      expect(created.receipts).toEqual([{ requestId, taskId: requestId, operation: 'create' }]);
      expect(await provider.create(input)).toEqual(created);
      await expect(provider.create({ ...input, parameters: { ...parameters, text: 'changed' } })).rejects.toMatchObject({ code: 'conflict' });
      expect(await f.command('a remind list')).toContain('没有提醒');
      expect(await f.service('alpha').cancel({ senderId: 'alice', target }, requestId)).toBe(false);
      expect((await provider.read()).tasks[0]!.state).toBe('scheduled');
      await f.command('a remind after 60 聊天提醒');
      expect((await provider.read()).tasks).toHaveLength(1);
      expect((await f.tasks('beta').read()).tasks).toEqual([]);
      const alternate = { ...target, endpoint: { ...target.endpoint, id: 'second-account' }, parent: { ...target.parent, id: 'second-guild' }, threadId: 'second-topic' };
      const attempts = await Promise.allSettled([1, 2].map(i => provider.create({ ...input, target: alternate, requestId: randomUUID(), expectedRevision: created.revision, parameters: { ...parameters, text: `并发-${i}` } })));
      expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
      await expect(provider.create({ ...input, requestId: randomUUID(), expectedRevision: initial.revision })).rejects.toMatchObject({ code: 'conflict' });
      expect(f.send).not.toHaveBeenCalled(); clock.mockReturnValue(Date.now() + 60_000);
      await f.jobs[0]!.execute();
      expect(f.send.mock.calls.some(call => JSON.stringify(call[0]) === JSON.stringify(target))).toBe(true);
      expect(f.send.mock.calls.some(call => JSON.stringify(call[0]) === JSON.stringify(alternate))).toBe(true);
      expect(f.send.mock.calls.every(call => call[2] === childPluginId(rootPluginId(), 'alpha'))).toBe(true);
      expect(f.send.mock.calls.map(call => call[1])).toContain('⏰ 提醒：管理员提醒');
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('requires pause before edits, rejects expired one-shot resume and skips missed periodic rounds', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha');
      let snapshot = await provider.create({ requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target,
        parameters: { text: 'once', at: new Date(Date.now() + 1000).toISOString() } });
      const id = snapshot.tasks[0]!.id;
      await expect(provider.change({ requestId: randomUUID(), expectedRevision: snapshot.revision, id, action: 'update', parameters: { text: 'no', at: new Date(Date.now() + 10_000).toISOString() } })).rejects.toMatchObject({ code: 'invalid_input' });
      snapshot = await mutate(provider, snapshot, id, 'pause'); clock.mockReturnValue(Date.now() + 2000);
      await expect(mutate(provider, snapshot, id, 'resume')).rejects.toThrow('先编辑');
      snapshot = await provider.change({ requestId: randomUUID(), expectedRevision: snapshot.revision, id, action: 'update', parameters: { text: 'edited', at: new Date(Date.now() + 10_000).toISOString() } });
      expect(snapshot.tasks[0]).toMatchObject({ state: 'paused', title: 'edited' });
      snapshot = await mutate(provider, snapshot, id, 'resume');
      const periodicId = randomUUID();
      snapshot = await provider.create({ requestId: periodicId, expectedRevision: snapshot.revision, target,
        parameters: { text: 'periodic', at: new Date(Date.now() + 1000).toISOString(), intervalSeconds: 60 } });
      snapshot = await mutate(provider, snapshot, periodicId, 'pause'); clock.mockReturnValue(Date.now() + 600_000);
      snapshot = await mutate(provider, snapshot, periodicId, 'resume');
      expect(snapshot.tasks.find(task => task.id === periodicId)!.nextRunAt).toBeGreaterThan(Date.now());
      expect(snapshot.tasks.find(task => task.id === periodicId)!.detail).toContain('跳过'); expect(f.send).not.toHaveBeenCalled();
      for (const parameters of [{ text: 'x', at: '2027-01-01T12:00' }, { text: 'x', at: new Date(Date.now() + 1000).toISOString(), intervalSeconds: 59 }, { text: 'x', at: new Date(Date.now() + 1000).toISOString(), extra: true }]) {
        await expect(provider.create({ requestId: randomUUID(), expectedRevision: snapshot.revision, target, parameters })).rejects.toMatchObject({ code: 'invalid_input' });
      }
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('preserves unknown disposition, rejects retry and does not overwrite in-flight cancellation', async () => {
    const f = await fixture(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha');
      await provider.create({ requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target,
        parameters: { text: 'inflight', at: new Date(Date.now() + 1000).toISOString() } });
      let complete!: (value: string) => void;
      f.send.mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; }));
      clock.mockReturnValue(Date.now() + 1000); const inflight = f.jobs[0]!.execute();
      await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
      const snapshot = await provider.read(); expect(snapshot.tasks[0]!.state).toBe('unknown');
      expect(snapshot.tasks[0]!.actions).toEqual(['cancel']);
      expect(snapshot.tasks[0]!.nextRunAt).toBeUndefined();
      await expect(mutate(provider, snapshot, snapshot.tasks[0]!.id, 'resume')).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(mutate(provider, snapshot, snapshot.tasks[0]!.id, 'pause')).rejects.toMatchObject({ code: 'invalid_input' });
      await mutate(provider, snapshot, snapshot.tasks[0]!.id, 'cancel'); complete('delivered'); await inflight;
      expect((await provider.read()).tasks[0]!.state).toBe('cancelled');
      const unknownId = randomUUID(); await provider.create({ requestId: unknownId, expectedRevision: (await provider.read()).revision, target,
        parameters: { text: 'unknown', at: new Date(Date.now() + 1000).toISOString() } });
      f.send.mockResolvedValueOnce(null); clock.mockReturnValue(Date.now() + 1000);
      await f.jobs[0]!.execute(); await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(2);
      expect((await provider.read()).tasks.find(task => task.id === unknownId)!.state).toBe('unknown');
      await f.runtime.stop(); await f.restart(); await [...f.active][0]!.execute(); expect(f.send).toHaveBeenCalledTimes(2);
      await expect(provider.read()).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('keeps administrator revisions and acknowledgements through HMR, restart and history eviction', async () => {
    const f = await fixture({ adminMaxTasks: 1 }); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha'); const initial = await provider.read();
      const requestId = randomUUID(); const parameters = { text: 'restart', at: new Date(Date.now() + 1000).toISOString() };
      let snapshot = await provider.create({ requestId, expectedRevision: initial.revision, target, parameters });
      const hmr = f.runtime.createHmrCoordinator({ onError: error => { throw error; }, onRestartRequired: () => { throw new Error('Unexpected restart'); } });
      try { await hmr.enqueue(join(f.project, 'plugins/reminder/plugin.ts')); } finally { await hmr.stop(); }
      expect(f.active.size).toBe(2); await expect(provider.read()).rejects.toMatchObject({ code: 'unavailable' });
      expect((await f.tasks('alpha').read()).revision).toBe(snapshot.revision);
      await f.runtime.stop(); await f.db.stop(); await f.db.start(); await f.restart();
      expect((await f.tasks('alpha').read()).receipts).toEqual(snapshot.receipts);
      clock.mockReturnValue(Date.now() + 1000); await [...f.active][0]!.execute();
      expect(f.send).toHaveBeenCalledTimes(1);
      const current = f.tasks('alpha'); snapshot = await current.read(); const beforeEviction = snapshot.revision;
      snapshot = await current.create({ requestId: randomUUID(), expectedRevision: snapshot.revision, target: { ...target, threadId: 'another-topic' },
        parameters: { text: 'next', at: new Date(Date.now() + 60_000).toISOString() } });
      expect(snapshot.tasks).toHaveLength(1); expect(snapshot.tasks[0]!.id).not.toBe(requestId);
      await expect(current.create({ requestId: randomUUID(), expectedRevision: initial.revision, target, parameters: { text: 'stale', at: new Date(Date.now() + 60_000).toISOString() } })).rejects.toMatchObject({ code: 'conflict' });
      expect((await current.create({ requestId, expectedRevision: initial.revision, target, parameters })).revision).toBe(snapshot.revision);
      const pause = { requestId: randomUUID(), expectedRevision: snapshot.revision, id: snapshot.tasks[0]!.id, action: 'pause' as const };
      const paused = await current.change(pause); expect(await current.change(pause)).toEqual(paused);
      await expect(current.change({ ...pause, action: 'cancel' })).rejects.toMatchObject({ code: 'conflict' });
      expect(paused.revision).not.toBe(beforeEviction);
      expect(await f.command('a remind list')).toContain('没有提醒');
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('persists a conservative administrator claim before process loss and shares the existing batch quota', async () => {
    const f = await fixture({ batchSize: 1, adminMaxTasks: 1 }); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha');
      const input = { requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target, parameters: { text: 'admin', at: new Date(Date.now() + 1000).toISOString() } };
      const created = await provider.create(input);
      await expect(provider.create({ ...input, requestId: randomUUID(), expectedRevision: created.revision })).rejects.toThrow('管理员提醒池');
      await f.command('a remind after 1 chat'); clock.mockReturnValue(Date.now() + 1000);
      await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0]![1]).toBe('⏰ 提醒：chat');
      const transaction = f.db.transaction!.bind(f.db);
      const crash = vi.spyOn(f.db, 'transaction').mockImplementation(async callback => {
        const result = await transaction(callback);
        const host = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
        if ((await host.models.get('admin_reminder_tasks')!.select().where({ state: 'unknown' })).length) f.service('alpha').stop();
        return result;
      });
      await f.jobs[0]!.execute(); expect(f.send).toHaveBeenCalledTimes(1); crash.mockRestore();
      await f.runtime.stop(); await f.db.stop(); await f.db.start(); await f.restart();
      await [...f.active][0]!.execute(); expect(f.send).toHaveBeenCalledTimes(1);
      expect((await f.tasks('alpha').read()).tasks[0]!.state).toBe('unknown');
      const state = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
      const book = await createReminderState(state).get<AdminReminderBook>(ADMIN_REMINDER_STATE_KEY); expect(book!.tasks[0]!.claimId).toBeTruthy();
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('keeps independent quotas, records definitive failure and rejects malformed administrator state', async () => {
    const f = await fixture({ maxTasks: 1, adminMaxTasks: 1 }); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start(); const provider = f.tasks('alpha');
      await f.command('a remind after 60 chat');
      const created = await provider.create({ requestId: randomUUID(), expectedRevision: (await provider.read()).revision, target,
        parameters: { text: 'admin', at: new Date(Date.now() + 1000).toISOString() } });
      await expect(provider.create({ requestId: randomUUID(), expectedRevision: created.revision, target,
        parameters: { text: 'overflow', at: new Date(Date.now() + 1000).toISOString() } })).rejects.toThrow('管理员提醒池');
      expect(await f.command('a remind after 60 overflow')).toContain('上限');
      f.send.mockRejectedValueOnce(new EndpointDeliveryError('platform_rejected', 'not sent', 'rejected'));
      clock.mockReturnValue(Date.now() + 1000); await f.jobs[0]!.execute();
      const failed = await provider.read(); expect(failed.tasks[0]!.state).toBe('failed'); expect(failed.tasks[0]!.actions).toEqual([]);
      expect(f.send).toHaveBeenCalledTimes(1);
      const state = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
      await state.models.get('admin_reminder_tasks_book')!.update({ version: 99 }).where({ storage_id: 1 });
      await expect(provider.read()).rejects.toMatchObject({ code: 'unavailable' });
      await expect(f.jobs[0]!.execute()).rejects.toThrow('持久状态格式无效');
      expect(f.send).toHaveBeenCalledTimes(1);
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });
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

  it.skipIf(!sqliteAvailable)('advances every overdue cycle and delivers a later due reminder in the same batch-one scan', async () => {
    const f = await fixture({ maxTasks: 32, batchSize: 1 });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      await f.runtime.start();
      for (let i = 0; i < 30; i++) await f.command(`a remind every 60 missed-${i}`, { ...alice, sender: { id: `sender-${i}` } });
      await f.command('a remind after 600 due-after-cycles');
      clock.mockReturnValue(Date.now() + 600_000);
      await f.jobs[0]!.execute();
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.send.mock.calls[0]![1]).toBe('⏰ 提醒：due-after-cycles');
      const host = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
      const book = (await createReminderState(host).get<ReminderBook>(REMINDER_STATE_KEY))!;
      expect(book.tasks.filter(task => task.intervalMs !== null && task.nextRunAt > Date.now())).toHaveLength(30);
      expect(book.tasks.find(task => task.text === 'due-after-cycles')!.status).toBe('delivered');
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
      await createReminderState(state).update<ReminderBook>(REMINDER_STATE_KEY, book => ({ version: 1, tasks: book!.tasks.map(task => task.status === 'unknown' ? { ...task, claimId: 'crashed' } : task) }));
      await f.runtime.stop(); await f.restart(); await [...f.active][0]!.execute();
      expect(f.send).toHaveBeenCalledTimes(3);
    } finally { await f.runtime.stop(); await f.db.stop(); }
  });

  it.skipIf(!sqliteAvailable)('rejects bad candidate configuration, advertises side effects without running verification, and explicitly verifies persistence only', async () => {
    const f = await fixture();
    try {
      await f.runtime.start(); const before = f.runtime.snapshot;
      await expect(f.runtime.patchConfig([{ op: 'set', path: ['alpha', 'timezone'], value: 'invalid/timezone' }])).rejects.toThrow('IANA');
      await expect(f.runtime.patchConfig([{ op: 'set', path: ['alpha', 'timezone'], value: '+08:00' }])).rejects.toThrow('IANA');
      expect(f.runtime.snapshot).toBe(before); expect(f.active.size).toBe(2);
      await expect(f.runtime.patchConfig([{ op: 'set', path: ['alpha', 'maxTasks'], value: 33 }])).rejects.toThrow();
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
      expect(await f.command('a remind create --help')).toContain('when');
      expect(await f.command('a remind create 10分钟后 新建提醒')).toContain('真实聊天');
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
      const transaction = f.db.transaction!.bind(f.db);
      const crash = vi.spyOn(f.db, 'transaction').mockImplementation(async callback => {
        const result = await transaction(callback);
        const host = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
        if ((await host.models.get('reminder_tasks')!.select().where({ state: 'unknown' })).length) f.service('alpha').stop();
        return result;
      });
      await f.jobs[0]!.execute(); expect(f.send).not.toHaveBeenCalled();
      crash.mockRestore();
      await f.runtime.stop(); await f.db.stop(); await f.db.start(); await f.restart();
      await [...f.active][0]!.execute(); expect(f.send).not.toHaveBeenCalled();
      expect(await f.command('a remind list')).toContain('未确认');
      const state = f.runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'alpha'))!.get(databaseHostToken.id) as PluginDatabaseHost;
      await state.models.get('reminder_tasks_book')!.update({ version: 99 }).where({ storage_id: 1 });
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
      expect((await createReminderState(state).get<ReminderBook>(REMINDER_STATE_KEY))!.tasks).toHaveLength(2);
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
  await write('package.json', { name: '@test/root', dependencies: { '@test/reminder': '*', '@test/command': '*', '@test/schedule': '*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features, plugins: [] } });
  await write('plugin.ts', { default: definePlugin({ name: 'root' }) }, true);
  for (const [name, value] of [['command', commandFeature], ['schedule', scheduleFeature]] as const) {
    await write(`packages/${name}/package.json`, { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
    await write(`packages/${name}/index.ts`, { default: value }, true);
  }
  await write('plugins/reminder/package.json', { name: '@test/reminder', dependencies: { '@test/command': '*', '@test/schedule': '*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features } });
  await write('plugins/reminder/plugin.ts', { default: plugin }, true);
  await write('plugins/reminder/schema.json', configSchema);
  for (const [name, value] of Object.entries({ after, at, every, list, cancel, create })) await write(`plugins/reminder/commands/remind/${name}/index.ts`, { default: value }, true);
  await write('plugins/reminder/schedules/poll/index.ts', { default: poll }, true);
  const db = createDatabaseHost({ dialect: 'sqlite', filename: join(project, 'state.sqlite') });
  const jobs: ScheduleJobRegistration[] = []; const active = new Set<ScheduleJobRegistration>();
  const schedule: ScheduleHost = { register(job) { jobs.push(job); active.add(job); return () => { active.delete(job); }; }, list: () => [...active] };
  const send = vi.fn<NonNullable<import('../../../../packages/im/plugin-runtime/src/index.js').OutboundRootHost['sendTarget']>>().mockResolvedValue('message-id');
  const outbound = { send: vi.fn().mockResolvedValue(null), sendTarget: send };
  const loader: ModuleRuntime = { async load<T>(source: string): Promise<T> { if (!modules.has(source)) throw new Error(`Missing fixture module ${source}`); return modules.get(source) as T; }, async close() {} };
  const makeRuntime = () => new RootRuntime({ projectRoot: project, modules: loader, config: { configVersion: 2, plugins: { alpha: '@test/reminder', beta: '@test/reminder' }, alpha: { commandNamespace: 'a', ...settings }, beta: { commandNamespace: 'b' } }, environment: { name: 'test', mode: 'test', platform: 'node' }, installResources({ resources, admission, handoff }) {
    handoff.add({ activateNext: () => db.start() });
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
  const tasks = (name: string): PluginTaskProvider => runtime.snapshot.resources.get(childPluginId(rootPluginId(), name))!.get(pluginTaskProviderToken.id) as PluginTaskProvider;
  return { project, get runtime() { return runtime; }, restart, db, jobs, active, send, command, service, tasks };
}

async function mutate(provider: PluginTaskProvider, snapshot: PluginTaskSnapshot, id: string, action: 'pause' | 'resume' | 'cancel'): Promise<PluginTaskSnapshot> {
  return provider.change({ requestId: randomUUID(), expectedRevision: snapshot.revision, id, action });
}
