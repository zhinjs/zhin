/**
 * Schedule Runtime — 统一 Job 模型
 */
import type { FestivalName, HolidayInput, ScatterInput } from '@zhin.js/kernel';
import type { ChatRole, IMDeliveryTarget } from '@zhin.js/core';
import type { ScheduleBudgetConfig } from '../config/zhin-agent-config.js';

export const SCHEDULE_JOBS_VERSION = 1;
export const SCHEDULE_JOBS_FILENAME = 'schedule-jobs.json';

export type JobSchedule =
  | { kind: 'solar'; cron: string; tz?: string }
  | { kind: 'lunar'; cron: string; tz?: string }
  | { kind: 'workday'; cron: string; tz?: string }
  | { kind: 'freeDay'; cron: string; tz?: string }
  | { kind: 'holiday'; cron: string; festivals?: FestivalName[] | 'all'; everyDayOfHoliday?: boolean; tz?: string }
  | { kind: 'scatter'; input: ScatterInput; tz?: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'at'; atMs: number; deleteAfterRun?: boolean }
  | { kind: 'event'; eventId?: string; source?: string; eventType?: string };

export type JobAction =
  | { kind: 'agent'; prompt: string; agent?: string }
  | { kind: 'heartbeat'; prompt: string };

export type JobNotify =
  | { channel: 'im'; target: IMDeliveryTarget }
  | { channel: 'silent' }
  | { channel: 'log' }
  | { channel: 'ha'; service: string; target?: string; data?: Record<string, unknown> };

export interface ScheduleJobState {
  lastExecutedAt?: number;
  /** `degraded` (#1250 b33): the run finished but did not do what was asked; `lastError` says why. */
  lastStatus?: 'ok' | 'error' | 'skipped' | 'degraded';
  lastError?: string;
  nextRunAtMs?: number;
  retryCount?: number;
}

/** 调度任务创建者（对话内 schedule_add 等场景持久化，执行时还原 harness 角色） */
export interface ScheduleJobCreator {
  userId: string;
  /**
   * Expanded host-trust chat roles at creation (ADR 0056), or `['user']`. A due run re-reads the
   * creator's current role through `chat` and uses that instead (see `currentScheduleCreator`).
   */
  roles: readonly (ChatRole | 'user')[];
  name?: string;
  /** Where the creator spoke (IM-created jobs): the address the creator's current role is read from. */
  chat?: Readonly<{ conversation: import('@zhin.js/plugin-runtime').DeliveryTarget; endpointId: string }>;
}

export interface ScheduleJob {
  /** Captured at creation; changes to personal or project preferences do not alter it. */
  locale?: import('@zhin.js/plugin-runtime').Locale;
  id: string;
  label?: string;
  enabled: boolean;
  schedule: JobSchedule;
  action: JobAction;
  notify: JobNotify;
  notifyOnFailure?: boolean;
  createdAt: number;
  updatedAt: number;
  state: ScheduleJobState;
  source?: 'schedule' | 'manual' | 'event' | 'profile';
  /** 创建者身份（执行 agent 时用于 exec/file 策略） */
  createdBy?: ScheduleJobCreator;
  /** 预演确认后的执行计划（prompt / tools / skills） */
  executionPlan?: ScheduleJobExecutionPlan;
  /** 到点执行时是否向 IM 发送 activity feedback（reaction/typing），默认 false */
  activityFeedback?: boolean;
  /** 覆盖全局无人值守执行预算。 */
  budget?: ScheduleBudgetConfig;
  eventPayload?: unknown;
  /**
   * ADR 0067 D2.1: set when the model created this job in a turn that had already read tool output,
   * web pages, background messages or other recorded content (trusted first-party output included).
   * Every due run (and the preview) then starts as if it had read external content, so its writes,
   * messages to other conversations, configuration changes and shell commands are confirmed or, being
   * unattended, denied. Absent on jobs created by a person (Console, RPC, profile) and on jobs stored
   * before this field existed.
   */
  provenance?: ScheduleJobProvenance;
}

/** ADR 0067 D2.1: what the creating turn had read when the job was created. */
export interface ScheduleJobProvenance {
  readonly tainted: true;
  /** Source keys of the creating turn (`tool:web_fetch`, `conversation_context`, ...), at most ten. */
  readonly sources: readonly string[];
}

/** 预演后固化的调度路径 */
export interface ScheduleJobExecutionPlan {
  /** 到点实际使用的 prompt（可经预演 refine） */
  prompt: string;
  tools?: string[];
  skills?: string[];
  /** 预演样例输出（供创建者确认） */
  previewSample?: string;
  previewedAt?: number;
  confirmed?: boolean;
}

export interface ScheduleJobFile {
  version: number;
  jobs: ScheduleJob[];
}

export type { HolidayInput, ScatterInput, FestivalName };
