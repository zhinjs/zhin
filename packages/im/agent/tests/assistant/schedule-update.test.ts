/**
 * #1250 b90: `schedule_update` changes a job's timing, label and enabled state in place. Rebuilding
 * a job with `schedule_add` + `schedule_remove` used to drop settings the model cannot see (the
 * hidden Agent `briefing`), and the model still answered that the job was changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { TimerScheduler } from '../../src/assistant/timer-scheduler.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { createScheduleTools, type ScheduleManager } from '../../src/schedule-manager.js';
import { parseScheduleUpdateFromToolArgs } from '../../src/assistant/schedule-job-service.js';
import { classifyHighRiskAction, defaultHighRiskConfirmLevel } from '../../src/security/provenance.js';

const conversation = (id: string) => ({ endpoint: { adapter: 'qq', id: 'bot' }, kind: 'private' as const, id });
const caller = (subjectId: string, roles: string[]) => ({
  signal: new AbortController().signal,
  traceId: 'trace-update',
  turnId: 'turn-update',
  sessionKey: `im:qq:bot:private:${subjectId}`,
  origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: subjectId, conversation: conversation(subjectId) },
  principal: { subjectId, roles },
}) as unknown as ToolExecutionContext;
const owner = caller('boss', ['owner', 'admin', 'trusted']);
const alice = caller('alice', ['user']);
const bob = caller('bob', ['user']);

const imTarget = (sceneId: string) => ({ channel: 'im' as const, target: { channel: 'im' as const,
  scene: { platform: 'qq', endpointKey: 'bot', sceneId, kind: 'private' as const } } });
const createdBy = (userId: string) => ({ userId, roles: ['user' as const], chat: { conversation: conversation(userId), endpointId: 'bot' } });

/** Hour and minute of `ms` in the zone the scheduler evaluates cron jobs in. */
function shanghaiTime(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
}

describe('schedule_update (#1250 b90)', () => {
  let dataDir: string;
  let store: ScheduleJobStore;
  let engine: TimerScheduler;
  let manager: ScheduleManager;
  const tool = (name: string) => createScheduleTools(manager).find(entry => entry.name === name)!.definition;
  const update = (input: Record<string, unknown>, who: ToolExecutionContext) =>
    tool('schedule_update').execute(input, who) as Promise<Record<string, unknown>>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-update-'));
    store = new ScheduleJobStore({ dataDir });
    engine = new TimerScheduler({ store, due: { run: vi.fn() } as never, router: createNotificationRouter({ resolveAdapter: () => undefined }) });
    manager = { scheduleFeature: { getStatus: () => [] }, engine, agents: () => ['zhin', 'briefing'] };
    await engine.addJob({
      id: 'morning-brief', label: '早报', enabled: true, source: 'schedule',
      schedule: { kind: 'solar', cron: '0 0 9 * * *' },
      action: { kind: 'agent', prompt: '整理今天的早报', agent: 'briefing' },
      notify: imTarget('boss'),
      createdBy: { userId: 'boss', roles: ['owner'], chat: { conversation: conversation('boss'), endpointId: 'bot' } },
      executionPlan: { prompt: '整理今天的早报', tools: ['web_search'], confirmed: true },
      budget: { maxToolCalls: 5 },
    });
    await engine.addJob({
      id: 'alice-water', enabled: true, source: 'schedule', schedule: { kind: 'workday', cron: '0 0 10 * * *' },
      action: { kind: 'agent', prompt: '提醒喝水' }, notify: imTarget('alice'), createdBy: createdBy('alice'),
    });
    await engine.addJob({
      id: 'assistant-profile-morning-brief', enabled: true, source: 'profile', schedule: { kind: 'solar', cron: '0 0 7 * * *' },
      action: { kind: 'agent', prompt: 'profile brief' }, notify: { channel: 'silent' },
    });
  });

  afterEach(async () => {
    engine.unload();
    await engine.stop();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('changes only the cron: the Agent stays briefing, and prompt, delivery, creator, plan and budget are kept', async () => {
    const before = await store.getJob('morning-brief');
    const result = await update({ id: 'morning-brief', cron: '0 0 8 * * *' }, owner);
    expect(result).toMatchObject({ success: true, id: 'morning-brief', schedule: { kind: 'solar', cron: '0 0 8 * * *' }, enabled: true, label: '早报' });
    expect(result.message).toContain('Agent');
    const after = await store.getJob('morning-brief');
    expect(after?.schedule).toEqual({ kind: 'solar', cron: '0 0 8 * * *' });
    expect(after?.action).toEqual({ kind: 'agent', prompt: '整理今天的早报', agent: 'briefing' });
    for (const field of ['label', 'enabled', 'notify', 'createdBy', 'executionPlan', 'budget', 'source', 'createdAt'] as const) {
      expect(after?.[field], field).toEqual(before?.[field]);
    }
    expect(shanghaiTime(after!.state.nextRunAtMs!)).toBe('08:00');
    // Still a single job: nothing was rebuilt.
    expect((await engine.listJobs()).map(job => job.id)).toEqual(['morning-brief', 'alice-water', 'assistant-profile-morning-brief']);
  });

  it('keeps the cron when only schedule_kind changes, and the kind when only the cron changes', async () => {
    await update({ id: 'alice-water', schedule_kind: 'freeDay' }, alice);
    expect((await store.getJob('alice-water'))?.schedule).toEqual({ kind: 'freeDay', cron: '0 0 10 * * *' });
    await update({ id: 'alice-water', cron: '0 30 11 * * *' }, alice);
    expect((await store.getJob('alice-water'))?.schedule).toEqual({ kind: 'freeDay', cron: '0 30 11 * * *' });
  });

  it('changes the label and enabled state; disabling clears the next run and enabling recomputes it', async () => {
    expect(await update({ id: 'morning-brief', label: '每日早报', enabled: false }, owner)).toMatchObject({ success: true, enabled: false });
    let job = await store.getJob('morning-brief');
    expect(job).toMatchObject({ label: '每日早报', enabled: false });
    expect(job?.state.nextRunAtMs).toBeUndefined();
    expect(job?.action).toEqual({ kind: 'agent', prompt: '整理今天的早报', agent: 'briefing' });
    await update({ id: 'morning-brief', enabled: true, label: '' }, owner);
    job = await store.getJob('morning-brief');
    expect(job?.enabled).toBe(true);
    expect(job).not.toHaveProperty('label');
    expect(shanghaiTime(job!.state.nextRunAtMs!)).toBe('09:00');
  });

  it('turns a job into a one-shot with delay_minutes', async () => {
    const now = Date.now();
    await update({ id: 'alice-water', delay_minutes: 30 }, alice);
    const job = await store.getJob('alice-water');
    expect(job?.schedule).toMatchObject({ kind: 'at', deleteAfterRun: true });
    expect((job!.schedule as { atMs: number }).atMs).toBeGreaterThanOrEqual(now + 30 * 60_000);
    expect(job?.action).toEqual({ kind: 'agent', prompt: '提醒喝水' });
  });

  it('refuses a non-owner changing someone else\'s job, like schedule_remove, and changes nothing', async () => {
    const spy = vi.spyOn(engine, 'updateJob');
    const before = await store.getJob('morning-brief');
    expect(await update({ id: 'morning-brief', cron: '0 0 8 * * *' }, alice)).toEqual({ error: '未找到你能管理的任务：morning-brief' });
    expect(await update({ id: 'alice-water', cron: '0 0 8 * * *' }, bob)).toEqual({ error: '未找到你能管理的任务：alice-water' });
    // A missing job reads the same to a non-owner.
    expect(await update({ id: 'ghost', cron: '0 0 8 * * *' }, alice)).toEqual({ error: '未找到你能管理的任务：ghost' });
    expect(await update({ id: 'ghost', cron: '0 0 8 * * *' }, owner)).toEqual({ error: '未找到' });
    expect(spy).not.toHaveBeenCalled();
    expect(await store.getJob('morning-brief')).toEqual(before);
    // The creator may.
    expect(await update({ id: 'alice-water', label: '喝水' }, alice)).toMatchObject({ success: true });
  });

  it('points even an owner to the Profile file for a profile routine', async () => {
    const result = await update({ id: 'assistant-profile-morning-brief', cron: '0 0 8 * * *' }, owner);
    expect(result.error).toContain('assistant.profile.yml');
    expect((await store.getJob('assistant-profile-morning-brief'))?.schedule).toEqual({ kind: 'solar', cron: '0 0 7 * * *' });
  });

  it('rejects an update with nothing to change, an invalid kind and a non-boolean enabled', async () => {
    expect((await update({ id: 'morning-brief' }, owner)).error).toContain('至少提供一项修改');
    expect((await update({ id: 'morning-brief', schedule_kind: 'weekly' }, owner)).error).toContain('schedule_kind 无效');
    expect((await update({ id: 'morning-brief', enabled: 'no' }, owner)).error).toContain('enabled');
  });

  it('is confirmed like schedule_add: the same schedule high-risk category and default level', () => {
    const add = createScheduleTools(manager).find(entry => entry.name === 'schedule_add')!;
    const upd = createScheduleTools(manager).find(entry => entry.name === 'schedule_update')!;
    expect(classifyHighRiskAction({ name: upd.name, tags: upd.definition.tags })).toBe('schedule');
    expect(classifyHighRiskAction({ name: add.name, tags: add.definition.tags })).toBe('schedule');
    expect(defaultHighRiskConfirmLevel('schedule_update', 'schedule')).toBe(defaultHighRiskConfirmLevel('schedule_add', 'schedule'));
    // No admin-approvable relaxation: only the owner confirms it.
    expect(upd.definition.tags ?? []).toEqual([]);
  });

  it('tells schedule_add callers to update a job instead of rebuilding it', () => {
    expect(tool('schedule_add').description).toContain('schedule_update');
    expect(tool('schedule_add').description).toContain('不要删除后重建');
    expect(tool('schedule_update').description).toContain('Agent');
  });
});

describe('parseScheduleUpdateFromToolArgs (#1250 b90)', () => {
  it('needs a cron when the job has none', () => {
    expect(parseScheduleUpdateFromToolArgs({ schedule_kind: 'solar' }, { schedule: { kind: 'every', everyMs: 60_000 } }))
      .toEqual({ error: expect.stringContaining('cron') });
    expect(parseScheduleUpdateFromToolArgs({ cron: '0 0 8 * * *' }, { schedule: { kind: 'every', everyMs: 60_000 } }))
      .toEqual({ schedule: { kind: 'solar', cron: '0 0 8 * * *' } });
  });

  it('keeps the time zone and holiday settings of a cron job', () => {
    expect(parseScheduleUpdateFromToolArgs({ cron: '0 0 8 * * *' }, { schedule: { kind: 'solar', cron: '0 0 9 * * *', tz: 'Asia/Tokyo' } }))
      .toEqual({ schedule: { kind: 'solar', cron: '0 0 8 * * *', tz: 'Asia/Tokyo' } });
    expect(parseScheduleUpdateFromToolArgs({ cron: '0 0 8 * * *' }, { schedule: { kind: 'holiday', cron: '0 0 9 * * *', festivals: ['春节'], everyDayOfHoliday: true } }))
      .toEqual({ schedule: { kind: 'holiday', cron: '0 0 8 * * *', festivals: ['春节'], everyDayOfHoliday: true } });
  });
});
