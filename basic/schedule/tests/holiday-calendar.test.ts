import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNextRun } from '../src/dispatch.js';
import { HolidayCalendar } from '../src/holiday-calendar.js';
import { getFestivalForDate, isWorkday } from '../src/resolvers/holiday.js';
import { resolveHolidayJob } from '../src/resolve-job.js';

const TZ = 'Asia/Shanghai';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

function at(iso: string): Date {
  return new Date(iso);
}

describe('HolidayCalendar', () => {
  let tempDir: string;
  let holidays: HolidayCalendar;

  beforeEach(() => {
    holidays = new HolidayCalendar();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('extends its year range after update', async () => {
    await holidays.update(2027, {
      holidayRanges: [{ start: '2027-10-01', end: '2027-10-07', festival: '国庆节' }],
      workdays: [],
    });

    expect(holidays.minYear).toBe(2019);
    expect(holidays.maxYear).toBe(2027);

    const job = resolveHolidayJob({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, TZ);
    const next = getNextRun(job, at('2027-09-30T10:00:00+08:00'), { holidays });
    expect(next?.toISOString()).toBe(at('2027-10-01T09:00:00+08:00').toISOString());
  });

  it('refreshes derived caches after update', async () => {
    await holidays.update(2027, {
      holidayRanges: [{ start: '2027-01-01', end: '2027-01-01', festival: '元旦' }],
      workdays: ['2027-01-04'],
    });

    expect(isWorkday(at('2027-01-01T09:00:00+08:00'), TZ, holidays)).toBe(false);
    expect(isWorkday(at('2027-01-04T09:00:00+08:00'), TZ, holidays)).toBe(true);
    expect(getFestivalForDate(at('2027-01-01T09:00:00+08:00'), TZ, holidays)).toBe('元旦');
  });

  it('isolates mutable data between calendar owners', async () => {
    const other = new HolidayCalendar();
    const data = {
      holidayRanges: [{ start: '2035-01-01', end: '2035-01-01', festival: '元旦' }],
      workdays: [],
    };

    await holidays.update(2035, data);
    data.holidayRanges.length = 0;

    expect(holidays.maxYear).toBe(2035);
    expect(holidays.festivalForDate(at('2035-01-01T09:00:00+08:00'), TZ)).toBe('元旦');
    expect(other.maxYear).toBe(2026);
    expect(other.festivalForDate(at('2035-01-01T09:00:00+08:00'), TZ)).toBeUndefined();
  });

  it('persists overrides when persist option is set', async () => {
    tempDir = join(TEST_TMP_ROOT, `override-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'holiday-overrides.json');

    await holidays.update(
      2028,
      {
        holidayRanges: [{ start: '2028-05-01', end: '2028-05-01', festival: '劳动节' }],
        workdays: [],
      },
      { persist: path },
    );

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('2028');
    expect(raw).toContain('劳动节');
  });

  it('force:true fetches official data and persists override', async () => {
    tempDir = join(TEST_TMP_ROOT, `force-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'holiday-overrides.json');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          year: 2029,
          days: [
            { name: '元旦', date: '2029-01-01', isOffDay: true },
            { name: '元旦', date: '2029-01-02', isOffDay: false },
          ],
        }),
      })),
    );

    const data = await holidays.update(2029, { force: true, persist: path });
    expect(data.holidayRanges).toEqual([
      { start: '2029-01-01', end: '2029-01-01', festival: '元旦' },
    ]);
    expect(data.workdays).toEqual(['2029-01-02']);
    expect(holidays.maxYear).toBe(2029);

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"2029"');
  });
});
