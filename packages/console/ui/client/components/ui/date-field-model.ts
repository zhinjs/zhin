/**
 * Pure date logic of `DateField` / `DateTimeField` (no DOM, no time zone surprises): values are
 * ISO 8601 strings in local time — `YYYY-MM-DD` for a date, `YYYY-MM-DDTHH:mm` for a date and time
 * (the value format of the native `date` / `datetime-local` inputs), `''` when empty.
 */
export interface CalendarDate {
  readonly year: number
  /** 1–12 */
  readonly month: number
  readonly day: number
}

export interface CalendarDateTime extends CalendarDate {
  readonly hour: number
  readonly minute: number
}

const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/u
const DATE_TIME_VALUE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,9})?)?$/u
/** Values with a zone designator (`Z`, `+08:00`) are read through `Date` and shown in local time. */
const ZONED_VALUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function validDate(year: number, month: number, day: number): CalendarDate | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

/** Reads the date part of a date or date-time value; `null` when empty or invalid. */
export function parseDateValue(value: string | null | undefined): CalendarDate | null {
  if (!value) return null
  const date = DATE_VALUE.exec(value)
  if (date) return validDate(Number(date[1]), Number(date[2]), Number(date[3]))
  const dateTime = parseDateTimeValue(value)
  return dateTime ? { year: dateTime.year, month: dateTime.month, day: dateTime.day } : null
}

/** Reads a date-time value (a bare date counts as 00:00); `null` when empty or invalid. */
export function parseDateTimeValue(value: string | null | undefined): CalendarDateTime | null {
  if (!value) return null
  if (ZONED_VALUE.test(value)) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    return { ...fromDate(parsed), hour: parsed.getHours(), minute: parsed.getMinutes() }
  }
  const match = DATE_TIME_VALUE.exec(value)
  if (!match) {
    const date = DATE_VALUE.exec(value)
    const day = date ? validDate(Number(date[1]), Number(date[2]), Number(date[3])) : null
    return day ? { ...day, hour: 0, minute: 0 } : null
  }
  const day = validDate(Number(match[1]), Number(match[2]), Number(match[3]))
  const hour = Number(match[4])
  const minute = Number(match[5])
  if (!day || hour > 23 || minute > 59) return null
  return { ...day, hour, minute }
}

export function formatDateValue(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`
}

export function formatDateTimeValue(value: CalendarDateTime): string {
  return `${formatDateValue(value)}T${pad(value.hour)}:${pad(value.minute)}`
}

export function fromDate(date: Date): CalendarDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return (a.year - b.year) || (a.month - b.month) || (a.day - b.day)
}

export function sameDate(a: CalendarDate | null, b: CalendarDate | null): boolean {
  return a !== null && b !== null && compareDates(a, b) === 0
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDate(new Date(date.year, date.month - 1, date.day + days))
}

/** Same day in another month, clamped to that month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months
  const year = Math.floor(index / 12)
  const month = index - year * 12 + 1
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) }
}

/** Whether `date` is inside `[min, max]` (date parts of the bounds; either bound may be empty). */
export function isWithin(date: CalendarDate, min?: string, max?: string): boolean {
  const low = parseDateValue(min)
  const high = parseDateValue(max)
  return !(low && compareDates(date, low) < 0) && !(high && compareDates(date, high) > 0)
}

export function clampDate(date: CalendarDate, min?: string, max?: string): CalendarDate {
  const low = parseDateValue(min)
  const high = parseDateValue(max)
  if (low && compareDates(date, low) < 0) return low
  if (high && compareDates(date, high) > 0) return high
  return date
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: CalendarDate): number {
  return new Date(date.year, date.month - 1, date.day).getDay()
}

/** First day of the week that contains `date`. */
export function startOfWeek(date: CalendarDate, weekStartsOn: 0 | 1): CalendarDate {
  return addDays(date, -((weekday(date) - weekStartsOn + 7) % 7))
}

/** Six weeks × seven days covering the month (leading / trailing days of the neighbour months included). */
export function calendarMonth(year: number, month: number, weekStartsOn: 0 | 1): CalendarDate[][] {
  const first = startOfWeek({ year, month, day: 1 }, weekStartsOn)
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(first, week * 7 + day)))
}

/** Hour / minute typed into the time boxes: digits only, clamped into range; `null` when not a number. */
export function clampTimePart(text: string, max: number): number | null {
  if (!/^\d{1,2}$/u.test(text.trim())) return null
  return Math.min(Number(text.trim()), max)
}
