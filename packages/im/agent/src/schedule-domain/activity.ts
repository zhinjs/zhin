import type { JobNotify, ScheduleJob } from '../assistant/types.js';
import type { ScheduleInvocationContext } from '../assistant/schedule-job-service.js';

export interface ScheduleActivityEvent {
  readonly phase: 'start' | 'finish' | 'error';
  readonly job: ScheduleJob;
  readonly previewSource?: ScheduleInvocationContext;
  readonly notify: JobNotify;
}

export interface ScheduleActivityPort {
  publish(event: ScheduleActivityEvent): void | Promise<void>;
}
