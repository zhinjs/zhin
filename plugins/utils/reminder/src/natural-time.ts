import { MAX_DELAY_SECONDS, parseReminderInstant } from './timing.js';

export class ReminderTimeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderTimeInputError';
  }
}

interface CalendarTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY = 86_400_000;
const MAX_DELAY = MAX_DELAY_SECONDS * 1000;
const NUMBER = '[0-9零〇一二两三四五六七八九十百千万]+';
const RELATIVE = new RegExp(`^(${NUMBER})\\s*(秒钟?|分钟?|小时|天)\\s*后$`, 'u');
const LOCAL = /^(今天|明天|后天)\s*(凌晨|上午|中午|下午|晚上)?\s*(.+)$/u;
const POINT = new RegExp(`^(${NUMBER})\\s*点(?:\\s*(半)|\\s*(${NUMBER})\\s*分(?:\\s*(${NUMBER})\\s*秒)?)?$`, 'u');
const DIGITS = '零一二三四五六七八九';
const HELP = '暂不支持这种时间表达，请使用“十分钟后”“明天九点半”或带时区 offset 的 ISO 时间；不支持每天、每周等日历周期';

/** Parse a bounded, explicit grammar; this never reads the machine's default timezone. */
export function parseNaturalReminderTime(
  expression: string,
  options: { now: number; timezone: string },
): { at: number; timezone: string; expression: string } {
  if (typeof expression !== 'string' || expression.length > 200) fail('提醒时间须为不超过 200 个字符的文字');
  const text = expression.trim();
  if (!text || /\p{Cc}/u.test(expression)) fail('请在一行内输入提醒时间');
  assertInstant(options.now);
  const formatter = createFormatter(options.timezone);
  let at: number;
  if (/^\d{4}-/u.test(text)) {
    try { at = parseReminderInstant(text); }
    catch { fail('绝对时间无效，请使用带 Z 或 ±hh:mm 的 ISO 时间，例如 2026-10-20T09:00:00+08:00'); }
  } else {
    const relative = RELATIVE.exec(text);
    if (relative) {
      const amount = parseInteger(relative[1]!);
      const unit = relative[2]!;
      const multiplier = unit.startsWith('秒') ? 1000 : unit.startsWith('分') ? 60_000 : unit === '小时' ? 3_600_000 : DAY;
      at = options.now + amount * multiplier;
    } else {
      const local = LOCAL.exec(text);
      if (!local) fail(HELP);
      const current = partsAt(options.now, formatter);
      const date = new Date(utc({ ...current, hour: 0, minute: 0, second: 0 }));
      date.setUTCDate(date.getUTCDate() + (local[1] === '今天' ? 0 : local[1] === '明天' ? 1 : 2));
      const clock = parseClock(local[3]!, local[2]);
      const desired: CalendarTime = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1,
        day: date.getUTCDate(), ...clock };
      at = localInstant(desired, formatter);
    }
  }
  const delay = at - options.now;
  if (delay > MAX_DELAY) fail('提醒时间不能超过当前时间的 365 天后');
  if (!Number.isSafeInteger(at) || !Number.isFinite(new Date(at).getTime()) || delay < 1000) {
    fail('提醒时间须在当前时间至少 1 秒后；今天已过的时间不会自动改到明天，请重新指定日期');
  }
  return { at, timezone: options.timezone, expression: text };
}

/** Always show the resolved date, configured zone and its actual offset. */
export function formatReminderTime(at: number, timezone: string): string {
  assertInstant(at);
  const formatter = createFormatter(timezone);
  const local = partsAt(at, formatter);
  const offset = offsetAt(at, formatter);
  const seconds = Math.abs(offset) / 1000;
  const offsetText = `${offset < 0 ? '-' : '+'}${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}${seconds % 60 ? `:${pad(seconds % 60)}` : ''}`;
  return `${String(local.year).padStart(4, '0')}-${pad(local.month)}-${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)} UTC${offsetText} (${timezone})`;
}

function fail(message: string): never { throw new ReminderTimeInputError(message); }
function pad(value: number): string { return String(value).padStart(2, '0'); }
function assertInstant(value: number): void {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) fail('当前时间或提醒时间无效');
}
function createFormatter(timezone: string): Intl.DateTimeFormat {
  if (typeof timezone !== 'string' || !timezone || timezone.length > 100 || timezone !== timezone.trim() || /^[+-]/u.test(timezone)) {
    fail('提醒时区无效，请配置有效的 IANA 时区，例如 Asia/Shanghai');
  }
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', era: 'short' });
  } catch { fail('提醒时区无效，请配置有效的 IANA 时区，例如 Asia/Shanghai'); }
}
function partsAt(at: number, formatter: Intl.DateTimeFormat): CalendarTime {
  const parts = Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]));
  return { year: parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year), month: Number(parts.month),
    day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
function utc(value: CalendarTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(value.hour, value.minute, value.second, 0);
  return date.getTime();
}
function offsetAt(at: number, formatter: Intl.DateTimeFormat): number {
  const local = utc(partsAt(at, formatter));
  if (!Number.isFinite(local)) fail('提醒日期超出支持范围');
  return local - Math.floor(at / 1000) * 1000;
}
function localInstant(desired: CalendarTime, formatter: Intl.DateTimeFormat): number {
  const naive = utc(desired);
  if (!Number.isFinite(naive)) fail('提醒日期超出支持范围');
  const offsets = new Set<number>();
  // A fixed 97 probes cover both sides of a DST or date-line transition.
  // Candidate instants must round-trip exactly; never pick one side of a fold.
  for (let hour = -48; hour <= 48; hour++) {
    const probe = naive + hour * 3_600_000;
    if (Number.isFinite(new Date(probe).getTime())) offsets.add(offsetAt(probe, formatter));
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(at => {
    if (!Number.isFinite(new Date(at).getTime())) return false;
    const actual = partsAt(at, formatter);
    return (Object.keys(desired) as (keyof CalendarTime)[]).every(key => actual[key] === desired[key]);
  });
  if (candidates.length === 0) fail('这个本地时间因时区或夏令时切换而不存在，请改用明确日期并带 offset 的 ISO 时间');
  if (candidates.length !== 1) fail('这个本地时间因夏令时切换出现两次，请使用带明确 offset 的 ISO 时间选择其中一次');
  return candidates[0]!;
}
function parseClock(text: string, period: string | undefined): Pick<CalendarTime, 'hour' | 'minute' | 'second'> {
  const colon = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u.exec(text);
  const point = POINT.exec(text);
  if (!colon && !point) fail('时间须写为 09:30、九点、九点半或九点三十分；请同时指定今天、明天或后天');
  let hour = colon ? Number(colon[1]) : parseInteger(point![1]!);
  const minute = colon ? Number(colon[2]) : point![2] ? 30 : point![3] ? parseInteger(point![3]!) : 0;
  const second = colon ? Number(colon[3] ?? 0) : point![4] ? parseInteger(point![4]!) : 0;
  if (minute > 59 || second > 59 || hour > 23) fail('小时须为 0–23，分钟和秒须为 0–59');
  if (period === '下午' || period === '晚上') {
    if (hour < 1 || hour > 12 || period === '晚上' && hour === 12) fail('时段与钟点不明确，请使用 24 小时制，例如 00:00 或 18:00');
    hour = hour === 12 ? 12 : hour + 12;
  } else if (period === '上午' || period === '凌晨') {
    if (hour > 11) fail('时段与钟点不明确，请使用 24 小时制，例如 00:00 或 12:00');
  } else if (period === '中午') {
    if (hour === 1 || hour === 2) hour += 12;
    else if (hour !== 11 && hour !== 12) fail('中午的钟点不明确，请使用 24 小时制');
  }
  return { hour, minute, second };
}

function parseInteger(text: string): number {
  if (/^\d+$/u.test(text)) {
    const number = Number(text);
    if (!Number.isSafeInteger(number)) fail('时间数值过大，请使用一年以内的时间');
    return number;
  }
  if (/两(?![百千万]|$)/u.test(text)) fail('中文数字不明确，请改用阿拉伯数字');
  const normalized = text.replace(/〇/gu, '零').replace(/两/gu, '二');
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of normalized) {
    const index = DIGITS.indexOf(character);
    if (index !== -1) digit = index;
    else if (character === '万') { total += (section + digit) * 10_000; section = 0; digit = 0; }
    else {
      const unit = character === '十' ? 10 : character === '百' ? 100 : character === '千' ? 1000 : NaN;
      section += (digit || 1) * unit;
      digit = 0;
    }
  }
  const number = total + section + digit;
  if (!Number.isSafeInteger(number) || number < 0 || number > 99_999_999
    || chineseInteger(number) !== normalized && !(normalized.startsWith('一十') && chineseInteger(number) === normalized.slice(1))) {
    fail('中文数字不明确，请写完整中文整数或改用阿拉伯数字');
  }
  return number;
}
function chineseInteger(value: number): string {
  if (value === 0) return '零';
  const section = (number: number): string => {
    let result = '';
    let zero = false;
    for (const [unit, label] of [[1000, '千'], [100, '百'], [10, '十'], [1, '']] as const) {
      const digit = Math.floor(number / unit) % 10;
      if (digit) {
        if (zero) result += '零';
        result += `${DIGITS[digit]}${label}`;
        zero = false;
      } else if (result && number % unit) zero = true;
    }
    return result;
  };
  const high = Math.floor(value / 10_000);
  const low = value % 10_000;
  const result = high ? `${section(high)}万${low ? `${low < 1000 ? '零' : ''}${section(low)}` : ''}` : section(low);
  return result.startsWith('一十') ? result.slice(1) : result;
}
