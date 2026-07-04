import type { FestivalName } from '../types.js';
import { isFestivalName } from '../utils/festival-map.js';
import type { HolidayRange, HolidayYearData } from './holiday-registry.js';

/** 国务院节假日公示数据（holiday-cn，溯源 gov.cn 通知） */
export const HOLIDAY_CN_RAW_BASE =
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master';

export interface HolidayCnDay {
  name: string;
  date: string;
  isOffDay: boolean;
}

export interface HolidayCnYear {
  year: number;
  papers?: string[];
  days: HolidayCnDay[];
}

export function normalizeOfficialFestivalName(name: string): FestivalName | string {
  if (name.includes('元旦')) return '元旦';
  if (name.includes('春节')) return '春节';
  if (name.includes('清明')) return '清明节';
  if (name.includes('劳动')) return '劳动节';
  if (name.includes('端午')) return '端午节';
  if (name.includes('中秋') && !name.includes('国庆')) return '中秋节';
  if (name.includes('国庆')) return '国庆节';
  const head = name.split('、')[0]?.trim();
  return head && isFestivalName(head) ? head : name;
}

function isNextDate(prev: string, next: string): boolean {
  const [y, m, d] = prev.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  const expected = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
  return expected === next;
}

export function convertHolidayCnToYearData(input: HolidayCnYear): HolidayYearData {
  const workdays: string[] = [];
  const holidayDays: { date: string; festival: string }[] = [];

  for (const day of input.days) {
    if (day.isOffDay) {
      holidayDays.push({
        date: day.date,
        festival: normalizeOfficialFestivalName(day.name),
      });
    } else {
      workdays.push(day.date);
    }
  }

  holidayDays.sort((a, b) => a.date.localeCompare(b.date));
  workdays.sort();

  const holidayRanges: HolidayRange[] = [];
  if (holidayDays.length > 0) {
    let start = holidayDays[0].date;
    let end = holidayDays[0].date;
    let festival = holidayDays[0].festival;

    for (let i = 1; i < holidayDays.length; i++) {
      const cur = holidayDays[i];
      if (cur.festival === festival && isNextDate(end, cur.date)) {
        end = cur.date;
        continue;
      }
      holidayRanges.push({ start, end, festival });
      start = cur.date;
      end = cur.date;
      festival = cur.festival;
    }
    holidayRanges.push({ start, end, festival });
  }

  return { holidayRanges, workdays };
}

export async function fetchHolidayYearData(
  year: number,
  baseUrl = HOLIDAY_CN_RAW_BASE,
): Promise<HolidayYearData> {
  const response = await fetch(`${baseUrl}/${year}.json`);
  if (!response.ok) {
    throw new Error(
      `无法获取 ${year} 年国务院公示节假日数据（HTTP ${response.status}）。请确认 holiday-cn 已收录该年度。`,
    );
  }

  const json = (await response.json()) as HolidayCnYear;
  if (!Array.isArray(json.days) || json.days.length === 0) {
    throw new Error(`${year} 年节假日数据格式无效或为空`);
  }

  return convertHolidayCnToYearData(json);
}
