import { CalendarScheduler } from '@zhin.js/schedule';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  scheduleHostToken,
  type ScheduleHost,
  type ScheduleJobRegistration,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const logger = getLogger('Schedule');

export function createScheduleHost(): ScheduleHost & { stop(): void } {
  const scheduler = new CalendarScheduler({
    timezone: process.env.TZ || 'Asia/Shanghai',
    onError: (error, job) => {
      logger.warn(formatCompact({
        op: 'schedule_job_error',
        id: job?.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    },
  });
  const jobs = new Map<string, { cron: string; description?: string }>();

  return {
    register(job: ScheduleJobRegistration): () => void {
      if (jobs.has(job.id)) {
        scheduler.cancel(job.id);
        jobs.delete(job.id);
      }
      scheduler.solar(job.cron, async () => {
        try {
          await job.execute();
        } catch (error) {
          logger.warn(formatCompact({
            op: 'schedule_execute_failed',
            id: job.id,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }, job.id, { id: job.id });
      jobs.set(job.id, { cron: job.cron, description: job.description });
      logger.debug(formatCompact({ op: 'schedule_register', id: job.id, cron: job.cron }));
      return () => {
        scheduler.cancel(job.id);
        jobs.delete(job.id);
      };
    },
    list() {
      return Object.freeze([...jobs.entries()].map(([id, meta]) => Object.freeze({
        id,
        cron: meta.cron,
        description: meta.description,
      })));
    },
    stop() {
      scheduler.stop();
      jobs.clear();
    },
  };
}

export function installScheduleHost(): RootResourceInstaller {
  return ({ resources, lifecycle }) => {
    const host = createScheduleHost();
    resources.provide(scheduleHostToken, host);
    lifecycle.add(() => host.stop());
  };
}
