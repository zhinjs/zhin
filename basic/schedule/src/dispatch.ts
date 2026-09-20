import type { ResolvedJob, ScatterRunState } from './types.js';
import { HolidayCalendar } from './holiday-calendar.js';
import { getSolarNextRun, isSolarDue } from './resolvers/solar.js';
import { getLunarNextRun, isLunarDue } from './resolvers/lunar.js';
import { getHolidayNextRun, isHolidayDue } from './resolvers/holiday.js';
import { getFreeDayNextRun, isFreeDayDue } from './resolvers/freeDay.js';
import { getWorkdayNextRun, isWorkdayDue } from './resolvers/workday.js';
import { getScatterNextRun, isScatterDue } from './resolvers/scatter.js';

export interface GetNextRunOptions {
  jobId?: string;
  scatterState?: ScatterRunState;
  holidays?: HolidayCalendar;
}

export function getNextRun(
  job: ResolvedJob,
  from: Date = new Date(),
  options?: GetNextRunOptions,
): Date | null {
  switch (job.kind) {
    case 'solar':
      return getSolarNextRun(from, job.cron, job.timezone);
    case 'lunar':
      return getLunarNextRun(from, job.cron, job.timezone);
    case 'holiday':
      return getHolidayNextRun(from, job, options?.holidays ?? new HolidayCalendar());
    case 'freeDay':
      return getFreeDayNextRun(from, job, options?.holidays ?? new HolidayCalendar());
    case 'workday':
      return getWorkdayNextRun(from, job, options?.holidays ?? new HolidayCalendar());
    case 'scatter':
      if (!options?.jobId) {
        return null;
      }
      return getScatterNextRun(
        from,
        job,
        options.jobId,
        options.scatterState ?? { dateKey: '', firedCount: 0 },
        options.holidays ?? new HolidayCalendar(),
      );
    default:
      return null;
  }
}

export function isJobDue(
  job: ResolvedJob,
  at: Date,
  options?: GetNextRunOptions,
): boolean {
  switch (job.kind) {
    case 'solar':
      return isSolarDue(at, job.cron, job.timezone);
    case 'lunar':
      return isLunarDue(at, job.cron, job.timezone);
    case 'holiday':
      return isHolidayDue(at, job, options?.holidays ?? new HolidayCalendar());
    case 'freeDay':
      return isFreeDayDue(at, job, options?.holidays ?? new HolidayCalendar());
    case 'workday':
      return isWorkdayDue(at, job, options?.holidays ?? new HolidayCalendar());
    case 'scatter':
      if (!options?.jobId) {
        return false;
      }
      return isScatterDue(
        at,
        job,
        options.jobId,
        options.scatterState ?? { dateKey: '', firedCount: 0 },
        options.holidays ?? new HolidayCalendar(),
      );
    default:
      return false;
  }
}
