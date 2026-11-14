import { CalendarScheduler } from '@zhin.js/schedule';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  scheduleHostToken,
  scheduleRootHostToken,
  PluginScheduleHost,
  rootPluginId,
  type PluginId,
  type ScheduleHost,
  type ScheduleJobDisplay,
  type ScheduleJobLastRun,
  type ScheduleJobRegistration,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const logger = getLogger('Schedule');

/** `TZ` wins; otherwise the zone this process actually runs in, not a hard-coded one. */
export function resolveScheduleTimezone(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  systemTimezone: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return environment.TZ || systemTimezone() || 'UTC';
}

function displayOf(job: ScheduleJobDisplay): ScheduleJobDisplay {
  return {
    ...(typeof job.title === 'string' && job.title.trim() ? { title: job.title.trim() } : {}),
    ...(job.titleI18n && typeof job.titleI18n === 'object' ? { titleI18n: Object.freeze({ ...job.titleI18n }) } : {}),
    kind: job.kind === 'user-task' ? 'user-task' : 'plugin-internal',
  };
}

export function createScheduleHost(now: () => number = Date.now): ScheduleHost & { stop(): void } {
  const scheduler = new CalendarScheduler({
    timezone: resolveScheduleTimezone(),
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
    display: ScheduleJobDisplay;
  };
  const jobs = new Map<string, Map<string, Registration>>();
  // Keyed by logical id so a hot-reloaded generation keeps showing the last real outcome.
  const lastRuns = new Map<string, ScheduleJobLastRun>();
  let sequence = 0;
  const visible = (id: string): Registration | undefined =>
    [...(jobs.get(id)?.values() ?? [])].reverse().find(job => job.isActive?.() !== false);

  return {
    register(job: ScheduleJobRegistration): () => void {
      const physicalId = `zhin.runtime.schedule.${++sequence}`;
      scheduler.solar(job.cron, async () => {
        if (visible(job.id)?.physicalId !== physicalId) return;
        const startedAt = now();
        try {
          await job.execute();
          lastRuns.set(job.id, Object.freeze({ startedAt, finishedAt: now(), status: 'succeeded' }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lastRuns.set(job.id, Object.freeze({ startedAt, finishedAt: now(), status: 'failed', error: message.slice(0, 500) }));
          logger.warn(formatCompact({
            op: 'schedule_execute_failed',
            id: job.id,
            error: message,
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
        display: displayOf(job),
      });
      jobs.set(job.id, registrations);
      logger.debug(formatCompact({ op: 'schedule_register', id: job.id, cron: job.cron }));
      return () => {
        // Each generation owns only its physical registration. Rollback keeps
        // the previous job, and retirement cannot cancel the newly published one.
        scheduler.cancel(physicalId);
        registrations.delete(physicalId);
        if (registrations.size === 0) { jobs.delete(job.id); lastRuns.delete(job.id); }
      };
    },
    list() {
      return Object.freeze([...jobs.keys()].flatMap((id) => {
        const meta = visible(id);
        if (!meta) return [];
        const snap = scheduler.get(meta.physicalId);
        const lastRun = lastRuns.get(id);
        return [Object.freeze({
          id,
          cron: meta.cron,
          description: meta.description,
          owner: meta.owner,
          ...meta.display,
          ...(lastRun ? { lastRun } : {}),
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
      lastRuns.clear();
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
