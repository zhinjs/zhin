/**
 * In-memory schedule engine — wraps @zhin.js/schedule CalendarScheduler
 * for plugin memory tasks and agent job registration.
 */
import {
  CalendarScheduler,
  getNextRun,
  resolveSolarJob,
  resolveLunarJob,
  resolveHolidayJob,
  resolveFreeDayJob,
  resolveWorkdayJob,
  resolveScatterJob,
  type HolidayInput,
  type JobContext,
  type JobInfo,
  type ResolvedJob,
  type ScatterInput,
  type ScheduleKind,
} from '@zhin.js/schedule';

export type ScheduleFireCallback = (ctx: JobContext) => void | Promise<void>;

export interface MemoryScheduleRegistration {
  id: string;
  kind: ScheduleKind | 'every' | 'at';
  expression?: string;
  everyMs?: number;
  atMs?: number;
  running: boolean;
  nextExecution: Date | null;
}

export interface ScheduleEngineOptions {
  timezone?: string;
  onError?: (err: Error, jobId: string) => void;
}

function jobScheduleToResolved(
  kind: ScheduleKind | 'every' | 'at',
  input: {
    cron?: string;
    expr?: string;
    scatterInput?: ScatterInput;
    holidayInput?: HolidayInput;
    tz?: string;
  },
  timezone: string,
): ResolvedJob | null {
  const tz = input.tz ?? timezone;
  const cron = input.cron ?? input.expr;
  switch (kind) {
    case 'solar':
      return cron ? resolveSolarJob(cron, tz) : null;
    case 'lunar':
      return cron ? resolveLunarJob(cron, tz) : null;
    case 'workday':
      return cron ? resolveWorkdayJob(cron, tz) : null;
    case 'freeDay':
      return cron ? resolveFreeDayJob(cron, tz) : null;
    case 'holiday':
      if (input.holidayInput) return resolveHolidayJob(input.holidayInput, tz);
      return cron ? resolveHolidayJob({ cron }, tz) : null;
    case 'scatter':
      return input.scatterInput ? resolveScatterJob(input.scatterInput, tz) : null;
    default:
      return null;
  }
}

export class ScheduleEngine {
  readonly timezone: string;
  private readonly calendar: CalendarScheduler;
  private readonly timers = new Map<string, () => void>();
  private readonly meta = new Map<string, MemoryScheduleRegistration>();
  private readonly callbacks = new Map<string, ScheduleFireCallback>();
  private disposed = false;

  constructor(options: ScheduleEngineOptions = {}) {
    this.timezone = options.timezone ?? 'Asia/Shanghai';
    this.calendar = new CalendarScheduler({
      timezone: this.timezone,
      onError: options.onError
        ? (err: Error, job: JobInfo) => options.onError!(err, job.id)
        : undefined,
    });
  }

  register(
    id: string,
    kind: ScheduleKind | 'every' | 'at',
    callback: ScheduleFireCallback,
    options?: {
      cron?: string;
      expr?: string;
      everyMs?: number;
      atMs?: number;
      scatterInput?: ScatterInput;
      holidayInput?: HolidayInput;
      tz?: string;
    },
  ): () => void {
    if (this.disposed) {
      throw new Error('ScheduleEngine has been disposed');
    }
    this.unregister(id);

    const wrapped: ScheduleFireCallback = async (ctx) => {
      await callback(ctx);
    };
    this.callbacks.set(id, wrapped);

    if (kind === 'every' && options?.everyMs && options.everyMs > 0) {
      const timer = setInterval(() => {
        void wrapped({
          jobId: id,
          kind: 'solar',
          scheduledAt: new Date(),
          solarText: '',
          lunarText: '',
        });
      }, options.everyMs);
      this.timers.set(id, () => clearInterval(timer));
      this.meta.set(id, {
        id,
        kind: 'every',
        everyMs: options.everyMs,
        running: true,
        nextExecution: new Date(Date.now() + options.everyMs),
      });
      return () => this.unregister(id);
    }

    if (kind === 'at' && options?.atMs) {
      const delay = options.atMs - Date.now();
      if (delay <= 0) {
        return () => this.unregister(id);
      }
      const timer = setTimeout(() => {
        void wrapped({
          jobId: id,
          kind: 'solar',
          scheduledAt: new Date(options.atMs!),
          solarText: '',
          lunarText: '',
        });
        this.unregister(id);
      }, delay);
      this.timers.set(id, () => clearTimeout(timer));
      this.meta.set(id, {
        id,
        kind: 'at',
        atMs: options.atMs,
        running: true,
        nextExecution: new Date(options.atMs),
      });
      return () => this.unregister(id);
    }

    const resolved = jobScheduleToResolved(kind as ScheduleKind, options ?? {}, this.timezone);
    if (!resolved) {
      throw new Error(`Invalid schedule registration for job ${id}`);
    }

    const info = this.calendar.registerResolved(resolved, (ctx: JobContext) => wrapped(ctx), { id });
    this.timers.set(id, () => info.cancel());
    this.meta.set(id, {
      id,
      kind: resolved.kind,
      expression: options?.cron ?? options?.expr,
      running: true,
      nextExecution: info.nextRunAt,
    });
    return () => this.unregister(id);
  }

  registerResolved(id: string, resolved: ResolvedJob, callback: ScheduleFireCallback): () => void {
    if (this.disposed) {
      throw new Error('ScheduleEngine has been disposed');
    }
    this.unregister(id);
    const wrapped: ScheduleFireCallback = async (ctx) => {
      await callback(ctx);
    };
    this.callbacks.set(id, wrapped);
    const info = this.calendar.registerResolved(resolved, (ctx: JobContext) => wrapped(ctx), { id });
    this.timers.set(id, () => info.cancel());
    this.meta.set(id, {
      id,
      kind: resolved.kind,
      running: true,
      nextExecution: info.nextRunAt,
    });
    return () => this.unregister(id);
  }

  unregister(id: string): boolean {
    const dispose = this.timers.get(id);
    if (dispose) {
      dispose();
      this.timers.delete(id);
      this.meta.delete(id);
      this.callbacks.delete(id);
      return true;
    }
    return false;
  }

  pause(id: string): boolean {
    return this.calendar.pause(id);
  }

  resume(id: string): boolean {
    return this.calendar.resume(id);
  }

  getStatus(): MemoryScheduleRegistration[] {
    return [...this.meta.values()].map((m) => {
      const snap = this.calendar.get(m.id);
      return {
        ...m,
        running: snap ? !snap.paused && !snap.cancelled : m.running,
        nextExecution: snap?.nextRunAt ?? m.nextExecution,
      };
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.timers.keys()]) {
      this.unregister(id);
    }
    this.calendar.stop();
  }
}

let globalEngine: ScheduleEngine | null = null;

export function getScheduleEngine(): ScheduleEngine | null {
  return globalEngine;
}

export function setScheduleEngine(engine: ScheduleEngine | null): void {
  globalEngine = engine;
}

export {
  resolveSolarJob,
  resolveLunarJob,
  resolveHolidayJob,
  resolveFreeDayJob,
  resolveWorkdayJob,
  resolveScatterJob,
  getNextRun,
};
export type { JobContext, ResolvedJob, ScheduleKind };
