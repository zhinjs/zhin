export interface CronFields {
  second: number[];
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

const SECOND = 0;
const MINUTE = 1;
const HOUR = 2;
const DAY = 3;
const MONTH = 4;
const DOW = 5;

function expandField(
  part: string,
  min: number,
  max: number,
  sundayZero = false,
): number[] {
  const values = new Set<number>();

  const addRange = (start: number, end: number, step: number) => {
    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  };

  for (const segment of part.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) {
      throw new Error(`Invalid cron field: ${part}`);
    }

    let base = trimmed;
    let step = 1;
    if (trimmed.includes('/')) {
      const [left, right] = trimmed.split('/');
      base = left || '*';
      step = parseInt(right, 10);
      if (Number.isNaN(step) || step < 1) {
        throw new Error(`Invalid cron step: ${trimmed}`);
      }
    }

    if (base === '*') {
      addRange(min, max, step);
      continue;
    }

    if (base.includes('-')) {
      const [startStr, endStr] = base.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error(`Invalid cron range: ${trimmed}`);
      }
      addRange(start, end, step);
      continue;
    }

    const value = parseInt(base, 10);
    if (Number.isNaN(value)) {
      throw new Error(`Invalid cron value: ${trimmed}`);
    }
    if (value >= min && value <= max) {
      if (step === 1) {
        values.add(value);
      } else {
        addRange(value, max, step);
      }
    }
  }

  let result = [...values].sort((a, b) => a - b);

  if (sundayZero && result.includes(0)) {
    result = result.filter((v) => v !== 0);
    if (!result.includes(7)) {
      result.push(7);
    }
    result.sort((a, b) => a - b);
  }

  if (result.length === 0) {
    throw new Error(`Empty cron field: ${part}`);
  }

  return result;
}

/** Parse 6-field cron: second minute hour day-of-month month day-of-week */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 6) {
    throw new Error(`Cron expression must have 6 fields, got ${parts.length}`);
  }

  return {
    second: expandField(parts[SECOND], 0, 59),
    minute: expandField(parts[MINUTE], 0, 59),
    hour: expandField(parts[HOUR], 0, 23),
    dayOfMonth: expandField(parts[DAY], 1, 31),
    month: expandField(parts[MONTH], 1, 12),
    dayOfWeek: expandField(parts[DOW], 0, 7, true),
  };
}

// calendar cron：日/月/周须为 *；秒/分/时可含步进（与 solar 相同）
export function validateCalendarCron(cron: string): CronFields {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 6) {
    throw new Error(`Cron expression must have 6 fields, got ${parts.length}`);
  }
  for (let i = 3; i < 6; i++) {
    if (parts[i] !== '*') {
      throw new Error('Calendar cron requires * for day, month, and weekday fields');
    }
  }

  return parseCron(cron);
}

/** 从「仅含精确时刻」的 calendar cron 提取时/分/秒；步进表达式请用 parseCron */
export function parseCronTime(cron: string): { hour: number; minute: number; second: number } {
  const fields = validateCalendarCron(cron);
  for (const [name, values] of [
    ['second', fields.second],
    ['minute', fields.minute],
    ['hour', fields.hour],
  ] as const) {
    if (values.length !== 1) {
      throw new Error(`parseCronTime requires exact ${name}; use parseCron for step expressions`);
    }
  }
  return {
    second: fields.second[0],
    minute: fields.minute[0],
    hour: fields.hour[0],
  };
}

export function matchesCron(fields: CronFields, date: Date, timezone: string): boolean {
  const parts = getCronDateParts(date, timezone);
  const dow = parts.dayOfWeek === 0 ? 7 : parts.dayOfWeek;

  const secondMatch = fields.second.includes(parts.second);
  const minuteMatch = fields.minute.includes(parts.minute);
  const hourMatch = fields.hour.includes(parts.hour);
  const monthMatch = fields.month.includes(parts.month);
  const dowMatch = fields.dayOfWeek.includes(dow);
  const domMatch = fields.dayOfMonth.includes(parts.day);

  const domWildcard = fields.dayOfMonth.length === 31;
  const dowWildcard =
    fields.dayOfWeek.length === 8 ||
    (fields.dayOfWeek.length === 7 && fields.dayOfWeek.every((d) => d >= 0 && d <= 7));

  let dayMatch: boolean;
  if (!domWildcard && !dowWildcard) {
    dayMatch = domMatch || dowMatch;
  } else if (!domWildcard) {
    dayMatch = domMatch;
  } else if (!dowWildcard) {
    dayMatch = dowMatch;
  } else {
    dayMatch = true;
  }

  return secondMatch && minuteMatch && hourMatch && monthMatch && dayMatch;
}

export function getCronDateParts(
  date: Date,
  timezone: string,
): {
  second: number;
  minute: number;
  hour: number;
  day: number;
  month: number;
  dayOfWeek: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    second: 'numeric',
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';

  return {
    second: lookup('second'),
    minute: lookup('minute'),
    hour: lookup('hour') % 24,
    day: lookup('day'),
    month: lookup('month'),
    dayOfWeek: weekdayMap[weekday] ?? 0,
  };
}
