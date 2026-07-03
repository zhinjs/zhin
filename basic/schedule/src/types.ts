import type { JobStore } from './store/types.js';

export type ScheduleKind = 'solar' | 'lunar' | 'holiday' | 'freeDay' | 'workday' | 'scatter';

export type ScatterMisfirePolicy = 'fire' | 'skip' | 'coalesce';

export type FestivalName =
  | '元旦'
  | '春节'
  | '清明节'
  | '劳动节'
  | '端午节'
  | '中秋节'
  | '国庆节';

export type FestivalFilter = 'all' | FestivalName[];

export interface QuietHoursWindow {
  start: string;
  end: string;
}

export interface JobContext {
  jobId: string;
  kind: ScheduleKind;
  scheduledAt: Date;
  /** 国历文本，如「2024年10月1日」 */
  solarText: string;
  /** 农历文本，如「甲辰年九月初一」 */
  lunarText: string;
  /** 节假日名（法定假日连休区间内时有值，普通周末为 undefined） */
  festival?: FestivalName;
  /** scatter：当天第几次触发（1-based） */
  scatterIndex?: number;
  /** scatter：当天计划触发总次数 */
  scatterCount?: number;
  /** scatter：当天剩余计划触发次数（含本次） */
  scatterRemaining?: number;
  /** scatter：当天全部计划触发时刻（含已触发） */
  scatterSlotsToday?: Date[];
}

export type JobHandler = (ctx: JobContext) => void | Promise<void>;

export interface JobInfo {
  id: string;
  kind: ScheduleKind;
  nextRunAt: Date | null;
  cancel: () => void;
}

export interface JobSnapshot {
  id: string;
  kind: ScheduleKind;
  nextRunAt: Date | null;
  paused: boolean;
  runCount: number;
  maxRuns?: number;
  expiresAt: Date | null;
  handlerKey?: string;
  payload?: unknown;
  cancelled: boolean;
}

export interface SchedulerOptions {
  timezone?: string;
  onError?: (err: Error, job: JobInfo) => void;
  store?: JobStore;
  storePath?: string;
  /** 初始化内置 handler 注册表 */
  handlers?: Record<string, JobHandler>;
  workerId?: string;
  reconcileIntervalMs?: number;
  /** handler 最长执行时间（毫秒），超时走 onError */
  handlerTimeoutMs?: number;
  /** scatter 迟到宽限（毫秒），默认 60_000 */
  misfireGraceMs?: number;
  /**
   * 持久化任务无 handlerKey 时的统一派发（zhin JobWorker 等）。
   * 与 payload 一并调用，不依赖 HandlerRegistry。
   */
  onJob?: (ctx: JobContext, payload: unknown) => void | Promise<void>;
}

/** 可选任务元数据（第 4 参数） */
export interface JobRegisterExtras {
  id?: string;
  payload?: unknown;
  maxRuns?: number;
  expiresAt?: Date | string;
}

/** holiday 专用：6 段 cron（日/月/周须为 `*`）+ 可选节日过滤 */
export interface HolidayInput {
  cron: string;
  festivals?: FestivalFilter;
  everyDayOfHoliday?: boolean;
}

export type ScatterDayFilter =
  | 'all'
  | 'workday'
  | 'freeDay'
  | { kind: 'holiday'; festivals?: FestivalFilter; everyDayOfHoliday?: boolean }
  | { kind: 'holidayEve'; festivals?: FestivalFilter; daysBefore?: number }
  | { kind: 'afterHoliday'; festivals: FestivalFilter; daysAfter: number };

export interface ScatterInput {
  window: { start: string; end: string };
  count: number;
  on: ScatterDayFilter;
  minGapMinutes?: number;
  quietHours?: QuietHoursWindow[];
  misfire?: ScatterMisfirePolicy;
}

/** scatter 任务运行进度，存于 job payload.scatter */
export interface ScatterRunState {
  dateKey: string;
  firedCount: number;
}

export interface ScatterJobPayload {
  scatter: ScatterRunState;
}

export type ResolvedJob =
  | { kind: 'solar'; cron: string; timezone: string }
  | { kind: 'lunar'; cron: string; timezone: string }
  | {
      kind: 'holiday';
      cron: string;
      festivals: FestivalFilter;
      everyDayOfHoliday: boolean;
      timezone: string;
    }
  | { kind: 'freeDay'; cron: string; timezone: string }
  | { kind: 'workday'; cron: string; timezone: string }
  | {
      kind: 'scatter';
      window: { start: string; end: string };
      windowStartSec: number;
      windowEndSec: number;
      count: number;
      on: ScatterDayFilter;
      minGapMinutes: number;
      quietHours: QuietHoursWindow[];
      misfire: ScatterMisfirePolicy;
      timezone: string;
    };

export class InvalidScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScheduleError';
  }
}

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 工作日/休息日/法定假日默认触发时刻：每天 09:00:00（日/月/周由语义决定） */
export const DEFAULT_CALENDAR_CRON = '0 0 9 * * *';

export const DEFAULT_MISFIRE_GRACE_MS = 60_000;
