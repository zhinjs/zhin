import {
  NativeDevelopmentModuleRuntime,
  RootRuntime,
  type EnvironmentLayers,
  type InvalidationPlan,
  type ModuleRuntime,
  type ProcessInvalidationPlan,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
  type RuntimeEnvironment,
  type ConfigDocumentPort,
} from '@zhin.js/runtime';

export interface RootHostOptions {
  readonly projectRoot: string;
  readonly config?: RuntimeConfigDocument | ConfigDocumentPort;
  readonly environment?: RuntimeEnvironment;
  readonly environmentVariables?: EnvironmentLayers;
  readonly modules?: ModuleRuntime;
  readonly installResources?: RootResourceInstaller;
  readonly watch?: boolean;
  onRestartRequired?(plan: ProcessInvalidationPlan): void | Promise<void>;
  onError?(error: unknown): void | Promise<void>;
  onPlan?(plan: InvalidationPlan): void | Promise<void>;
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
  #stopHmr?: () => void;
  #started = false;
  #stopPromise?: Promise<void>;

  constructor(options: RootHostOptions) {
    const modules = options.modules ?? new NativeDevelopmentModuleRuntime({
      projectRoot: options.projectRoot,
      watch: options.watch,
    });
    this.#watch = options.watch ?? true;
    this.#onRestartRequired = options.onRestartRequired ?? (() => undefined);
    this.#onError = options.onError ?? (() => undefined);
    this.#onPlan = options.onPlan;
    this.runtime = new RootRuntime({
      projectRoot: options.projectRoot,
      modules,
      config: options.config,
      installResources: options.installResources,
      environmentVariables: options.environmentVariables,
      environment: options.environment ?? {
        name: 'development',
        mode: 'development',
        platform: 'node',
      },
      onControlError: (error) => {
        void Promise.resolve(this.#onError(error)).catch(() => undefined);
      },
    });
  }

  async start(): Promise<RootHostSnapshot> {
    if (this.#started) throw new Error('RootHost is already started');
    this.#started = true;
    try {
      const snapshot = await this.runtime.start();
      if (this.#watch) {
        this.#stopHmr = this.runtime.createHmrCoordinator({
          onRestartRequired: this.#onRestartRequired,
          onError: this.#onError,
          onPlan: this.#onPlan,
        }).start();
      }
      return describeSnapshot(snapshot);
    } catch (error) {
      await this.runtime.stop().catch(() => undefined);
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = (async () => {
      this.#stopHmr?.();
      this.#stopHmr = undefined;
      if (this.#started) await this.runtime.stop();
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
