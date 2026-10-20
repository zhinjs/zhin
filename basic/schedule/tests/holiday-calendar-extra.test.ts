import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandHolidayRange, HolidayCalendar } from '../src/holiday-calendar.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

describe('holiday registry extras', () => {
  let tempDir: string;
  let holidays: HolidayCalendar;

  beforeEach(() => {
    holidays = new HolidayCalendar();
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      tempDir = '';
    }
  });

  it('merges multiple years in one update', async () => {
    await holidays.update({
      2030: {
        holidayRanges: [{ start: '2030-01-01', end: '2030-01-01', festival: '元旦' }],
        workdays: [],
      },
      2031: {
        holidayRanges: [{ start: '2031-05-01', end: '2031-05-01', festival: '劳动节' }],
        workdays: [],
      },
    });

    expect(holidays.maxYear).toBe(2031);
  });

  it('persists a batch update', async () => {
    tempDir = join(TEST_TMP_ROOT, `batch-persist-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'batch-overrides.json');

    await holidays.update(
      {
        2037: {
          holidayRanges: [{ start: '2037-01-01', end: '2037-01-01', festival: '元旦' }],
          workdays: [],
        },
      },
      { persist: path },
    );

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"2037"');
  });

  it('falls back to weekdays for an unknown year', () => {
    expect(holidays.isWorkday(new Date('1800-01-06T09:00:00+08:00'))).toBe(true);
    expect(holidays.isWorkday(new Date('1800-01-05T09:00:00+08:00'))).toBe(false);
  });

  it('loads a persisted override file', async () => {
    tempDir = join(TEST_TMP_ROOT, `load-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'overrides.json');
    await writeFile(
      path,
      JSON.stringify({
        2032: {
          holidayRanges: [{ start: '2032-01-01', end: '2032-01-01', festival: '元旦' }],
          workdays: [],
        },
      }),
    );

    await holidays.loadOverrides(path);
    expect(holidays.maxYear).toBeGreaterThanOrEqual(2032);
  });

  it('ignores a missing override file', async () => {
    await expect(
      holidays.loadOverrides(join(TEST_TMP_ROOT, 'missing-overrides.json')),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid JSON override file', async () => {
    tempDir = join(TEST_TMP_ROOT, `bad-json-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'bad.json');
    await writeFile(path, 'not-json');

    await expect(holidays.loadOverrides(path)).rejects.toThrow();
  });

  it('rejects a year without data or force', async () => {
    await expect(holidays.update(2099, { persist: true } as never)).rejects.toThrow(/force: true/);
  });

  it('writes an explicit override path', async () => {
    tempDir = join(TEST_TMP_ROOT, `persist-default-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'holiday-overrides.json');

    await holidays.update(
      2033,
      { holidayRanges: [{ start: '2033-01-01', end: '2033-01-01', festival: '元旦' }], workdays: [] },
      { persist: path },
    );

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"2033"');
  });

  it('notifies owner-local listeners', async () => {
    const listener = vi.fn();
    const off = holidays.onUpdate(listener);
    await holidays.update(2034, {
      holidayRanges: [{ start: '2034-01-01', end: '2034-01-01', festival: '元旦' }],
      workdays: [],
    });
    expect(listener).toHaveBeenCalled();
    off();
  });

  it('expands a range including both endpoints', () => {
    expect(expandHolidayRange('2025-01-01', '2025-01-03')).toEqual([
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
    ]);
  });
});
