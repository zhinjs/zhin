// AUTO-GENERATED BUNDLED IMPORTS START
import data2019 from './holidays/2019.json';
import data2020 from './holidays/2020.json';
import data2021 from './holidays/2021.json';
import data2022 from './holidays/2022.json';
import data2023 from './holidays/2023.json';
import data2024 from './holidays/2024.json';
import data2025 from './holidays/2025.json';
import data2026 from './holidays/2026.json';
// AUTO-GENERATED BUNDLED IMPORTS END
import { fetchHolidayYearData } from './holiday-fetcher.js';

export interface HolidayRange {
  start: string;
  end: string;
  festival: string;
}

export interface HolidayYearData {
  holidayRanges: HolidayRange[];
  workdays: string[];
}

export interface UpdateDataOptions {
  /** 写入 override 文件；`true` 使用默认路径 */
  persist?: boolean | string;
  /** 从国务院公示数据源拉取并强制覆盖该年本地数据 */
  force?: boolean;
}

type DataUpdateListener = () => void;

const DEFAULT_OVERRIDE_PATH = '.cn-calendar-schedule/holiday-overrides.json';

// AUTO-GENERATED BUNDLED DATA START
const BUNDLED_DATA: Record<number, HolidayYearData> = {
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

const holidayData = new Map<number, HolidayYearData>(
  Object.entries(BUNDLED_DATA).map(([y, d]) => [Number(y), d]),
);
const holidaySetCache = new Map<number, Set<string>>();
const workdaySetCache = new Map<number, Set<string>>();
const updateListeners = new Set<DataUpdateListener>();

/** @deprecated Use getMinHolidayYear() */
export const MIN_HOLIDAY_YEAR = 2019;
/** @deprecated Use getMaxHolidayYear() */
export const MAX_HOLIDAY_YEAR = 2026;

export function getMinHolidayYear(): number | null {
  const years = [...holidayData.keys()];
  return years.length === 0 ? null : Math.min(...years);
}

export function getMaxHolidayYear(): number | null {
  const years = [...holidayData.keys()];
  return years.length === 0 ? null : Math.max(...years);
}

export function getYearData(year: number): HolidayYearData | null {
  return holidayData.get(year) ?? null;
}

export function getHolidaySet(year: number): Set<string> | null {
  const data = holidayData.get(year);
  if (!data) {
    return null;
  }
  if (!holidaySetCache.has(year)) {
    holidaySetCache.set(year, buildHolidaySet(data.holidayRanges));
  }
  return holidaySetCache.get(year)!;
}

export function getWorkdaySet(year: number): Set<string> | null {
  const data = holidayData.get(year);
  if (!data) {
    return null;
  }
  if (!workdaySetCache.has(year)) {
    workdaySetCache.set(year, new Set(data.workdays));
  }
  return workdaySetCache.get(year)!;
}

export function iterateYears(callback: (year: number, data: HolidayYearData) => void): void {
  for (const year of [...holidayData.keys()].sort((a, b) => a - b)) {
    callback(year, holidayData.get(year)!);
  }
}

export function onHolidayDataUpdate(listener: DataUpdateListener): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

function buildHolidaySet(ranges: HolidayRange[]): Set<string> {
  const set = new Set<string>();
  for (const range of ranges) {
    for (const date of expandRange(range.start, range.end)) {
      set.add(date);
    }
  }
  return set;
}

function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map((v) => parseInt(v, 10));
  return { year: y, month: m, day: d };
}

function formatDateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function expandRange(start: string, end: string): string[] {
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

function invalidateYearCache(year: number): void {
  holidaySetCache.delete(year);
  workdaySetCache.delete(year);
}

function notifyUpdate(): void {
  for (const listener of updateListeners) {
    listener();
  }
}

function applyUpdate(data: Record<number, HolidayYearData>): void {
  for (const [year, yearData] of Object.entries(data)) {
    const y = Number(year);
    holidayData.set(y, yearData);
    invalidateYearCache(y);
  }
  notifyUpdate();
}

function isHolidayYearData(value: unknown): value is HolidayYearData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'holidayRanges' in value &&
    Array.isArray((value as HolidayYearData).holidayRanges)
  );
}

function isUpdateDataOptions(value: unknown): value is UpdateDataOptions {
  if (typeof value !== 'object' || value === null || isHolidayYearData(value)) {
    return false;
  }
  return 'persist' in value || 'force' in value;
}

function resolvePersistPath(options?: UpdateDataOptions): string | null {
  if (!options?.persist) {
    return null;
  }
  return typeof options.persist === 'string' ? options.persist : DEFAULT_OVERRIDE_PATH;
}

async function persistOverrides(path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  const payload = Object.fromEntries(
    [...holidayData.entries()].sort(([a], [b]) => a - b),
  );
  await fs.writeFile(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export async function updateData(
  year: number,
  options: UpdateDataOptions & { force: true },
): Promise<HolidayYearData>;
export async function updateData(
  year: number,
  data: HolidayYearData,
  options?: UpdateDataOptions,
): Promise<void>;
export async function updateData(
  data: Record<number, HolidayYearData>,
  options?: UpdateDataOptions,
): Promise<void>;
export async function updateData(
  yearOrData: number | Record<number, HolidayYearData>,
  dataOrOptions?: HolidayYearData | UpdateDataOptions,
  maybeOptions?: UpdateDataOptions,
): Promise<void | HolidayYearData> {
  if (typeof yearOrData === 'number') {
    const year = yearOrData;

    if (isUpdateDataOptions(dataOrOptions) && dataOrOptions.force) {
      const options = dataOrOptions;
      const fetched = await fetchHolidayYearData(year);
      applyUpdate({ [year]: fetched });

      const persistPath = resolvePersistPath(options);
      if (persistPath) {
        await persistOverrides(persistPath);
      }

      return fetched;
    }

    if (!isHolidayYearData(dataOrOptions)) {
      throw new Error(
        'updateData(year, ...) 需要传入 HolidayYearData，或使用 { force: true } 自动拉取国务院公示数据',
      );
    }

    applyUpdate({ [year]: dataOrOptions });
    const persistPath = resolvePersistPath(maybeOptions);
    if (persistPath) {
      await persistOverrides(persistPath);
    }
    return;
  }

  applyUpdate(yearOrData);
  const persistPath = resolvePersistPath(dataOrOptions as UpdateDataOptions | undefined);
  if (persistPath) {
    await persistOverrides(persistPath);
  }
}

export async function loadHolidayOverrides(path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  try {
    const raw = await fs.readFile(path, 'utf8');
    const data = JSON.parse(raw) as Record<number, HolidayYearData>;
    applyUpdate(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}
