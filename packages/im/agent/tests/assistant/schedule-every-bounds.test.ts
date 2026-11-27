/**
 * #1250 b113: an `every` interval is bounded to 365 days (the bound of a one-shot job's delay) before
 * anything is saved. A larger one used to be stored and registered: its next run
 * (`Date.now() + everyMs`) could pass the largest `Date` (8.64e15) and become an Invalid Date.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScheduleEngine } from '@zhin.js/kernel';
import { TimerScheduler } from '../../src/assistant/timer-scheduler.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { MAX_SCHEDULE_EVERY_MS, scheduleEveryMsError } from '../../src/assistant/schedule-limits.js';
import { MAX_SCHEDULE_DELAY_MINUTES } from '../../src/assistant/schedule-job-service.js';
import { syncProfileHeartbeatToStore, validateAssistantProfile } from '../../src/assistant/profile-loader.js';

const TOO_LONG = [MAX_SCHEDULE_EVERY_MS + 1, 8.64e15, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY];

describe('every interval bound (#1250 b113)', () => {
  let dataDir: string;
  let store: ScheduleJobStore;
  let engine: TimerScheduler;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-every-'));
    store = new ScheduleJobStore({ dataDir });
    engine = new TimerScheduler({ store, due: { run: vi.fn() } as never, router: createNotificationRouter({ resolveAdapter: () => undefined }) });
  });

  afterEach(async () => {
    engine.unload();
    await engine.stop();
    await rm(dataDir, { recursive: true, force: true });
  });

  const job = (everyMs: number) => ({
    id: 'tick', enabled: true, source: 'manual' as const, schedule: { kind: 'every' as const, everyMs },
    action: { kind: 'agent' as const, prompt: 'p' }, notify: { channel: 'silent' as const },
  });

  it('uses the same 365 days as a one-shot delay', () => {
    expect(MAX_SCHEDULE_EVERY_MS).toBe(MAX_SCHEDULE_DELAY_MINUTES * 60_000);
    expect(scheduleEveryMsError(MAX_SCHEDULE_EVERY_MS)).toBeUndefined();
    expect(scheduleEveryMsError(MAX_SCHEDULE_EVERY_MS + 1)).toBe(`执行间隔（everyMs）最多 365 天，收到: ${MAX_SCHEDULE_EVERY_MS + 1}`);
  });

  it('is only the upper bound: a zero, negative or fractional interval is left to the callers', () => {
    // Zero / negative stay "not schedulable" (`isRuntimeSchedulable`); the Console route, `zhin schedule`
    // and `validateAssistantProfile` check positive / whole values themselves.
    for (const everyMs of [0, -1, 1.5]) expect(scheduleEveryMsError(everyMs)).toBeUndefined();
    expect(scheduleEveryMsError('1000')).toBe('执行间隔（everyMs）必须是毫秒数，收到: 1000');
    expect(scheduleEveryMsError(Number.NaN)).toBe('执行间隔（everyMs）必须是毫秒数，收到: NaN');
    expect(scheduleEveryMsError(Number.NEGATIVE_INFINITY)).toBe('执行间隔（everyMs）必须是毫秒数，收到: -Infinity');
  });

  it('a Profile heartbeat that is not a number is reported as such, not as past 365 days', () => {
    const errors = validateAssistantProfile({ version: 1, routines: { heartbeat: { everyMs: '60000' } } } as never);
    expect(errors).toEqual(['执行间隔（everyMs）必须是毫秒数，收到: 60000']);
  });

  it.each(TOO_LONG)('addJob refuses everyMs %s and saves nothing', async everyMs => {
    await expect(engine.addJob(job(everyMs))).rejects.toMatchObject({ code: 'schedule_invalid', message: expect.stringContaining('最多 365 天') });
    expect(await store.getJob('tick')).toBeFalsy();
  });

  it('addJob keeps the 365-day maximum with a valid next run', async () => {
    const added = await engine.addJob(job(MAX_SCHEDULE_EVERY_MS));
    expect(added.schedule).toEqual({ kind: 'every', everyMs: MAX_SCHEDULE_EVERY_MS });
    expect(await store.getJob('tick')).toBeTruthy();
  });

  it.each(TOO_LONG)('updateJob refuses everyMs %s and keeps the stored timing', async everyMs => {
    await engine.addJob(job(60_000));
    await expect(engine.updateJob('tick', { schedule: { kind: 'every', everyMs } })).rejects.toMatchObject({ code: 'schedule_invalid' });
    expect((await store.getJob('tick'))?.schedule).toEqual({ kind: 'every', everyMs: 60_000 });
  });

  it('a Profile heartbeat past 365 days is reported and not synced', async () => {
    const profile = { version: 1, routines: { heartbeat: { enabled: true, everyMs: MAX_SCHEDULE_EVERY_MS + 1 } } } as never;
    expect(validateAssistantProfile(profile)).toContain(scheduleEveryMsError(MAX_SCHEDULE_EVERY_MS + 1));
    expect(await syncProfileHeartbeatToStore(store, profile)).toBe(false);
    expect(await store.listJobs()).toEqual([]);
  });
});

describe('ScheduleEngine every guard (#1250 b113)', () => {
  it('refuses an interval whose next run is not a valid Date', () => {
    const engine = new ScheduleEngine();
    try {
      expect(() => engine.register('huge', 'every', vi.fn(), { everyMs: 8.64e15 })).toThrow(RangeError);
      expect(engine.getStatus()).toEqual([]);
      engine.register('ok', 'every', vi.fn(), { everyMs: MAX_SCHEDULE_EVERY_MS });
      const next = engine.getStatus()[0]?.nextExecution as Date | undefined;
      expect(Number.isNaN(next?.getTime())).toBe(false);
    } finally {
      engine.dispose();
    }
  });
});
