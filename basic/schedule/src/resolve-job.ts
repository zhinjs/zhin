import { parseCron, validateCalendarCron } from './parsers/cron.js';
import {
  InvalidScheduleError,
  DEFAULT_TIMEZONE,
  type HolidayInput,
  type ResolvedJob,
  type ScatterDayFilter,
  type ScatterInput,
} from './types.js';
import { isScatterDayFilter } from './resolvers/scatter.js';
import { canFitScatterCount, parseTimeOfDay } from './utils/scatter-slots.js';

const SCATTER_VALIDATION_JOB_ID = '__scatter_validate__';
const SCATTER_VALIDATION_DATE_KEY = '2024-06-15';

function validateCron(cron: string): void {
  try {
    parseCron(cron);
  } catch (err) {
    throw new InvalidScheduleError(
      err instanceof Error ? err.message : 'Invalid cron expression',
    );
  }
}

function validateLunarCron(cron: string): void {
  let fields;
  try {
    fields = parseCron(cron);
  } catch (err) {
    throw new InvalidScheduleError(
      err instanceof Error ? err.message : 'Invalid lunar cron expression',
    );
  }
  for (const [name, values] of [
    ['second', fields.second],
    ['minute', fields.minute],
    ['hour', fields.hour],
  ] as const) {
    if (values.length !== 1) {
      throw new InvalidScheduleError(
        `Lunar cron requires exact ${name}; wildcards are not supported`,
      );
    }
  }
}

function validateCalendarScheduleCron(cron: string): void {
  try {
    validateCalendarCron(cron);
  } catch (err) {
    throw new InvalidScheduleError(
      err instanceof Error ? err.message : 'Invalid calendar cron expression',
    );
  }
}

function validateScatterDayFilter(on: ScatterDayFilter): void {
  if (!isScatterDayFilter(on)) {
    throw new InvalidScheduleError('Invalid scatter day filter');
  }
  if (typeof on === 'object' && on.kind === 'afterHoliday' && !on.festivals) {
    throw new InvalidScheduleError('afterHoliday filter requires festivals');
  }
}

function validateQuietHours(quietHours: ScatterInput['quietHours']): void {
  if (!quietHours) {
    return;
  }
  for (const window of quietHours) {
    try {
      parseTimeOfDay(window.start);
      parseTimeOfDay(window.end);
    } catch (err) {
      throw new InvalidScheduleError(
        err instanceof Error ? err.message : 'Invalid scatter quiet hours',
      );
    }
  }
}

export function resolveSolarJob(
  cron: string,
  timezone: string = DEFAULT_TIMEZONE,
): ResolvedJob {
  validateCron(cron);
  return { kind: 'solar', cron, timezone };
}

export function resolveLunarJob(
  cron: string,
  timezone: string = DEFAULT_TIMEZONE,
): ResolvedJob {
  validateLunarCron(cron);
  return { kind: 'lunar', cron, timezone };
}

export function resolveHolidayJob(
  input: HolidayInput,
  timezone: string = DEFAULT_TIMEZONE,
): ResolvedJob {
  validateCalendarScheduleCron(input.cron);
  return {
    kind: 'holiday',
    cron: input.cron,
    festivals: input.festivals ?? 'all',
    everyDayOfHoliday: input.everyDayOfHoliday ?? false,
    timezone,
  };
}

export function resolveFreeDayJob(
  cron: string,
  timezone: string = DEFAULT_TIMEZONE,
): ResolvedJob {
  validateCalendarScheduleCron(cron);
  return { kind: 'freeDay', cron, timezone };
}

export function resolveWorkdayJob(
  cron: string,
  timezone: string = DEFAULT_TIMEZONE,
): ResolvedJob {
  validateCalendarScheduleCron(cron);
  return { kind: 'workday', cron, timezone };
}

export function resolveScatterJob(
  input: ScatterInput,
  timezone: string = DEFAULT_TIMEZONE,
): ResolvedJob {
  let windowStartSec: number;
  let windowEndSec: number;
  try {
    windowStartSec = parseTimeOfDay(input.window.start);
    windowEndSec = parseTimeOfDay(input.window.end);
  } catch (err) {
    throw new InvalidScheduleError(err instanceof Error ? err.message : 'Invalid scatter window');
  }

  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new InvalidScheduleError('Scatter count must be a positive integer');
  }

  if (windowStartSec >= windowEndSec) {
    throw new InvalidScheduleError('Scatter window start must be before end');
  }

  const span = windowEndSec - windowStartSec + 1;
  if (input.count > span) {
    throw new InvalidScheduleError('Scatter count exceeds window capacity');
  }

  validateScatterDayFilter(input.on);
  validateQuietHours(input.quietHours);

  if (input.minGapMinutes != null) {
    if (!Number.isInteger(input.minGapMinutes) || input.minGapMinutes < 0) {
      throw new InvalidScheduleError('Scatter minGapMinutes must be a non-negative integer');
    }
  }

  if (input.misfire != null && input.misfire !== 'fire' && input.misfire !== 'skip' && input.misfire !== 'coalesce') {
    throw new InvalidScheduleError('Invalid scatter misfire policy');
  }

  const slotOptions = {
    quietHours: input.quietHours,
    minGapMinutes: input.minGapMinutes ?? 0,
  };

  if (
    !canFitScatterCount(
      SCATTER_VALIDATION_JOB_ID,
      SCATTER_VALIDATION_DATE_KEY,
      windowStartSec,
      windowEndSec,
      input.count,
      slotOptions,
    )
  ) {
    throw new InvalidScheduleError(
      'Scatter count exceeds window capacity with minGap/quietHours',
    );
  }

  return {
    kind: 'scatter',
    window: input.window,
    windowStartSec,
    windowEndSec,
    count: input.count,
    on: input.on,
    minGapMinutes: input.minGapMinutes ?? 0,
    quietHours: input.quietHours ?? [],
    misfire: input.misfire ?? 'fire',
    timezone,
  };
}
