import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  convertHolidayCnToYearData,
  fetchHolidayYearData,
  normalizeOfficialFestivalName,
  type HolidayCnYear,
} from '../src/data/holiday-fetcher.js';

const HOLIDAY_CN_2025: HolidayCnYear = {
  year: 2025,
  days: [
    { name: '元旦', date: '2025-01-01', isOffDay: true },
    { name: '春节', date: '2025-01-26', isOffDay: false },
    { name: '春节', date: '2025-01-28', isOffDay: true },
    { name: '春节', date: '2025-01-29', isOffDay: true },
    { name: '春节', date: '2025-01-30', isOffDay: true },
    { name: '春节', date: '2025-01-31', isOffDay: true },
    { name: '春节', date: '2025-02-01', isOffDay: true },
    { name: '春节', date: '2025-02-02', isOffDay: true },
    { name: '春节', date: '2025-02-03', isOffDay: true },
    { name: '春节', date: '2025-02-04', isOffDay: true },
    { name: '春节', date: '2025-02-08', isOffDay: false },
    { name: '清明节', date: '2025-04-04', isOffDay: true },
    { name: '清明节', date: '2025-04-05', isOffDay: true },
    { name: '清明节', date: '2025-04-06', isOffDay: true },
    { name: '劳动节', date: '2025-04-27', isOffDay: false },
    { name: '劳动节', date: '2025-05-01', isOffDay: true },
    { name: '劳动节', date: '2025-05-02', isOffDay: true },
    { name: '劳动节', date: '2025-05-03', isOffDay: true },
    { name: '劳动节', date: '2025-05-04', isOffDay: true },
    { name: '劳动节', date: '2025-05-05', isOffDay: true },
    { name: '端午节', date: '2025-05-31', isOffDay: true },
    { name: '端午节', date: '2025-06-01', isOffDay: true },
    { name: '端午节', date: '2025-06-02', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-09-28', isOffDay: false },
    { name: '国庆节、中秋节', date: '2025-10-01', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-02', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-03', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-04', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-05', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-06', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-07', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-08', isOffDay: true },
    { name: '国庆节、中秋节', date: '2025-10-11', isOffDay: false },
  ],
};

describe('holiday-fetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('convertHolidayCnToYearData matches bundled 2025.json', async () => {
    const converted = convertHolidayCnToYearData(HOLIDAY_CN_2025);
    const bundled = JSON.parse(
      await readFile(join(dirname(fileURLToPath(import.meta.url)), '../src/data/holidays/2025.json'), 'utf8'),
    );
    expect(converted).toEqual(bundled);
  });

  it('fetchHolidayYearData pulls from holiday-cn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('https://example.test/2025.json');
        return {
          ok: true,
          json: async () => HOLIDAY_CN_2025,
        };
      }),
    );

    const data = await fetchHolidayYearData(2025, 'https://example.test');
    expect(data.holidayRanges).toHaveLength(6);
    expect(data.workdays).toEqual([
      '2025-01-26',
      '2025-02-08',
      '2025-04-27',
      '2025-09-28',
      '2025-10-11',
    ]);
  });

  it('fetchHolidayYearData throws on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(fetchHolidayYearData(2099, 'https://example.test')).rejects.toThrow(/HTTP 404/);
  });

  it('fetchHolidayYearData throws on empty days', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ year: 2099, days: [] }),
      })),
    );
    await expect(fetchHolidayYearData(2099, 'https://example.test')).rejects.toThrow(/无效或为空/);
  });

  it('normalizeOfficialFestivalName maps official names', () => {
    expect(normalizeOfficialFestivalName('国庆节、中秋节')).toBe('国庆节');
    expect(normalizeOfficialFestivalName('中秋节')).toBe('中秋节');
    expect(normalizeOfficialFestivalName('未知节日')).toBe('未知节日');
    expect(normalizeOfficialFestivalName('春节')).toBe('春节');
  });

  it('convertHolidayCnToYearData handles single-day holiday', () => {
    const data = convertHolidayCnToYearData({
      year: 2099,
      days: [{ name: '元旦', date: '2099-01-01', isOffDay: true }],
    });
    expect(data).toEqual({
      holidayRanges: [{ start: '2099-01-01', end: '2099-01-01', festival: '元旦' }],
      workdays: [],
    });
  });

  it('convertHolidayCnToYearData handles workdays-only input', () => {
    const data = convertHolidayCnToYearData({
      year: 2099,
      days: [{ name: '春节', date: '2099-01-02', isOffDay: false }],
    });
    expect(data).toEqual({ holidayRanges: [], workdays: ['2099-01-02'] });
  });

  it('normalizeOfficialFestivalName keeps unknown compound names', () => {
    expect(normalizeOfficialFestivalName('未知节日、其他')).toBe('未知节日、其他');
  });
});
