import { createToken } from './token.js';

/**
 * Thin Host Resource for Plugin Runtime cron jobs.
 * Implementations typically wrap `@zhin.js/schedule` CalendarScheduler (solar cron).
 */
export interface ScheduleJobRegistration {
  readonly id: string;
  /** 6-field solar cron: `秒 分 时 日 月 周` */
  readonly cron: string;
  readonly description?: string;
  execute(): void | Promise<void>;
}

export interface ScheduleHost {
  /** Register a solar cron job; returns disposer that cancels the job. */
  register(job: ScheduleJobRegistration): () => void;
  list(): readonly { readonly id: string; readonly cron: string; readonly description?: string }[];
}

export const scheduleHostToken = createToken<ScheduleHost>(
  'zhin.schedule.host',
  'Plugin Runtime solar cron host',
);
