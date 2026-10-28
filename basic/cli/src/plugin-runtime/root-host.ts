import {
  NativeDevelopmentModuleRuntime,
  RootRuntime,
  type HmrCoordinator,
  type EnvironmentLayers,
  type EnvironmentLayersPort,
  type InvalidationPlan,
  type ModuleRuntime,
  type ProcessInvalidationPlan,
  type RootResourceInstaller,
  type RuntimeEnvironment,
} from '@zhin.js/runtime';
import type {
  ConfigDocumentPort,
  Dispose,
  RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';

import { createTsxModuleLoader } from './start/module.js';

export interface RootHostOptions {
  readonly projectRoot: string;
  readonly config?: RuntimeConfigDocument | ConfigDocumentPort;
  readonly environment?: RuntimeEnvironment;
  readonly environmentVariables?: EnvironmentLayers;
  readonly environmentSource?: EnvironmentLayersPort;
  readonly modules?: ModuleRuntime;
  readonly installResources?: RootResourceInstaller;
  readonly disabledPluginInstanceKeys?: readonly string[];
  readonly watch?: boolean;
  onRestartRequired?(plan: ProcessInvalidationPlan): void | Promise<void>;
  onError?(error: unknown): void | Promise<void>;
  onPlan?(plan: InvalidationPlan): void | Promise<void>;
  onReload?(
    plan: Extract<InvalidationPlan, { kind: 'generation' }>,
    generation: number,
    durationMs: number,
  ): void | Promise<void>;
  /**
   * Generation commit 回调（包括初始 start 与后续 HMR/config patch）。
   * 用于 Console `hmr:reload` SSE 推送。
   */
  onGenerationCommit?(generation: number): void;
}

export interface RootHostSnapshot {
  readonly generation: number;
  readonly plugins: number;
  readonly capabilities: number;
  readonly projections: number;
}

/** Owns one Root process lifecycle; callers own signals and restart policy. */
export class RootHost {
  readonly runtime: RootRuntime;
  readonly #watch: boolean;
  readonly #onRestartRequired: NonNullable<RootHostOptions['onRestartRequired']>;
  readonly #onError: NonNullable<RootHostOptions['onError']>;
  readonly #onPlan?: RootHostOptions['onPlan'];
  readonly #onReload?: RootHostOptions['onReload'];
  readonly #stopGenerationObservation: () => void;
  #stopHmr?: Dispose;
  #hmr?: HmrCoordinator;
  /** The HMR path has asked for a process restart (it never reloads again in this process). */
  #restartPending = false;
  #started = false;
  #stopPromise?: Promise<void>;

  constructor(options: RootHostOptions) {
    const modules = options.modules ?? new NativeDevelopmentModuleRuntime({
      projectRoot: options.projectRoot,
      watch: options.watch,
      tsxLoader: createTsxModuleLoader(options.projectRoot),
    });
    this.#watch = options.watch ?? true;
    this.#onRestartRequired = options.onRestartRequired ?? (() => undefined);
    this.#onError = options.onError ?? (() => undefined);
    this.#onPlan = options.onPlan;
    this.#onReload = options.onReload;
    this.runtime = new RootRuntime({
      projectRoot: options.projectRoot,
      modules,
      config: options.config,
      installResources: options.installResources,
      environmentVariables: options.environmentVariables,
      environmentSource: options.environmentSource,
      environment: options.environment ?? {
        name: 'development',
        mode: 'development',
        platform: 'node',
      },
      disabledPluginInstanceKeys: options.disabledPluginInstanceKeys,
      onControlError: (error) => {
        void Promise.resolve(this.#onError(error)).catch(() => undefined);
      },
    });
    this.#stopGenerationObservation = this.runtime.onGenerationCommit(
      ({ current }) => options.onGenerationCommit?.(current.snapshot.generation),
    );
  }

  async start(): Promise<RootHostSnapshot> {
    if (this.#started) throw new Error('RootHost is already started');
    this.#started = true;
    try {
      const snapshot = await this.runtime.start();
      if (this.#watch) this.#startHmr();
      return describeSnapshot(snapshot);
    } catch (error) {
      await this.runtime.stop().catch(() => undefined);
      throw error;
    }
  }

  /**
   * ADR 0040 §5: reload explicitly written sources through the same HMR path as file watching
   * (module invalidation + `InvalidationPlanner`), also under `--no-watch`. Returns `restart` when the
   * change needs a process restart; the restart itself stays with `onRestartRequired` / the caller.
   */
  async reloadSources(sources: readonly string[]): Promise<'reloaded' | 'restart'> {
    if (!this.#started) throw new Error('RootHost is not started');
    if (this.#stopPromise) throw new Error('RootHost is stopping');
    if (this.#restartPending) return 'restart';
    const hmr = this.#hmr ?? this.#startHmr();
    try {
      await Promise.all(sources.map(source => hmr.enqueue(source)));
    } catch (error) {
      if (this.#restartPending) return 'restart';
      throw error;
    }
    return this.#restartPending ? 'restart' : 'reloaded';
  }

  #startHmr(): HmrCoordinator {
    const hmr = this.runtime.createHmrCoordinator({
      onRestartRequired: (plan) => {
        this.#restartPending = true;
        return this.#onRestartRequired(plan);
      },
      onError: this.#onError,
      onPlan: this.#onPlan,
      onReload: (plan, durationMs) =>
        this.#onReload?.(plan, this.runtime.snapshot.generation, durationMs),
    });
    // Without `watch` the module runtime's watcher is a no-op; the coordinator only serves reloadSources().
    this.#stopHmr = hmr.start();
    this.#hmr = hmr;
    return hmr;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = (async () => {
      await this.#stopHmr?.();
      this.#stopHmr = undefined;
      this.#hmr = undefined;
      try {
        if (this.#started) await this.runtime.stop();
      } finally {
        this.#stopGenerationObservation();
      }
    })();
    return this.#stopPromise;
  }
}

export function describeSnapshot(snapshot: RootRuntime['snapshot']): RootHostSnapshot {
  return Object.freeze({
    generation: snapshot.generation,
    plugins: snapshot.tree.size,
    capabilities: snapshot.capabilities.size,
    projections: snapshot.projections.size,
  });
}
