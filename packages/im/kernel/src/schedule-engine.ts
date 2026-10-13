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
  private readonly onError?: (err: Error, jobId: string) => void;

  constructor(options: ScheduleEngineOptions = {}) {
    this.timezone = options.timezone ?? 'Asia/Shanghai';
    this.onError = options.onError;
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

    // every / at 不经过 CalendarScheduler，需要自行兜住回调异常，避免 unhandledRejection 拖垮进程。
    const fire = (ctx: JobContext): void => {
      void Promise.resolve().then(() => wrapped(ctx)).catch((error: unknown) => this.reportError(error, id));
    };

    if (kind === 'every' && options?.everyMs && options.everyMs > 0) {
      const everyMs = options.everyMs;
      const handle = scheduleLongTimeout(() => {
        fire({ jobId: id, kind: 'solar', scheduledAt: new Date(), solarText: '', lunarText: '' });
        const current = this.meta.get(id);
        if (current) current.nextExecution = new Date(Date.now() + everyMs);
      }, everyMs, true);
      this.timers.set(id, handle.cancel);
      this.meta.set(id, {
        id,
        kind: 'every',
        everyMs,
        running: true,
        nextExecution: new Date(Date.now() + everyMs),
      });
      return () => this.unregister(id);
    }

    if (kind === 'at' && options?.atMs) {
      const atMs = options.atMs;
      const delay = atMs - Date.now();
      if (delay <= 0) {
        return () => this.unregister(id);
      }
      const handle = scheduleLongTimeout(() => {
        // 先注销再回调：回调里若用同一 id 重新注册，不会被随后的注销误删。
        if (this.timers.get(id) === handle.cancel) this.unregister(id);
        fire({ jobId: id, kind: 'solar', scheduledAt: new Date(atMs), solarText: '', lunarText: '' });
      }, delay, false);
      this.timers.set(id, handle.cancel);
      this.meta.set(id, {
        id,
        kind: 'at',
        atMs,
        running: true,
        nextExecution: new Date(atMs),
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

  private reportError(error: unknown, jobId: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (this.onError) {
      try {
        this.onError(err, jobId);
        return;
      } catch {
        // onError 自身抛错时退回 console，避免二次 unhandledRejection
      }
    }
    console.error(`[ScheduleEngine] job ${jobId} failed:`, err);
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

/** Node 定时器上限（约 24.8 天）；超过会被截断为 1ms 并立即触发。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** 支持超过 MAX_TIMER_DELAY_MS 的 setTimeout / setInterval 语义（分段等待）。 */
function scheduleLongTimeout(
  callback: () => void,
  delayMs: number,
  repeat: boolean,
): { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const arm = (remaining: number): void => {
    if (cancelled) return;
    const step = Math.min(remaining, MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      if (cancelled) return;
      const left = remaining - step;
      if (left > 0) {
        arm(left);
        return;
      }
      if (repeat) arm(delayMs);
      callback();
    }, step);
  };
  arm(delayMs);
  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
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
