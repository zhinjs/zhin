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
  /** @internal Process Host visibility follows atomic generation publication. */
  readonly isActive?: () => boolean;
  execute(): void | Promise<void>;
}

export interface ScheduleHost {
  /**
   * Register a solar cron job; its disposer cancels only this registration.
   * Overlapping generations may share a logical id. Preserve both until their
   * disposers run, and use isActive to select the published registration.
   */
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

const stageRegistration: unique symbol = Symbol('StageScheduleRegistration');
const prepareProjection: unique symbol = Symbol('PrepareScheduleProjection');

/** @internal Each Schedule projection owns its own candidate registration gate. */
export function createPluginScheduleCandidate(host: PluginScheduleHost, gate: GenerationAdmissionGate): PluginScheduleHost {
  return host[prepareProjection](gate);
}

/** @internal Schedule Feature stages candidate jobs before atomic publication. */
export function stagePluginScheduleRegistration(host: PluginScheduleHost, job: ScheduleJobRegistration): () => void {
  return host[stageRegistration](job);
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
    return this.#operation.setup(() => this.#register(job));
  }

  /** @internal Runtime-only candidate preparation; the key is private to this module. */
  [stageRegistration](job: ScheduleJobRegistration): () => void {
    return this.#operation.stage(() => this.#register(job));
  }

  /** @internal Derive a fresh candidate without reopening this owner facade. */
  [prepareProjection](gate: GenerationAdmissionGate): PluginScheduleHost {
    return this.#operation.prepareProjection(() => {
      const candidate = new PluginScheduleHost(super.owner, this.#host, gate);
      candidate[scopeSetupFinalizer]('seal');
      return candidate;
    });
  }

  #register(job: ScheduleJobRegistration): () => void {
    return this.#host.register({ ...job, id: this.qualify(job.id), owner: super.owner,
      isActive: () => this.#admission?.active ?? true,
      execute: () => this.#operation.run(() => job.execute()),
    });
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
    facade[scopeSetupFinalizer]('dispose');
    return facade;
  }

  /** @internal Scope-owned declaration window. */
  [scopeSetupFinalizer](reason: 'seal' | 'dispose' = 'seal'): void { this.#operation.endSetup(reason); }

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
