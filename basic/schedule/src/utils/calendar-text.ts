import { solarDateToLunar, type LunarDate } from '../data/lunar-table.js';
import { getDatePartsInTimezone } from './timezone.js';

const LUNAR_MONTH_NAMES = [
  '正',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '十一',
  '腊',
] as const;

const LUNAR_DAY_NAMES = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
] as const;

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

function formatLunarYearGanzhi(year: number): string {
  return `${GAN[(year - 4) % 10]}${ZHI[(year - 4) % 12]}`;
}

export function formatLunarDateText(lunar: LunarDate): string {
  const leap = lunar.isLeapMonth ? '闰' : '';
  const month = LUNAR_MONTH_NAMES[lunar.month - 1] ?? String(lunar.month);
  const day = LUNAR_DAY_NAMES[lunar.day - 1] ?? String(lunar.day);
  return `${formatLunarYearGanzhi(lunar.year)}年${leap}${month}月${day}`;
}

export function formatSolarText(date: Date, timezone: string): string {
  const { year, month, day } = getDatePartsInTimezone(date, timezone);
  return `${year}年${month}月${day}日`;
}

export function formatLunarText(date: Date, timezone: string): string {
  try {
    return formatLunarDateText(solarDateToLunar(date, timezone));
  } catch {
    return '';
  }
}
