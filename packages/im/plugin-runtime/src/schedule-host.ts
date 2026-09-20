import type { PluginId } from './identity.js';
import {
  OwnerScopedResourceHost,
  qualifyOwnedResourceName,
} from './owner-scoped-resource-host.js';
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
export function qualifyPluginScheduleId(owner: PluginId, id: string): string {
  return qualifyOwnedResourceName(owner, id);
}

export class PluginScheduleHost extends OwnerScopedResourceHost {
  constructor(owner: PluginId, private readonly host: ScheduleHost) {
    super(owner);
  }

  register(job: ScheduleJobRegistration): () => void {
    return this.host.register({ ...job, id: this.qualify(job.id), owner: this.owner });
  }

  list(): readonly {
    readonly id: string;
    readonly cron: string;
    readonly description?: string;
  }[] {
    return Object.freeze(this.host.list().flatMap((job) => {
      const id = this.unqualify(job.id);
      if (id === undefined) return [];
      return [Object.freeze({
        id,
        cron: job.cron,
        ...(job.description === undefined ? {} : { description: job.description }),
      })];
    }));
  }
}

/** @public Plugin-facing token; Runtime injects a facade bound to the current owner. */
export const scheduleHostToken = createToken<PluginScheduleHost>(
  'zhin.schedule.host',
  'Plugin Runtime scoped solar cron host',
);

/** Root-only process scheduler for CLI composition and Console administration. */
export const scheduleRootHostToken = createToken<ScheduleHost>(
  'zhin.schedule.root-host',
  'Plugin Runtime root solar cron host',
);
