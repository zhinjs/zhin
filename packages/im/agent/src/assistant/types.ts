/**
 * Schedule Runtime — 统一 Job 模型
 */
import type { FestivalName, HolidayInput, ScatterInput } from '@zhin.js/kernel';
import type { IMDeliveryTarget } from '@zhin.js/core';

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
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  nextRunAtMs?: number;
  retryCount?: number;
}

export interface ScheduleJob {
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
  eventPayload?: unknown;
}

/** @deprecated use ScheduleJob */
export type AssistantJob = ScheduleJob;

/** @deprecated */
export type AssistantJobState = ScheduleJobState;
/** @deprecated */
export type AssistantJobFile = ScheduleJobFile;

export interface ScheduleJobFile {
  version: number;
  jobs: ScheduleJob[];
}

/** @deprecated */
export const ASSISTANT_JOBS_VERSION = SCHEDULE_JOBS_VERSION;
/** @deprecated */
export const ASSISTANT_JOBS_FILENAME = SCHEDULE_JOBS_FILENAME;

export type { HolidayInput, ScatterInput, FestivalName };
