import { pluginOwnerResourceKey, rootPluginId, type PluginId } from './identity.js';
import { createToken } from './token.js';

/**
 * Thin Host Resource for Plugin Runtime cron jobs.
 * Implementations typically wrap `@zhin.js/schedule` CalendarScheduler (solar cron).
 */
export interface ScheduleJobRegistration {
  readonly id: string;
  /** Runtime-assigned owner for diagnostics and Console inventory. */
  readonly owner?: PluginId;
  /** 6-field solar cron: `秒 分 时 日 月 周` */
  readonly cron: string;
  readonly description?: string;
  execute(): void | Promise<void>;
}

export interface ScheduleHost {
  /** Register a solar cron job; returns disposer that cancels the job. */
  register(job: ScheduleJobRegistration): () => void;
  list(): readonly {
    readonly id: string;
    readonly cron: string;
    readonly description?: string;
    readonly owner?: PluginId;
  }[];
}

/** Scoped scheduling surface exposed to a Plugin setup function. */
export interface PluginScheduleHost {
  readonly owner: PluginId;
  register(job: ScheduleJobRegistration): () => void;
  list(): readonly {
    readonly id: string;
    readonly cron: string;
    readonly description?: string;
  }[];
}

const jobPrefix = '__zhin_plugin__';
const jobSeparator = '__';
const roots = new WeakMap<PluginScheduleHost, ScheduleHost>();

export function qualifyPluginScheduleId(owner: PluginId, id: string): string {
  assertLogicalJobId(id);
  if (owner === rootPluginId()) return id;
  return `${jobPrefix}${pluginOwnerResourceKey(owner)}${jobSeparator}${id}`;
}

export function unqualifyPluginScheduleId(owner: PluginId, id: string): string | undefined {
  if (owner === rootPluginId()) return id.startsWith(jobPrefix) ? undefined : id;
  const prefix = `${jobPrefix}${pluginOwnerResourceKey(owner)}${jobSeparator}`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : undefined;
}

export function createPluginScheduleHost(owner: PluginId, host: ScheduleHost): PluginScheduleHost {
  const facade = Object.freeze({
    owner,
    register(job: ScheduleJobRegistration) {
      return host.register({ ...job, id: qualifyPluginScheduleId(owner, job.id), owner });
    },
    list() {
      return Object.freeze(host.list().flatMap((job) => {
        const id = unqualifyPluginScheduleId(owner, job.id);
        if (id === undefined) return [];
        return [Object.freeze({
          id,
          cron: job.cron,
          ...(job.description === undefined ? {} : { description: job.description }),
        })];
      }));
    },
  });
  roots.set(facade, host);
  return facade;
}

/** See unwrapPluginDatabaseHost: preserves legacy custom RootResource installers. */
export function unwrapPluginScheduleHost(host: ScheduleHost | PluginScheduleHost): ScheduleHost {
  return roots.get(host as PluginScheduleHost) ?? host;
}

function assertLogicalJobId(id: string): void {
  if (!id || id.startsWith(jobPrefix)) {
    throw new TypeError(`Invalid plugin schedule id: ${id}`);
  }
}

/** Plugin-facing token; Runtime injects a facade bound to the current owner. */
export const scheduleHostToken = createToken<PluginScheduleHost>(
  'zhin.schedule.host',
  'Plugin Runtime scoped solar cron host',
);

/** Root-only process scheduler for CLI composition and Console administration. */
export const scheduleRootHostToken = createToken<ScheduleHost>(
  'zhin.schedule.root-host',
  'Plugin Runtime root solar cron host',
);
