import type { PluginId } from './identity.js';
import {
  OwnerScopedResourceHost,
  qualifyOwnedResourceName,
} from './owner-scoped-resource-host.js';
import { createToken, createRootPrivateToken, scopeSetupFinalizer } from './token.js';
import { generationAdmissionBinder, generationAdmissionSource, type GenerationAdmissionGate } from './admission.js';
import { OwnerOperation } from './owner-operation.js';

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
  readonly #host: ScheduleHost;
  readonly #admission?: GenerationAdmissionGate;
  readonly #operation: OwnerOperation;

  constructor(owner: PluginId, host: ScheduleHost, admission?: GenerationAdmissionGate) {
    super(owner);
    this.#host = host;
    this.#admission = admission;
    this.#operation = new OwnerOperation(admission, 'Schedule');
  }

  register(job: ScheduleJobRegistration): () => void {
    return this.#operation.setup(() => this.#host.register({ ...job, id: this.qualify(job.id), owner: super.owner,
      execute: () => this.#operation.run(() => job.execute()),
    }));
  }

  list(): readonly {
    readonly id: string;
    readonly cron: string;
    readonly description?: string;
  }[] {
    return this.#operation.setup(() => Object.freeze(this.#host.list().flatMap((job) => {
      const id = this.unqualify(job.id);
      if (id === undefined) return [];
      return [Object.freeze({
        id,
        cron: job.cron,
        ...(job.description === undefined ? {} : { description: job.description }),
      })];
    })));
  }

  /** @internal Bound by generation publication. */
  [generationAdmissionBinder](gate: GenerationAdmissionGate): PluginScheduleHost {
    const facade = new PluginScheduleHost(super.owner, this.#host, gate);
    facade[scopeSetupFinalizer]();
    return facade;
  }

  /** @internal Scope-owned declaration window. */
  [scopeSetupFinalizer](): void { this.#operation.endSetup(); }

  /** @internal Admission source collected by the Runtime. */
  get [generationAdmissionSource](): readonly GenerationAdmissionGate[] {
    return this.#admission ? [this.#admission] : [];
  }
}

/** @public Plugin-facing token; Runtime injects a facade bound to the current owner. */
export const scheduleHostToken = createToken<PluginScheduleHost>(
  'zhin.schedule.host',
  'Plugin Runtime scoped solar cron host',
);

/** Root-only process scheduler for CLI composition and Console administration. */
export const scheduleRootHostToken = createRootPrivateToken<ScheduleHost>(
  'zhin.schedule.root-host',
  'Plugin Runtime root solar cron host',
);
