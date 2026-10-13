import { CalendarScheduler } from '@zhin.js/schedule';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  scheduleHostToken,
  scheduleRootHostToken,
  PluginScheduleHost,
  rootPluginId,
  type PluginId,
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
  type Registration = {
    cron: string;
    description?: string;
    owner?: PluginId;
    physicalId: string;
    isActive?: () => boolean;
  };
  const jobs = new Map<string, Map<string, Registration>>();
  let sequence = 0;
  const visible = (id: string): Registration | undefined =>
    [...(jobs.get(id)?.values() ?? [])].reverse().find(job => job.isActive?.() !== false);

  return {
    register(job: ScheduleJobRegistration): () => void {
      const physicalId = `zhin.runtime.schedule.${++sequence}`;
      scheduler.solar(job.cron, async () => {
        if (visible(job.id)?.physicalId !== physicalId) return;
        try {
          await job.execute();
        } catch (error) {
          logger.warn(formatCompact({
            op: 'schedule_execute_failed',
            id: job.id,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }, '', { id: physicalId });
      const registrations = jobs.get(job.id) ?? new Map<string, Registration>();
      registrations.set(physicalId, {
        cron: job.cron,
        description: job.description,
        owner: job.owner,
        physicalId,
        isActive: job.isActive,
      });
      jobs.set(job.id, registrations);
      logger.debug(formatCompact({ op: 'schedule_register', id: job.id, cron: job.cron }));
      return () => {
        // Each generation owns only its physical registration. Rollback keeps
        // the previous job, and retirement cannot cancel the newly published one.
        scheduler.cancel(physicalId);
        registrations.delete(physicalId);
        if (registrations.size === 0) jobs.delete(job.id);
      };
    },
    list() {
      return Object.freeze([...jobs.keys()].flatMap((id) => {
        const meta = visible(id);
        if (!meta) return [];
        const snap = scheduler.get(meta.physicalId);
        return [Object.freeze({
          id,
          cron: meta.cron,
          description: meta.description,
          owner: meta.owner,
          // console cron 页字段：expression/running/plugin/nextExecution
          expression: meta.cron,
          running: snap ? !snap.paused && !snap.cancelled : true,
          nextExecution: snap?.nextRunAt ? snap.nextRunAt.getTime() : undefined,
          plugin: meta.owner ?? id.split('/')[0],
        })];
      }));
    },
    stop() {
      scheduler.stop();
      jobs.clear();
    },
  };
}

export function installScheduleHost(host?: ScheduleHost & { stop(): void }): RootResourceInstaller {
  return ({ resources, lifecycle, admission }) => {
    const instance = host ?? createScheduleHost();
    resources.provide(scheduleRootHostToken, instance);
    resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), instance, admission));
    // A supplied Host is process-owned and intentionally shared by overlapping
    // generations. Only an instance created by this installer belongs to Scope.
    if (!host) lifecycle.add(() => instance.stop());
  };
}
