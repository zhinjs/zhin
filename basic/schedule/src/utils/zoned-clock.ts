const MS_PER_DAY = 86_400_000;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

export interface ZonedCronParts {
  second: number;
  minute: number;
  hour: number;
  day: number;
  month: number;
  dayOfWeek: number;
}

/**
 * 时区墙钟 seam：所有 ICU 本地化只经此模块，formatter 按 timezone 缓存复用。
 */
export class ZonedClock {
  readonly timezone: string;
  private partsFormatter?: Intl.DateTimeFormat;
  private cronFormatter?: Intl.DateTimeFormat;
  private dateKeyFormatter?: Intl.DateTimeFormat;

  constructor(timezone: string) {
    this.timezone = timezone;
  }

  private getPartsFormatter(): Intl.DateTimeFormat {
    if (!this.partsFormatter) {
      this.partsFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: this.timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        weekday: 'short',
        hour12: false,
      });
    }
    return this.partsFormatter;
  }

  private getCronFormatter(): Intl.DateTimeFormat {
    if (!this.cronFormatter) {
      this.cronFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: this.timezone,
        second: 'numeric',
        minute: 'numeric',
        hour: 'numeric',
        day: 'numeric',
        month: 'numeric',
        weekday: 'short',
        hour12: false,
      });
    }
    return this.cronFormatter;
  }

  private getDateKeyFormatter(): Intl.DateTimeFormat {
    if (!this.dateKeyFormatter) {
      this.dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: this.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
    return this.dateKeyFormatter;
  }

  partsAt(date: Date): ZonedDateParts {
    const parts = this.getPartsFormatter().formatToParts(date);
    const lookup = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    return {
      year: lookup('year'),
      month: lookup('month'),
      day: lookup('day'),
      hour: lookup('hour') % 24,
      minute: lookup('minute'),
      second: lookup('second'),
      dayOfWeek: WEEKDAY_MAP[weekday] ?? 0,
    };
  }

  cronPartsAt(date: Date): ZonedCronParts {
    const parts = this.getCronFormatter().formatToParts(date);
    const lookup = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    return {
      second: lookup('second'),
      minute: lookup('minute'),
      hour: lookup('hour') % 24,
      day: lookup('day'),
      month: lookup('month'),
      dayOfWeek: WEEKDAY_MAP[weekday] ?? 0,
    };
  }

  dateKey(date: Date): string {
    return this.getDateKeyFormatter().format(date);
  }

  offsetMs(date: Date): number {
    const parts = this.getPartsFormatter().formatToParts(date);
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUtc - date.getTime();
  }

  toUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
  ): Date {
    let guess = Date.UTC(year, month - 1, day, hour, minute, second);
    for (let i = 0; i < 3; i++) {
      const offset = this.offsetMs(new Date(guess));
      const adjusted = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
      if (adjusted === guess) {
        break;
      }
      guess = adjusted;
    }
    return new Date(guess);
  }

  /** 跳转到墙钟次日 00:00:00（用于按日扫描） */
  nextLocalDayStart(date: Date): Date {
    const p = this.partsAt(date);
    const midnight = this.toUtc(p.year, p.month, p.day, 0, 0, 0);
    return new Date(midnight.getTime() + MS_PER_DAY);
  }
}

const clockCache = new Map<string, ZonedClock>();

export function getZonedClock(timezone: string): ZonedClock {
  let clock = clockCache.get(timezone);
  if (!clock) {
    clock = new ZonedClock(timezone);
    clockCache.set(timezone, clock);
  }
  return clock;
}

/** 测试用：清空 formatter 缓存 */
export function clearZonedClockCache(): void {
  clockCache.clear();
}
