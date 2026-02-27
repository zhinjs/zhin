/**
 * Scheduler module — at / every / cron + heartbeat
 */

export type {
  Schedule,
  JobPayload,
  JobState,
  ScheduledJob,
  JobStore,
  JobCallback,
  AddJobOptions,
  IScheduler,
} from './types.js';
export { Scheduler } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';

import type { Scheduler } from './scheduler.js';

let schedulerInstance: Scheduler | null = null;

export function getScheduler(): Scheduler | null {
  return schedulerInstance;
}

export function setScheduler(s: Scheduler | null): void {
  schedulerInstance = s;
}
