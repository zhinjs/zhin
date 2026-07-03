import type { ResolvedJob, ScatterDayFilter, ScatterRunState } from '../types.js';
import {
  collectAfterHolidayDates,
  collectHolidayEveDates,
} from '../calendar-helpers.js';
import {
  generateDailySlots,
  type ScatterSlotOptions,
} from '../utils/scatter-slots.js';
import { formatDateKey, getDatePartsInTimezone, zonedTimeToUtc } from '../utils/timezone.js';
import { isFreeDay } from './freeDay.js';
import { isHolidayCalendarDay, isWorkday } from './holiday.js';

export type ResolvedScatterJob = Extract<ResolvedJob, { kind: 'scatter' }>;

const MS_PER_DAY = 86_400_000;
const MAX_SCAN_DAYS = 400;

function getSlotOptions(job: ResolvedScatterJob): ScatterSlotOptions {
  return {
    quietHours: job.quietHours,
    minGapMinutes: job.minGapMinutes,
  };
}

export function getDailySlotSeconds(
  job: ResolvedScatterJob,
  jobId: string,
  dateKey: string,
): number[] {
  return generateDailySlots(
    jobId,
    dateKey,
    job.windowStartSec,
    job.windowEndSec,
    job.count,
    getSlotOptions(job),
  );
}

function isScatterDayAllowed(date: Date, job: ResolvedScatterJob): boolean {
  const key = formatDateKey(date, job.timezone);

  if (typeof job.on === 'string') {
    switch (job.on) {
      case 'all':
        return true;
      case 'workday':
        return isWorkday(date, job.timezone);
      case 'freeDay':
        return isFreeDay(date, job.timezone);
      default:
        return false;
    }
  }

  switch (job.on.kind) {
    case 'holiday':
      return isHolidayCalendarDay(
        date,
        job.on.festivals ?? 'all',
        job.on.everyDayOfHoliday ?? false,
        job.timezone,
      );
    case 'holidayEve':
      return collectHolidayEveDates(job.on.festivals ?? 'all', job.on.daysBefore ?? 1).has(key);
    case 'afterHoliday':
      return collectAfterHolidayDates(job.on.festivals, job.on.daysAfter).has(key);
    default:
      return false;
  }
}

export function slotToDate(dateKey: string, slotSec: number, timezone: string): Date {
  const [year, month, day] = dateKey.split('-').map((v) => parseInt(v, 10));
  const hour = Math.floor(slotSec / 3600);
  const minute = Math.floor((slotSec % 3600) / 60);
  const second = slotSec % 60;
  return zonedTimeToUtc(year, month, day, hour, minute, second, timezone);
}

function timeOfDaySeconds(date: Date, timezone: string): number {
  const parts = getDatePartsInTimezone(date, timezone);
  return parts.hour * 3600 + parts.minute * 60 + parts.second;
}

function startOfNextCalendarDay(cursor: Date, timezone: string): Date {
  const parts = getDatePartsInTimezone(cursor, timezone);
  const nextDay = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timezone);
  return new Date(nextDay.getTime() + MS_PER_DAY);
}

export function listScatterSlots(
  job: ResolvedScatterJob,
  jobId: string,
  dateKey: string,
  state: ScatterRunState = { dateKey: '', firedCount: 0 },
): Date[] {
  const parts = dateKey.split('-').map((v) => parseInt(v, 10));
  const probe = zonedTimeToUtc(parts[0], parts[1], parts[2], 12, 0, 0, job.timezone);
  if (!isScatterDayAllowed(probe, job)) {
    return [];
  }

  const firedCount = state.dateKey === dateKey ? state.firedCount : 0;
  const slots = getDailySlotSeconds(job, jobId, dateKey);
  return slots.slice(firedCount).map((sec) => slotToDate(dateKey, sec, job.timezone));
}

export function listScatterSlotsForDay(
  job: ResolvedScatterJob,
  jobId: string,
  dateKey: string,
): Date[] {
  const parts = dateKey.split('-').map((v) => parseInt(v, 10));
  const probe = zonedTimeToUtc(parts[0], parts[1], parts[2], 12, 0, 0, job.timezone);
  if (!isScatterDayAllowed(probe, job)) {
    return [];
  }
  return getDailySlotSeconds(job, jobId, dateKey).map((sec) =>
    slotToDate(dateKey, sec, job.timezone),
  );
}

export function getScatterNextRun(
  from: Date,
  job: ResolvedScatterJob,
  jobId: string,
  state: ScatterRunState = { dateKey: '', firedCount: 0 },
): Date | null {
  let cursor = from;

  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    const dateKey = formatDateKey(cursor, job.timezone);

    if (!isScatterDayAllowed(cursor, job)) {
      cursor = startOfNextCalendarDay(cursor, job.timezone);
      continue;
    }

    const firedCount = state.dateKey === dateKey ? state.firedCount : 0;
    if (firedCount >= job.count) {
      cursor = startOfNextCalendarDay(cursor, job.timezone);
      continue;
    }

    const slots = getDailySlotSeconds(job, jobId, dateKey);

    for (let i = firedCount; i < slots.length; i++) {
      const runAt = slotToDate(dateKey, slots[i], job.timezone);
      if (runAt > from) {
        return runAt;
      }
    }

    cursor = startOfNextCalendarDay(cursor, job.timezone);
  }

  return null;
}

export function isScatterDue(
  at: Date,
  job: ResolvedScatterJob,
  jobId: string,
  state: ScatterRunState = { dateKey: '', firedCount: 0 },
): boolean {
  if (!isScatterDayAllowed(at, job)) {
    return false;
  }

  const dateKey = formatDateKey(at, job.timezone);
  const firedCount = state.dateKey === dateKey ? state.firedCount : 0;
  if (firedCount >= job.count) {
    return false;
  }

  const slots = getDailySlotSeconds(job, jobId, dateKey);
  return timeOfDaySeconds(at, job.timezone) === slots[firedCount];
}

export function getScatterMeta(
  scheduledAt: Date,
  job: ResolvedScatterJob,
  state: ScatterRunState,
): { scatterIndex: number; scatterCount: number; scatterRemaining: number } {
  const dateKey = formatDateKey(scheduledAt, job.timezone);
  const firedCount = state.dateKey === dateKey ? state.firedCount : 0;
  const scatterIndex = firedCount + 1;
  return {
    scatterIndex,
    scatterCount: job.count,
    scatterRemaining: Math.max(0, job.count - firedCount),
  };
}

export function isScatterDayFilter(value: ScatterDayFilter): boolean {
  if (typeof value === 'string') {
    return value === 'all' || value === 'workday' || value === 'freeDay';
  }
  return (
    value.kind === 'holiday' ||
    value.kind === 'holidayEve' ||
    value.kind === 'afterHoliday'
  );
}
