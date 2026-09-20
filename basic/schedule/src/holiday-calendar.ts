// AUTO-GENERATED BUNDLED IMPORTS START
import data2019 from './data/holidays/2019.json' with { type: 'json' };
import data2020 from './data/holidays/2020.json' with { type: 'json' };
import data2021 from './data/holidays/2021.json' with { type: 'json' };
import data2022 from './data/holidays/2022.json' with { type: 'json' };
import data2023 from './data/holidays/2023.json' with { type: 'json' };
import data2024 from './data/holidays/2024.json' with { type: 'json' };
import data2025 from './data/holidays/2025.json' with { type: 'json' };
import data2026 from './data/holidays/2026.json' with { type: 'json' };
// AUTO-GENERATED BUNDLED IMPORTS END
import { fetchHolidayYearData } from './data/holiday-fetcher.js';
import type { FestivalFilter, FestivalName } from './types.js';
import { matchesFestivalFilter, normalizeFestivalKey } from './utils/festival-map.js';
import { formatDateKey, getDatePartsInTimezone } from './utils/timezone.js';

export interface HolidayRange {
  start: string;
  end: string;
  festival: string;
}

export interface HolidayYearData {
  holidayRanges: HolidayRange[];
  workdays: string[];
}

export interface HolidayRangeInfo {
  start: string;
  end: string;
  festival: FestivalName;
}

export interface UpdateHolidayDataOptions {
  /** Write all current overrides to this path; `true` uses the default path. */
  persist?: boolean | string;
  /** Fetch the official source and replace the selected year. */
  force?: boolean;
}

type DataUpdateListener = () => void;

const DEFAULT_OVERRIDE_PATH = '.cn-calendar-schedule/holiday-overrides.json';

// AUTO-GENERATED BUNDLED DATA START
const BUNDLED_DATA: Readonly<Record<number, HolidayYearData>> = {
  2019: data2019,
  2020: data2020,
  2021: data2021,
  2022: data2022,
  2023: data2023,
  2024: data2024,
  2025: data2025,
  2026: data2026,
};
// AUTO-GENERATED BUNDLED DATA END

function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map((value) => parseInt(value, 10));
  return { year, month, day };
}

function formatDateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function offsetDateKey(dateKey: string, days: number): string {
  const parts = parseDateKey(dateKey);
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return formatDateKeyFromParts(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth() + 1,
    cursor.getUTCDate(),
  );
}

export function expandHolidayRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = parseDateKey(start);
  const endParts = parseDateKey(end);
  const cursor = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const endUtc = Date.UTC(endParts.year, endParts.month - 1, endParts.day);

  while (cursor.getTime() <= endUtc) {
    dates.push(
      formatDateKeyFromParts(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        cursor.getUTCDate(),
      ),
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function isHolidayYearData(value: unknown): value is HolidayYearData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'holidayRanges' in value &&
    Array.isArray((value as HolidayYearData).holidayRanges) &&
    'workdays' in value &&
    Array.isArray((value as HolidayYearData).workdays) &&
    (value as HolidayYearData).holidayRanges.every(
      (range) =>
        typeof range === 'object' &&
        range !== null &&
        typeof range.start === 'string' &&
        typeof range.end === 'string' &&
        typeof range.festival === 'string',
    ) &&
    (value as HolidayYearData).workdays.every((date) => typeof date === 'string')
  );
}

function copyYearData(data: HolidayYearData): HolidayYearData {
  if (!isHolidayYearData(data)) {
    throw new TypeError('Holiday year data must contain holidayRanges and workdays');
  }
  return {
    holidayRanges: data.holidayRanges.map((range) => ({ ...range })),
    workdays: [...data.workdays],
  };
}

function isUpdateOptions(value: unknown): value is UpdateHolidayDataOptions {
  if (typeof value !== 'object' || value === null || isHolidayYearData(value)) {
    return false;
  }
  return 'persist' in value || 'force' in value;
}

/**
 * Owns one independent statutory-holiday dataset and all derived query caches.
 * Updating one calendar never changes another scheduler or planning operation.
 */
export class HolidayCalendar {
  private readonly years = new Map<number, HolidayYearData>();
  private readonly holidayDatesByYear = new Map<number, ReadonlySet<string>>();
  private readonly workdaysByYear = new Map<number, ReadonlySet<string>>();
  private readonly listeners = new Set<DataUpdateListener>();

  constructor(initialData: Readonly<Record<number, HolidayYearData>> = BUNDLED_DATA) {
    for (const [year, data] of Object.entries(initialData)) {
      this.years.set(Number(year), copyYearData(data));
    }
  }

  get minYear(): number | null {
    const years = [...this.years.keys()];
    return years.length === 0 ? null : Math.min(...years);
  }

  get maxYear(): number | null {
    const years = [...this.years.keys()];
    return years.length === 0 ? null : Math.max(...years);
  }

  onUpdate(listener: DataUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isWorkday(date: Date, timezone = 'Asia/Shanghai'): boolean {
    const parts = getDatePartsInTimezone(date, timezone);
    const key = formatDateKey(date, timezone);
    const holidays = this.getHolidayDates(parts.year);
    const workdays = this.getWorkdays(parts.year);

    if (!holidays || !workdays) {
      return parts.dayOfWeek >= 1 && parts.dayOfWeek <= 5;
    }
    if (holidays.has(key)) return false;
    if (workdays.has(key)) return true;
    return parts.dayOfWeek >= 1 && parts.dayOfWeek <= 5;
  }

  festivalForDate(date: Date, timezone = 'Asia/Shanghai'): FestivalName | undefined {
    return this.holidayRangeForDate(date, timezone)?.festival;
  }

  holidayRangeForDate(date: Date, timezone = 'Asia/Shanghai'): HolidayRangeInfo | null {
    const key = formatDateKey(date, timezone);
    const year = getDatePartsInTimezone(date, timezone).year;
    const data = this.years.get(year);
    if (!data) return null;

    for (const range of data.holidayRanges) {
      if (key >= range.start && key <= range.end) {
        const festival = normalizeFestivalKey(range.festival);
        if (!festival) return null;
        return { start: range.start, end: range.end, festival };
      }
    }
    return null;
  }

  collectHolidayDates(festivals: FestivalFilter, everyDay: boolean): ReadonlySet<string> {
    const dates = new Set<string>();
    for (const range of this.matchingRanges(festivals)) {
      if (everyDay) {
        for (const date of expandHolidayRange(range.start, range.end)) dates.add(date);
      } else {
        dates.add(range.start);
      }
    }
    return dates;
  }

  collectHolidayEveDates(festivals: FestivalFilter, daysBefore = 1): ReadonlySet<string> {
    const dates = new Set<string>();
    for (const range of this.matchingRanges(festivals)) {
      for (let day = daysBefore; day >= 1; day--) {
        dates.add(offsetDateKey(range.start, -day));
      }
    }
    return dates;
  }

  collectAfterHolidayDates(festivals: FestivalFilter, daysAfter: number): ReadonlySet<string> {
    const dates = new Set<string>();
    for (const range of this.matchingRanges(festivals)) {
      for (let day = 1; day <= daysAfter; day++) {
        dates.add(offsetDateKey(range.end, day));
      }
    }
    return dates;
  }

  isMakeupWorkday(date: Date, timezone = 'Asia/Shanghai'): boolean {
    const year = getDatePartsInTimezone(date, timezone).year;
    return this.getWorkdays(year)?.has(formatDateKey(date, timezone)) ?? false;
  }

  update(
    year: number,
    options: UpdateHolidayDataOptions & { force: true },
  ): Promise<HolidayYearData>;
  update(
    year: number,
    data: HolidayYearData,
    options?: UpdateHolidayDataOptions,
  ): Promise<void>;
  update(
    data: Record<number, HolidayYearData>,
    options?: UpdateHolidayDataOptions,
  ): Promise<void>;
  async update(
    yearOrData: number | Record<number, HolidayYearData>,
    dataOrOptions?: HolidayYearData | UpdateHolidayDataOptions,
    maybeOptions?: UpdateHolidayDataOptions,
  ): Promise<void | HolidayYearData> {
    if (typeof yearOrData === 'number') {
      const year = yearOrData;
      if (isUpdateOptions(dataOrOptions) && dataOrOptions.force) {
        const fetched = await fetchHolidayYearData(year);
        this.apply({ [year]: fetched });
        await this.persistIfRequested(dataOrOptions);
        return fetched;
      }
      if (!isHolidayYearData(dataOrOptions)) {
        throw new Error(
          'HolidayCalendar.update(year, ...) requires HolidayYearData or { force: true }',
        );
      }
      this.apply({ [year]: dataOrOptions });
      await this.persistIfRequested(maybeOptions);
      return;
    }

    this.apply(yearOrData);
    await this.persistIfRequested(dataOrOptions as UpdateHolidayDataOptions | undefined);
  }

  async loadOverrides(path: string): Promise<void> {
    const fs = await import('node:fs/promises');
    try {
      const raw = await fs.readFile(path, 'utf8');
      this.apply(JSON.parse(raw) as Record<number, HolidayYearData>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private getHolidayDates(year: number): ReadonlySet<string> | null {
    const data = this.years.get(year);
    if (!data) return null;
    let dates = this.holidayDatesByYear.get(year);
    if (!dates) {
      dates = new Set(data.holidayRanges.flatMap((range) =>
        expandHolidayRange(range.start, range.end),
      ));
      this.holidayDatesByYear.set(year, dates);
    }
    return dates;
  }

  private getWorkdays(year: number): ReadonlySet<string> | null {
    const data = this.years.get(year);
    if (!data) return null;
    let workdays = this.workdaysByYear.get(year);
    if (!workdays) {
      workdays = new Set(data.workdays);
      this.workdaysByYear.set(year, workdays);
    }
    return workdays;
  }

  private matchingRanges(festivals: FestivalFilter): HolidayRange[] {
    const ranges: HolidayRange[] = [];
    for (const year of [...this.years.keys()].sort((left, right) => left - right)) {
      for (const range of this.years.get(year)!.holidayRanges) {
        if (matchesFestivalFilter(range.festival, festivals)) ranges.push(range);
      }
    }
    return ranges;
  }

  private apply(data: Record<number, HolidayYearData>): void {
    for (const [year, yearData] of Object.entries(data)) {
      const numericYear = Number(year);
      if (!Number.isInteger(numericYear)) {
        throw new TypeError(`Holiday year must be an integer: ${year}`);
      }
      this.years.set(numericYear, copyYearData(yearData));
      this.holidayDatesByYear.delete(numericYear);
      this.workdaysByYear.delete(numericYear);
    }
    for (const listener of this.listeners) listener();
  }

  private async persistIfRequested(options?: UpdateHolidayDataOptions): Promise<void> {
    if (!options?.persist) return;
    const path = typeof options.persist === 'string' ? options.persist : DEFAULT_OVERRIDE_PATH;
    const fs = await import('node:fs/promises');
    const nodePath = await import('node:path');
    await fs.mkdir(nodePath.dirname(path), { recursive: true });
    const payload = Object.fromEntries(
      [...this.years.entries()].sort(([left], [right]) => left - right),
    );
    await fs.writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}
