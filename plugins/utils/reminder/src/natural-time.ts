import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
import { MAX_DELAY_SECONDS, parseReminderInstant } from './timing.js';

export class ReminderTimeInputError extends Error {
  constructor(message: string, readonly code?: Parameters<typeof t>[1]) {
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
const EN_RELATIVE = /^in\s+(\d+)\s+(seconds?|minutes?|hours?|days?)$/iu;
const EN_LOCAL = /^(today|tomorrow|(?:the )?day after tomorrow)\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?)$/iu;
const LOCAL = /^(今天|明天|后天)\s*(凌晨|上午|中午|下午|晚上)?\s*(.+)$/u;
const POINT = new RegExp(`^(${NUMBER})\\s*点(?:\\s*(半)|\\s*(${NUMBER})\\s*分(?:\\s*(${NUMBER})\\s*秒)?)?$`, 'u');
const DIGITS = '零一二三四五六七八九';
const HELP = 'timeGrammar';

/** Parse a bounded, explicit grammar; this never reads the machine's default timezone. */
export function parseNaturalReminderTime(
  expression: string,
  options: { now: number; timezone: string; locale?: Locale },
): { at: number; timezone: string; expression: string } {
  const locale = resolveLocale(options.locale);
  try {
  if (typeof expression !== 'string' || expression.length > 200) fail('timeLength');
  const text = expression.trim();
  if (!text || /\p{Cc}/u.test(expression)) fail('timeOneLine');
  assertInstant(options.now);
  const formatter = createFormatter(options.timezone);
  let at: number;
  if (/^\d{4}-/u.test(text)) {
    try { at = parseReminderInstant(text); }
    catch { fail('timeAbsolute'); }
  } else {
    const relative = (locale === 'en' ? EN_RELATIVE : RELATIVE).exec(text);
    if (relative) {
      const amount = parseInteger(relative[1]!);
      const unit = relative[2]!.toLowerCase();
      const multiplier = unit.startsWith('秒') || unit.startsWith('second') ? 1000 : unit.startsWith('分') || unit.startsWith('minute') ? 60_000 : unit === '小时' || unit.startsWith('hour') ? 3_600_000 : DAY;
      at = options.now + amount * multiplier;
    } else {
      const local = (locale === 'en' ? EN_LOCAL : LOCAL).exec(text);
      if (!local) fail(HELP);
      const current = partsAt(options.now, formatter);
      const date = new Date(utc({ ...current, hour: 0, minute: 0, second: 0 }));
      date.setUTCDate(date.getUTCDate() + (['今天', 'today'].includes(local[1]!.toLowerCase()) ? 0 : ['明天', 'tomorrow'].includes(local[1]!.toLowerCase()) ? 1 : 2));
      const clock = locale === 'en' ? parseClock(local[2]!, undefined) : parseClock(local[3]!, local[2]);
      const desired: CalendarTime = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1,
        day: date.getUTCDate(), ...clock };
      at = localInstant(desired, formatter);
    }
  }
  const delay = at - options.now;
  if (delay > MAX_DELAY) fail('timeRange');
  if (!Number.isSafeInteger(at) || !Number.isFinite(new Date(at).getTime()) || delay < 1000) {
    fail('timeFuture');
  }
  return { at, timezone: options.timezone, expression: text };
  } catch (error) {
    if (locale === 'en' && error instanceof ReminderTimeInputError && error.code) throw new ReminderTimeInputError(t(locale, error.code), error.code);
    throw error;
  }
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

function fail(code: Parameters<typeof t>[1]): never { throw new ReminderTimeInputError(t('zh-CN', code), code); }
function pad(value: number): string { return String(value).padStart(2, '0'); }
function assertInstant(value: number): void {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) fail('timeInstant');
}
function createFormatter(timezone: string): Intl.DateTimeFormat {
  if (typeof timezone !== 'string' || !timezone || timezone.length > 100 || timezone !== timezone.trim() || /^[+-]/u.test(timezone)) {
    fail('timeZone');
  }
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', era: 'short' });
  } catch { fail('timeZone'); }
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
  if (!Number.isFinite(local)) fail('timeDateRange');
  return local - Math.floor(at / 1000) * 1000;
}
function localInstant(desired: CalendarTime, formatter: Intl.DateTimeFormat): number {
  const naive = utc(desired);
  if (!Number.isFinite(naive)) fail('timeDateRange');
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
  if (candidates.length === 0) fail('timeGap');
  if (candidates.length !== 1) fail('timeFold');
  return candidates[0]!;
}
function parseClock(text: string, period: string | undefined): Pick<CalendarTime, 'hour' | 'minute' | 'second'> {
  const colon = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u.exec(text);
  const point = POINT.exec(text);
  if (!colon && !point) fail('timeClock');
  let hour = colon ? Number(colon[1]) : parseInteger(point![1]!);
  const minute = colon ? Number(colon[2]) : point![2] ? 30 : point![3] ? parseInteger(point![3]!) : 0;
  const second = colon ? Number(colon[3] ?? 0) : point![4] ? parseInteger(point![4]!) : 0;
  if (minute > 59 || second > 59 || hour > 23) fail('timeClockRange');
  if (period === '下午' || period === '晚上') {
    if (hour < 1 || hour > 12 || period === '晚上' && hour === 12) fail('timePeriod');
    hour = hour === 12 ? 12 : hour + 12;
  } else if (period === '上午' || period === '凌晨') {
    if (hour > 11) fail('timeMorning');
  } else if (period === '中午') {
    if (hour === 1 || hour === 2) hour += 12;
    else if (hour !== 11 && hour !== 12) fail('timeNoon');
  }
  return { hour, minute, second };
}

function parseInteger(text: string): number {
  if (/^\d+$/u.test(text)) {
    const number = Number(text);
    if (!Number.isSafeInteger(number)) fail('timeNumberRange');
    return number;
  }
  if (/两(?![百千万]|$)/u.test(text)) fail('timeChineseNumber');
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
    fail('timeChineseInteger');
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
