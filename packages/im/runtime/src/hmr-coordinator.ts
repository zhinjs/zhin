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
  /** Fires once after a generation transaction commits successfully. */
  onReload?(plan: GenerationInvalidationPlan, durationMs: number): void | Promise<void>;
}

export class HmrCoordinator {
  readonly #pending = new Set<string>();
  readonly #waiters: Array<{
    resolve(): void;
    reject(error: unknown): void;
  }> = [];
  #draining?: Promise<void>;
  #unwatch?: Dispose;
  #closing = false;
  #restartRequired = false;
  #stopResult?: Promise<void>;

  constructor(private readonly options: HmrCoordinatorOptions) {}

  start(): Dispose {
    if (this.#unwatch) throw new Error('HmrCoordinator is already started');
    if (this.#closing) throw new Error('HmrCoordinator has been stopped');
    if (this.#restartRequired) throw new Error('HmrCoordinator requires a process restart');
    if (!this.options.modules.watch) {
      throw new Error('ModuleRuntime does not provide a file watcher');
    }
    this.#syncWatchRoots();
    this.#unwatch = this.options.modules.watch((source) => {
      void this.enqueue(source).catch(() => undefined);
    });
    return () => this.stop();
  }

  stop(): Promise<void> {
    if (this.#stopResult) return this.#stopResult;
    this.#closing = true;
    this.#unwatch?.();
    this.#unwatch = undefined;
    this.#stopResult = (async () => {
      await this.#draining;
    })();
    return this.#stopResult;
  }

  enqueue(source: string): Promise<void> {
    if (this.#closing) {
      return Promise.reject(new Error('HMR coordinator is stopping'));
    }
    if (this.#restartRequired) {
      return Promise.reject(new Error('HMR coordinator requires a process restart'));
    }
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
          this.#restartRequired = true;
          this.#pending.clear();
          this.#notifyRestart(Object.freeze({
            kind: 'process',
            changed: Object.freeze(changed),
            reasons: Object.freeze([
              `Module loader cannot safely invalidate: ${forcedRestart.join(', ')}`,
            ]),
          }));
          break;
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

        if (plan.kind === 'process') {
          this.#restartRequired = true;
          this.#pending.clear();
          this.#notifyPlan(plan);
          this.#notifyRestart(plan);
          break;
        }
        this.#notifyPlan(plan);
        if (plan.kind === 'none') continue;

        const startedAt = performance.now();
        for (const source of plan.changed) {
          await this.options.modules.invalidate?.(source);
        }
        const restart = await this.options.runtime.reload(plan);
        if (restart) {
          this.#restartRequired = true;
          this.#pending.clear();
          this.#notifyRestart(restart);
          break;
        }
        else {
          // reload resolves only after RootController has committed the new
          // generation. Read ownership now so failed transactions never make
          // newly discovered workspace packages observable to the watcher.
          this.#syncWatchRoots();
          const durationMs = Number((performance.now() - startedAt).toFixed(1));
          try {
            await this.options.onReload?.(plan, durationMs);
          } catch (error) {
            // A projection/observer cannot change an already committed reload.
            try {
              await this.options.onError(error);
            } catch {
              // Diagnostic reporting is deliberately outside the outcome.
            }
          }
        }
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
      if (!this.#closing && !this.#restartRequired && this.#pending.size > 0) this.#ensureDrain();
    }
  }

  #resolveWaiters(): void {
    for (const waiter of this.#waiters.splice(0)) waiter.resolve();
  }

  #rejectWaiters(error: unknown): void {
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  #syncWatchRoots(): void {
    this.options.modules.updateWatchRoots?.(this.options.ownership().watchRoots());
  }

  #notifyRestart(plan: ProcessInvalidationPlan): void {
    // Restart is a committed control outcome. Invoke the observer without
    // awaiting it so a Process Host may await RootHost.stop() without waiting
    // on the HMR drain that is currently delivering this notification.
    try {
      void Promise.resolve(this.options.onRestartRequired(plan)).catch((error) => {
        this.#reportDiagnostic(error);
      });
    } catch (error) {
      this.#reportDiagnostic(error);
    }
  }

  #notifyPlan(plan: InvalidationPlan): void {
    if (!this.options.onPlan) return;
    try {
      void Promise.resolve(this.options.onPlan(plan)).catch((error) => {
        this.#reportDiagnostic(error);
      });
    } catch (error) {
      this.#reportDiagnostic(error);
    }
  }

  #reportDiagnostic(error: unknown): void {
    try {
      void Promise.resolve(this.options.onError(error)).catch(() => undefined);
    } catch {
      // Diagnostic reporting cannot change an invalidation outcome.
    }
  }
}
