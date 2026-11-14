import { normalizeSourcePath } from './source-path.js';
import type { Dispose } from '@zhin.js/plugin-runtime';
import {
  InvalidationPlanner,
  type GenerationInvalidationPlan,
  type InvalidationPlan,
  type ProcessInvalidationPlan,
} from './invalidation-planner.js';
import type { ModuleRuntime } from './module-runtime.js';
import { isEditorTempFile } from './editor-temp-file.js';
import { ManifestChangeTracker, type ManifestFieldChange } from './manifest-change.js';
import { basename, join } from 'node:path';
import type { SourceOwnershipIndex } from './source-ownership.js';
import type { HmrReloadReport } from './root-runtime-diagnostics.js';

export type { HmrRebuildKind, HmrReloadReport } from './root-runtime-diagnostics.js';

export interface HmrReloadPort {
  handlesSource?(source: string): boolean;
  /** Resolves with a restart plan, or with what the committed generation actually rebuilt. */
  reload(plan: GenerationInvalidationPlan): Promise<ProcessInvalidationPlan | HmrReloadReport | void>;
}

export interface HmrCoordinatorOptions {
  readonly modules: ModuleRuntime;
  readonly ownership: () => SourceOwnershipIndex;
  readonly runtime: HmrReloadPort;
  /** Filters automatic watch events only. Explicit enqueue requests always retain their meaning. */
  readonly acceptWatchedSource?: (source: string) => boolean;
  onRestartRequired(plan: ProcessInvalidationPlan): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
  onPlan?(plan: InvalidationPlan): void | Promise<void>;
  /**
   * A watched `package.json` changed only in fields that cannot affect the Runtime (`scripts`,
   * `description`, ...): the event is dropped without a reload or restart (#1250).
   */
  onManifestIgnored?(change: ManifestFieldChange): void | Promise<void>;
  /** Reads a `package.json` for field comparison; defaults to the file system. */
  readonly readManifest?: (source: string) => string;
  /**
   * Quiet period for automatic watch events (default {@link DEFAULT_WATCH_DEBOUNCE_MS}). Events
   * arriving within it are merged into one reload request: atomic saves (`sed -i`, editors writing
   * a temp file and renaming it) and batch changes (`git checkout`) report one path several times
   * across macrotasks, which the microtask batch of {@link HmrCoordinator.enqueue} cannot merge
   * (#1250). Explicit {@link HmrCoordinator.enqueue} calls are never delayed. `0` disables it.
   */
  readonly watchDebounceMs?: number;
  /** Fires once after a generation transaction commits successfully. */
  onReload?(plan: GenerationInvalidationPlan, durationMs: number, report?: HmrReloadReport): void | Promise<void>;
}

/** Debounce window for watch events; covers the ~250 ms gap seen between `sed -i` events (#1250). */
export const DEFAULT_WATCH_DEBOUNCE_MS = 300;

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
  /** Watch events waiting for the debounce window to close. */
  readonly #debounced = new Set<string>();
  #debounceTimer?: ReturnType<typeof setTimeout>;
  /** Sources requested through {@link enqueue}: they keep their meaning, whatever changed in them. */
  readonly #explicit = new Set<string>();
  readonly #manifests: ManifestChangeTracker;

  constructor(private readonly options: HmrCoordinatorOptions) {
    this.#manifests = new ManifestChangeTracker(options.readManifest);
  }

  start(): Dispose {
    if (this.#unwatch) throw new Error('HmrCoordinator is already started');
    if (this.#closing) throw new Error('HmrCoordinator has been stopped');
    if (this.#restartRequired) throw new Error('HmrCoordinator requires a process restart');
    if (!this.options.modules.watch) {
      throw new Error('ModuleRuntime does not provide a file watcher');
    }
    this.#syncModuleState();
    this.#unwatch = this.options.modules.watch((source) => {
      // Any ModuleRuntime watcher may report editor temp/backup files; they never reload (#857).
      if (isEditorTempFile(source)) return;
      if (this.options.acceptWatchedSource && !this.options.acceptWatchedSource(source)) return;
      this.#admitWatched(source);
    });
    return () => this.stop();
  }

  stop(): Promise<void> {
    if (this.#stopResult) return this.#stopResult;
    this.#closing = true;
    // Debounced events were never admitted: a stopping coordinator drops them.
    this.#clearDebounce();
    const unwatch = this.#unwatch;
    this.#unwatch = undefined;
    this.#stopResult = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      try { await unwatch?.(); } catch (error) { errors.push(error); }
      // Watcher disposal failure must not bypass already admitted reloads.
      try { await this.#draining; } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'HMR stop failed');
    });
    return this.#stopResult;
  }

  enqueue(source: string): Promise<void> {
    return this.#enqueue(source, true);
  }

  #enqueue(source: string, explicit: boolean): Promise<void> {
    if (this.#closing) {
      return Promise.reject(new Error('HMR coordinator is stopping'));
    }
    if (this.#restartRequired) {
      return Promise.reject(new Error('HMR coordinator requires a process restart'));
    }
    const normalized = normalizeSourcePath(source);
    this.#pending.add(normalized);
    if (explicit) this.#explicit.add(normalized);
    const completed = new Promise<void>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
    // Starting on a microtask batches add/change/unlink events emitted for the
    // same filesystem operation into one generation transaction.
    this.#ensureDrain();
    return completed;
  }

  #admitWatched(source: string): void {
    const delay = this.options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
    if (delay <= 0) {
      void this.#enqueue(source, false).catch(() => undefined);
      return;
    }
    this.#debounced.add(normalizeSourcePath(source));
    // Trailing debounce: every event restarts the quiet period, so a burst becomes one request.
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined;
      const sources = [...this.#debounced];
      this.#debounced.clear();
      if (this.#closing || this.#restartRequired) return;
      // Synchronous enqueues share one microtask drain: the burst is one generation transaction.
      for (const item of sources) void this.#enqueue(item, false).catch(() => undefined);
    }, delay);
    // A pending debounce must not keep a process alive on its own.
    this.#debounceTimer.unref?.();
  }

  #clearDebounce(): void {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = undefined;
    this.#debounced.clear();
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
        const explicit = new Set(this.#explicit);
        this.#explicit.clear();
        const manifestChanges: ManifestFieldChange[] = [];
        const changed = [...this.#pending].filter((source) => {
          if (basename(source) !== 'package.json') return true;
          const change = this.#manifests.diff(source);
          if (!change) return true;
          if (change.runtimeFields.length > 0 || explicit.has(source)) {
            manifestChanges.push(change);
            return true;
          }
          this.#notifyManifestIgnored(change);
          return false;
        });
        this.#pending.clear();
        if (changed.length === 0) continue;
        const withManifests = (plan: ProcessInvalidationPlan): ProcessInvalidationPlan => (
          manifestChanges.length > 0 ? Object.freeze({ ...plan, manifestChanges: Object.freeze(manifestChanges) }) : plan
        );
        const forcedRestart = changed.filter((source) => (
          !this.options.runtime.handlesSource?.(source)
          && this.options.modules.requiresProcessRestart?.(source)
        ));
        if (forcedRestart.length > 0) {
          this.#restartRequired = true;
          this.#pending.clear();
          this.#notifyRestart(withManifests(Object.freeze({
            kind: 'process',
            changed: Object.freeze(changed),
            reasons: Object.freeze([
              `Module loader cannot safely invalidate: ${forcedRestart.join(', ')}`,
            ]),
          })));
          break;
        }
        const dependencyPort = this.options.modules.affectedSources
          ? {
              affectedSources: (source: string) =>
                this.options.modules.affectedSources?.(source) ?? [source],
              staleDependents: (source: string) =>
                this.options.modules.staleDependents?.(source) ?? [],
            }
          : undefined;
        const plan = new InvalidationPlanner(this.options.ownership(), dependencyPort).plan(
          changed,
        );

        if (plan.kind === 'process') {
          this.#restartRequired = true;
          this.#pending.clear();
          this.#notifyPlan(plan);
          this.#notifyRestart(withManifests(plan));
          break;
        }
        this.#notifyPlan(plan);
        if (plan.kind === 'none') continue;

        const startedAt = performance.now();
        try {
          this.options.modules.beginGeneration?.();
          for (const source of plan.changed) {
            await this.options.modules.invalidate?.(source);
          }
          const result = await this.options.runtime.reload(plan);
          const restart = result?.kind === 'process' ? result : undefined;
          const report = result?.kind === 'reloaded' ? result : undefined;
          if (restart) {
            this.options.modules.rollbackGeneration?.();
            this.#restartRequired = true;
            this.#pending.clear();
            this.#notifyRestart(withManifests(restart));
            break;
          }

          // reload resolves only after RootController has committed the new
          // generation. Commit module metadata and ownership together so a
          // failed transaction keeps the previous dependency graph intact.
          this.#syncModuleState();
          const durationMs = Number((performance.now() - startedAt).toFixed(1));
          try {
            await this.options.onReload?.(plan, durationMs, report);
          } catch (error) {
            // A projection/observer cannot change an already committed reload.
            try {
              await this.options.onError(error);
            } catch {
              // Diagnostic reporting is deliberately outside the outcome.
            }
          }
        } catch (error) {
          this.options.modules.rollbackGeneration?.();
          throw error;
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

  #syncModuleState(): void {
    const ownership = this.options.ownership();
    this.options.modules.updateWatchRoots?.(ownership.watchRoots());
    this.options.modules.updateRevisionableRoots?.(ownership.revisionableRoots());
    this.options.modules.commitGeneration?.(ownership.moduleSources());
    // Baselines for field comparison of the manifests this generation was built from.
    if (this.options.modules.watch) {
      this.#manifests.prime([
        ...ownership.manifestSources(),
        ...ownership.watchRoots().map((root) => join(root.root, 'package.json')),
      ]);
    }
  }

  #notifyManifestIgnored(change: ManifestFieldChange): void {
    if (!this.options.onManifestIgnored) return;
    try {
      void Promise.resolve(this.options.onManifestIgnored(change)).catch((error) => {
        this.#reportDiagnostic(error);
      });
    } catch (error) {
      this.#reportDiagnostic(error);
    }
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
