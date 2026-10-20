import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNextRun, isJobDue } from '../src/dispatch.js';
import { scatter } from '../src/parsers/scatter-helpers.js';
import { resolveScatterJob } from '../src/resolve-job.js';
import {
  getScatterMeta,
  getScatterNextRun,
  isScatterDayFilter,
  isScatterDue,
  listScatterSlots,
  listScatterSlotsForDay,
} from '../src/resolvers/scatter.js';
import { CalendarScheduler } from '../src/scheduler.js';
import { createLocalJsonStore } from '../src/store/local-json-store.js';
import { InvalidScheduleError } from '../src/types.js';
import type { ResolvedJob } from '../src/types.js';
import { generateDailySlots, parseTimeOfDay, seedFrom } from '../src/utils/scatter-slots.js';
import {
  advanceScatterState,
  getScatterState,
  mergeScatterPayload,
} from '../src/utils/scatter-state.js';
import { formatDateKey } from '../src/utils/timezone.js';

const TZ = 'Asia/Shanghai';
const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

type ResolvedScatterJob = Extract<ResolvedJob, { kind: 'scatter' }>;

async function createTestDir(name: string): Promise<string> {
  const dir = join(TEST_TMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function at(iso: string): Date {
  return new Date(iso);
}

function scatterJob(on: 'all' | 'workday' | 'freeDay' = 'workday'): ResolvedScatterJob {
  return resolveScatterJob(
    { window: { start: '09:00', end: '22:00' }, count: 3, on },
    TZ,
  ) as ResolvedScatterJob;
}

describe('scatter-slots', () => {
  it('parseTimeOfDay accepts HH:MM and HH:MM:SS', () => {
    expect(parseTimeOfDay('09:00')).toBe(9 * 3600);
    expect(parseTimeOfDay('22:00:00')).toBe(22 * 3600);
  });

  it('parseTimeOfDay rejects out-of-range values', () => {
    expect(() => parseTimeOfDay('25:00')).toThrow(/Invalid time/);
    expect(() => parseTimeOfDay('09:60')).toThrow(/Invalid time/);
    expect(() => parseTimeOfDay('09:00:60')).toThrow(/Invalid time/);
    expect(() => parseTimeOfDay('not-a-time')).toThrow(/Invalid time/);
  });

  it('generateDailySlots rejects count exceeding window', () => {
    expect(() => generateDailySlots('job-a', '2024-09-23', 100, 101, 3)).toThrow(
      /count exceeds window capacity/,
    );
  });

  it('generateDailySlots is deterministic for same jobId and dateKey', () => {
    const a = generateDailySlots('job-a', '2024-09-23', 9 * 3600, 22 * 3600, 3);
    const b = generateDailySlots('job-a', '2024-09-23', 9 * 3600, 22 * 3600, 3);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a).toEqual([...a].sort((x, y) => x - y));
  });

  it('different jobId yields different slots', () => {
    const a = generateDailySlots('job-a', '2024-09-23', 9 * 3600, 22 * 3600, 3);
    const b = generateDailySlots('job-b', '2024-09-23', 9 * 3600, 22 * 3600, 3);
    expect(a).not.toEqual(b);
  });

  it('seedFrom is stable', () => {
    expect(seedFrom('x', '2024-09-23')).toBe(seedFrom('x', '2024-09-23'));
  });
});

describe('resolveScatterJob', () => {
  it('rejects invalid window and count', () => {
    expect(() =>
      resolveScatterJob({ window: { start: 'bad', end: '22:00' }, count: 1, on: 'all' }, TZ),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      resolveScatterJob({ window: { start: '22:00', end: '09:00' }, count: 1, on: 'all' }, TZ),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      resolveScatterJob({ window: { start: '09:00', end: '09:00' }, count: 2, on: 'all' }, TZ),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      resolveScatterJob({ window: { start: '09:00', end: '09:01' }, count: 0, on: 'all' }, TZ),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      resolveScatterJob({ window: { start: '09:00', end: '09:00:01' }, count: 3, on: 'all' }, TZ),
    ).toThrow(/Scatter count exceeds window capacity/);
    expect(() =>
      resolveScatterJob(
        {
          window: { start: '09:00', end: '22:00' },
          count: 1,
          on: { kind: 'other' } as unknown as 'all',
        },
        TZ,
      ),
    ).toThrow(/Invalid scatter day filter/);
    expect(() =>
      resolveScatterJob(
        {
          window: { start: '09:00', end: '22:00' },
          count: 1,
          on: 'invalid' as unknown as 'all',
        },
        TZ,
      ),
    ).toThrow(/Invalid scatter day filter/);
  });

  it('accepts valid scatter input including holiday filter', () => {
    const job = resolveScatterJob(
      {
        window: { start: '09:00', end: '22:00' },
        count: 2,
        on: { kind: 'holiday', festivals: ['国庆节'], everyDayOfHoliday: true },
      },
      TZ,
    );
    expect(job.kind).toBe('scatter');
    if (job.kind === 'scatter') {
      expect(job.on).toEqual({
        kind: 'holiday',
        festivals: ['国庆节'],
        everyDayOfHoliday: true,
      });
    }
  });
});

describe('scatter helpers', () => {
  it('scatter.daily returns the same input object', () => {
    const input = {
      window: { start: '09:00', end: '22:00' },
      count: 3,
      on: 'workday' as const,
    };
    expect(scatter.daily(input)).toBe(input);
  });
});

describe('scatter resolver', () => {
  const jobId = 'scatter-test';
  const job = scatterJob('workday');

  it('skips weekend for workday filter', () => {
    const from = at('2024-09-20T10:00:00+08:00'); // Friday
    const next = getScatterNextRun(from, job, jobId);
    const dateKey = formatDateKey(next!, TZ);
    expect(dateKey).not.toBe('2024-09-21');
    expect(dateKey).not.toBe('2024-09-22');
  });

  it('triggers on makeup workday Sunday', () => {
    const from = at('2024-09-28T10:00:00+08:00');
    const next = getScatterNextRun(from, job, jobId);
    expect(formatDateKey(next!, TZ)).toBe('2024-09-29');
  });

  it('advances to second slot after one fire', () => {
    const dateKey = '2024-09-23';
    const slots = generateDailySlots(jobId, dateKey, job.windowStartSec, job.windowEndSec, 3);
    const state = { dateKey, firedCount: 1 };
    const from = at('2024-09-23T08:00:00+08:00');
    const next = getScatterNextRun(from, job, jobId, state);
    expect(next!.getTime()).toBe(
      new Date(`2024-09-23T${String(Math.floor(slots[1] / 3600)).padStart(2, '0')}:${String(Math.floor((slots[1] % 3600) / 60)).padStart(2, '0')}:${String(slots[1] % 60).padStart(2, '0')}+08:00`).getTime(),
    );
  });

  it('isScatterDue matches exact slot second', () => {
    const dateKey = '2024-09-23';
    const slots = generateDailySlots(jobId, dateKey, job.windowStartSec, job.windowEndSec, 3);
    const h = Math.floor(slots[0] / 3600);
    const m = Math.floor((slots[0] % 3600) / 60);
    const s = slots[0] % 60;
    const dueAt = at(
      `2024-09-23T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+08:00`,
    );
    expect(isScatterDue(dueAt, job, jobId)).toBe(true);
    expect(isScatterDue(at('2024-09-22T09:00:00+08:00'), job, jobId)).toBe(false);
  });

  it('dispatch getNextRun requires jobId for scatter', () => {
    expect(getNextRun(job, at('2024-09-23T08:00:00+08:00'))).toBeNull();
    expect(isJobDue(job, at('2024-09-23T10:00:00+08:00'))).toBe(false);
  });

  it('isJobDue returns true at exact scatter slot with jobId', () => {
    const dateKey = '2024-09-23';
    const slots = generateDailySlots(jobId, dateKey, job.windowStartSec, job.windowEndSec, 3);
    const h = Math.floor(slots[0] / 3600);
    const m = Math.floor((slots[0] % 3600) / 60);
    const s = slots[0] % 60;
    const dueAt = at(
      `2024-09-23T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+08:00`,
    );
    expect(isJobDue(job, dueAt, { jobId })).toBe(true);
  });

  it('supports all and freeDay filters', () => {
    const allJob = scatterJob('all');
    const freeJob = scatterJob('freeDay');
    const saturday = at('2024-09-21T10:00:00+08:00');
    expect(formatDateKey(getScatterNextRun(saturday, allJob, jobId)!, TZ)).toBe('2024-09-21');
    expect(getScatterNextRun(saturday, freeJob, jobId)).not.toBeNull();
    expect(getScatterNextRun(at('2024-09-23T10:00:00+08:00'), freeJob, jobId)).not.toBeNull();
    const monday = at('2024-09-23T10:00:00+08:00');
    expect(formatDateKey(getScatterNextRun(monday, freeJob, jobId)!, TZ)).toBe('2024-09-28');
  });

  it('supports holiday filter with everyDayOfHoliday', () => {
    const holidayJob = resolveScatterJob(
      {
        window: { start: '09:00', end: '22:00' },
        count: 1,
        on: { kind: 'holiday', festivals: ['国庆节'], everyDayOfHoliday: true },
      },
      TZ,
    );
    if (holidayJob.kind !== 'scatter') {
      throw new Error('expected scatter job');
    }
    const next = getScatterNextRun(at('2024-09-30T10:00:00+08:00'), holidayJob, jobId);
    expect(formatDateKey(next!, TZ)).toBe('2024-10-01');
  });

  it('skips to next eligible day when daily count exhausted', () => {
    const dateKey = '2024-09-23';
    const state = { dateKey, firedCount: 3 };
    const next = getScatterNextRun(at('2024-09-23T08:00:00+08:00'), job, jobId, state);
    expect(formatDateKey(next!, TZ)).toBe('2024-09-24');
  });

  it('advances to next day when all remaining slots are before from', () => {
    const next = getScatterNextRun(at('2024-09-23T23:00:00+08:00'), job, jobId);
    expect(formatDateKey(next!, TZ)).toBe('2024-09-24');
  });

  it('isScatterDue returns false when daily count exhausted', () => {
    const dateKey = '2024-09-23';
    const slots = generateDailySlots(jobId, dateKey, job.windowStartSec, job.windowEndSec, 3);
    const h = Math.floor(slots[0] / 3600);
    const m = Math.floor((slots[0] % 3600) / 60);
    const s = slots[0] % 60;
    const dueAt = at(
      `2024-09-23T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+08:00`,
    );
    expect(isScatterDue(dueAt, job, jobId, { dateKey, firedCount: 3 })).toBe(false);
  });

  it('getScatterMeta uses zero firedCount when state dateKey differs', () => {
    const scheduledAt = at('2024-09-24T10:00:00+08:00');
    expect(getScatterMeta(scheduledAt, job, { dateKey: '2024-09-23', firedCount: 2 })).toEqual({
      scatterIndex: 1,
      scatterCount: 3,
      scatterRemaining: 3,
    });
  });

  it('isScatterDayFilter validates filter shapes', () => {
    expect(isScatterDayFilter('all')).toBe(true);
    expect(isScatterDayFilter('workday')).toBe(true);
    expect(isScatterDayFilter('freeDay')).toBe(true);
    expect(isScatterDayFilter({ kind: 'holiday', festivals: ['国庆节'] })).toBe(true);
    expect(isScatterDayFilter({ kind: 'holidayEve', festivals: ['国庆节'] })).toBe(true);
    expect(isScatterDayFilter({ kind: 'afterHoliday', festivals: ['国庆节'], daysAfter: 1 })).toBe(true);
    expect(isScatterDayFilter('invalid' as 'all')).toBe(false);
    expect(isScatterDayFilter({ kind: 'other' } as { kind: 'holiday' })).toBe(false);
  });

  it('listScatterSlots helpers expose planned times', () => {
    const allToday = listScatterSlotsForDay(job, jobId, '2024-09-23');
    expect(allToday).toHaveLength(3);
    const remaining = listScatterSlots(job, jobId, '2024-09-23', { dateKey: '2024-09-23', firedCount: 1 });
    expect(remaining).toHaveLength(2);
    expect(listScatterSlotsForDay(job, jobId, '2024-09-21')).toEqual([]);
  });
});

describe('scatter state', () => {
  it('advanceScatterState increments same day and resets on new day', () => {
    const day = at('2024-09-23T10:00:00+08:00');
    const s1 = advanceScatterState(day, TZ, { dateKey: '', firedCount: 0 });
    expect(s1).toEqual({ dateKey: '2024-09-23', firedCount: 1 });
    const s2 = advanceScatterState(day, TZ, s1);
    expect(s2.firedCount).toBe(2);
    const nextDay = at('2024-09-24T10:00:00+08:00');
    const s3 = advanceScatterState(nextDay, TZ, s2);
    expect(s3).toEqual({ dateKey: '2024-09-24', firedCount: 1 });
  });

  it('mergeScatterPayload round-trips through getScatterState', () => {
    const payload = mergeScatterPayload({ foo: 1 }, { dateKey: '2024-09-23', firedCount: 2 });
    expect(getScatterState(payload)).toEqual({ dateKey: '2024-09-23', firedCount: 2 });
    expect((payload as { foo: number }).foo).toBe(1);
  });

  it('getScatterState falls back when payload scatter is invalid', () => {
    expect(getScatterState(null)).toEqual({ dateKey: '', firedCount: 0 });
    expect(getScatterState({ scatter: { dateKey: 123, firedCount: 'x' } })).toEqual({
      dateKey: '',
      firedCount: 0,
    });
  });
});

describe('scatter persistence', () => {
  let tempDir: string;
  let jobsPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('persists scatter progress and restores next slot after restart', async () => {
    vi.setSystemTime(at('2024-09-23T08:00:00+08:00'));
    tempDir = await createTestDir('scatter-persist');
    jobsPath = join(tempDir, 'jobs.json');

    const jobId = 'bubble-1';
    const resolved = scatterJob('workday');
    const slots = generateDailySlots(
      jobId,
      '2024-09-23',
      resolved.windowStartSec,
      resolved.windowEndSec,
      3,
    );
    const firstNext = getNextRun(resolved, at('2024-09-23T08:00:00+08:00'), { jobId })!;

    const handler = vi.fn();
    const store = createLocalJsonStore({ path: jobsPath });
    const scheduler = new CalendarScheduler({
      timezone: TZ,
      store,
      handlers: { bubble: handler },
    });
    await scheduler.ready;

    scheduler.scatter(
      { window: { start: '09:00', end: '22:00' }, count: 3, on: 'workday' },
      handler,
      'bubble',
      { id: jobId },
    );

    await vi.advanceTimersByTimeAsync(firstNext.getTime() - Date.now() + 1000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].scatterIndex).toBe(1);
    expect(handler.mock.calls[0][0].scatterCount).toBe(3);

    await vi.waitFor(async () => {
      const raw = await readFile(jobsPath, 'utf8');
      expect(raw).toContain('"firedCount": 1');
      expect(raw).toContain('"dateKey": "2024-09-23"');
    });

    scheduler.stop();

    const handler2 = vi.fn();
    const scheduler2 = new CalendarScheduler({
      timezone: TZ,
      store: createLocalJsonStore({ path: jobsPath }),
      handlers: { bubble: handler2 },
    });
    await scheduler2.ready;

    const secondNext = getNextRun(resolved, at('2024-09-23T08:00:00+08:00'), {
      jobId,
      scatterState: { dateKey: '2024-09-23', firedCount: 1 },
    })!;
    expect(secondNext.getTime()).toBe(
      new Date(`2024-09-23T${String(Math.floor(slots[1] / 3600)).padStart(2, '0')}:${String(Math.floor((slots[1] % 3600) / 60)).padStart(2, '0')}:${String(slots[1] % 60).padStart(2, '0')}+08:00`).getTime(),
    );

    await vi.advanceTimersByTimeAsync(secondNext.getTime() - Date.now() + 1000);
    await Promise.resolve();

    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2.mock.calls[0][0].scatterIndex).toBe(2);

    scheduler2.stop();
  });
});

describe('scatter scheduler integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires 3 times on a workday with scatterIndex metadata', async () => {
    const jobId = 'integration-bubble';
    const resolved = scatterJob('workday');
    const dateKey = '2024-09-23';
    const slots = generateDailySlots(
      jobId,
      dateKey,
      resolved.windowStartSec,
      resolved.windowEndSec,
      3,
    );

    vi.setSystemTime(at('2024-09-23T08:00:00+08:00'));
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: TZ });
    scheduler.scatter(
      { window: { start: '09:00', end: '22:00' }, count: 3, on: 'workday' },
      handler,
      'bubble',
      { id: jobId },
    );

    for (let i = 0; i < 3; i++) {
      const h = Math.floor(slots[i] / 3600);
      const m = Math.floor((slots[i] % 3600) / 60);
      const s = slots[i] % 60;
      const slotTime = at(
        `${dateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+08:00`,
      );
      const delta = slotTime.getTime() - Date.now();
      if (delta > 0) {
        await vi.advanceTimersByTimeAsync(delta + 1000);
      }
      await Promise.resolve();
    }

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls.map((c) => c[0].scatterIndex)).toEqual([1, 2, 3]);
    expect(handler.mock.calls.every((c) => c[0].scatterCount === 3)).toBe(true);

    scheduler.stop();
  });
});
