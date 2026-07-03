export interface CronAtOptions {
  /** 公历日 1–31；默认 `*` */
  day?: number | '*';
  /** 公历月 1–12；默认 `*` */
  month?: number | '*';
  /** 星期 0–7（0 与 7 均为周日）；默认 `*` */
  dayOfWeek?: number | '*';
}

function assertInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}, got ${value}`);
  }
}

function field(value: number | '*'): string {
  return value === '*' ? '*' : String(value);
}

function fmtStepField(value: number | string): string {
  return typeof value === 'number' ? String(value) : value;
}

/** 组装 6 段 cron：`秒 分 时 日 月 周` */
export function buildCron(parts: {
  second?: number | string;
  minute?: number | string;
  hour?: number | string;
  day?: number | '*';
  month?: number | '*';
  dayOfWeek?: number | '*';
}): string {
  const second = parts.second ?? 0;
  const minute = parts.minute ?? 0;
  const hour = parts.hour ?? 0;
  const day = parts.day ?? '*';
  const month = parts.month ?? '*';
  const dayOfWeek = parts.dayOfWeek ?? '*';

  if (typeof second === 'number') {
    assertInt('second', second, 0, 59);
  }
  if (typeof minute === 'number') {
    assertInt('minute', minute, 0, 59);
  }
  if (typeof hour === 'number') {
    assertInt('hour', hour, 0, 23);
  }
  if (day !== '*') {
    assertInt('day', day, 1, 31);
  }
  if (month !== '*') {
    assertInt('month', month, 1, 12);
  }
  if (dayOfWeek !== '*') {
    assertInt('dayOfWeek', dayOfWeek, 0, 7);
  }

  return [
    fmtStepField(second),
    fmtStepField(minute),
    fmtStepField(hour),
    field(day),
    field(month),
    field(dayOfWeek),
  ].join(' ');
}

/**
 * 构造触发时刻。
 *
 * - `at(9)` / `at(9, 0)` / `at(9, 0, 30)` → calendar cron（日/月/周为 `*`），适用于 workday / freeDay / holiday
 * - `at(9, 0, { dayOfWeek: 1 })` → 每周一 9:00，适用于 solar
 * - `at(9, 0, 30, { day: 1, month: 1 })` → 每年 1 月 1 日 9:00:30
 */
export function at(
  hour: number,
  minute = 0,
  secondOrOptions: number | CronAtOptions = 0,
  options?: CronAtOptions,
): string {
  assertInt('hour', hour, 0, 23);
  assertInt('minute', minute, 0, 59);

  let second = 0;
  let opts: CronAtOptions = {};

  if (typeof secondOrOptions === 'number') {
    second = secondOrOptions;
    assertInt('second', second, 0, 59);
    opts = options ?? {};
  } else if (typeof secondOrOptions === 'object') {
    opts = secondOrOptions;
  }

  return buildCron({
    hour,
    minute,
    second,
    day: opts.day ?? '*',
    month: opts.month ?? '*',
    dayOfWeek: opts.dayOfWeek ?? '*',
  });
}

/** calendar cron 别名：日/月/周固定为 `*` */
export function calendar(hour: number, minute = 0, second = 0): string {
  return at(hour, minute, second);
}

// 每 N 分钟（solar）
export function everyMinutes(step: number): string {
  assertInt('step', step, 1, 59);
  return `0 */${step} * * * *`;
}

// 每 N 秒（solar）
export function everySeconds(step: number): string {
  assertInt('step', step, 1, 59);
  return `*/${step} * * * * *`;
}

// 每 N 小时（solar）
export function everyHours(step: number): string {
  assertInt('step', step, 1, 23);
  return `0 0 */${step} * * *`;
}

export const cron = {
  at,
  calendar,
  build: buildCron,
  everyMinutes,
  everySeconds,
  everyHours,
};
