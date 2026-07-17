import type { Dispose } from '@zhin.js/plugin-runtime';
import {
  InvalidationPlanner,
  type GenerationInvalidationPlan,
  type InvalidationPlan,
  type ProcessInvalidationPlan,
} from './invalidation-planner.js';
import type { ModuleRuntime } from './module-runtime.js';
import type { SourceOwnershipIndex } from './source-ownership.js';

export interface HmrReloadPort {
  reload(plan: GenerationInvalidationPlan): Promise<ProcessInvalidationPlan | void>;
}

export interface HmrCoordinatorOptions {
  readonly modules: ModuleRuntime;
  readonly ownership: () => SourceOwnershipIndex;
  readonly runtime: HmrReloadPort;
  onRestartRequired(plan: ProcessInvalidationPlan): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
  onPlan?(plan: InvalidationPlan): void | Promise<void>;
}

export class HmrCoordinator {
  readonly #pending = new Set<string>();
  readonly #waiters: Array<{
    resolve(): void;
    reject(error: unknown): void;
  }> = [];
  #draining?: Promise<void>;
  #unwatch?: Dispose;

  constructor(private readonly options: HmrCoordinatorOptions) {}

  start(): Dispose {
    if (this.#unwatch) throw new Error('HmrCoordinator is already started');
    if (!this.options.modules.watch) {
      throw new Error('ModuleRuntime does not provide a file watcher');
    }
    this.#unwatch = this.options.modules.watch((source) => {
      void this.enqueue(source).catch(() => undefined);
    });
    return () => this.stop();
  }

  stop(): void {
    this.#unwatch?.();
    this.#unwatch = undefined;
  }

  enqueue(source: string): Promise<void> {
    this.#pending.add(source);
    const completed = new Promise<void>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
    // Starting on a microtask batches add/change/unlink events emitted for the
    // same filesystem operation into one generation transaction.
    this.#ensureDrain();
    return completed;
  }

  #ensureDrain(): void {
    if (this.#draining) return;
    // Individual enqueue promises carry failures to callers. Keep the shared
    // scheduler promise handled even when an onError hook itself fails.
    this.#draining = Promise.resolve()
      .then(() => this.#drain())
      .catch(() => undefined);
  }

  async #drain(): Promise<void> {
    try {
      while (this.#pending.size > 0) {
        const changed = [...this.#pending];
        this.#pending.clear();
        const forcedRestart = changed.filter((source) =>
          this.options.modules.requiresProcessRestart?.(source),
        );
        if (forcedRestart.length > 0) {
          await this.options.onRestartRequired(Object.freeze({
            kind: 'process',
            changed: Object.freeze(changed),
            reasons: Object.freeze([
              `Module loader cannot safely invalidate: ${forcedRestart.join(', ')}`,
            ]),
          }));
          continue;
        }
        const dependencyPort = this.options.modules.affectedSources
          ? {
              affectedSources: (source: string) =>
                this.options.modules.affectedSources?.(source) ?? [source],
            }
          : undefined;
        const plan = new InvalidationPlanner(this.options.ownership(), dependencyPort).plan(
          changed,
        );
        await this.options.onPlan?.(plan);

        if (plan.kind === 'process') {
          await this.options.onRestartRequired(plan);
          continue;
        }
        if (plan.kind === 'none') continue;

        for (const source of plan.changed) {
          await this.options.modules.invalidate?.(source);
        }
        const restart = await this.options.runtime.reload(plan);
        if (restart) await this.options.onRestartRequired(restart);
      }
      this.#resolveWaiters();
    } catch (error) {
      // A failed transaction invalidates the rest of this burst as well. Do
      // not replay queued paths without their callers explicitly retrying.
      this.#pending.clear();
      try {
        await this.options.onError(error);
      } finally {
        this.#rejectWaiters(error);
      }
    } finally {
      this.#draining = undefined;
      // A source may arrive after the loop observed an empty queue but before
      // this promise settled. Keep its waiter attached to a fresh transaction.
      if (this.#pending.size > 0) this.#ensureDrain();
    }
  }

  #resolveWaiters(): void {
    for (const waiter of this.#waiters.splice(0)) waiter.resolve();
  }

  #rejectWaiters(error: unknown): void {
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}
