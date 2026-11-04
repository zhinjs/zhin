import {
  DisposeStack, GenerationHandoffStack, PluginDatabaseHost, PluginOutboundHost, PluginScheduleHost, createPluginEventChannel,
  Scope, databaseHostToken, outboundHostToken, qualifyPluginResourceName, rootPluginId, scheduleHostToken,
  type Dispose, type FeatureId, type PluginDefinition, type PluginId, type PluginNodeSnapshot,
  type PluginSetupContext, type Token, type PluginLifecycleEventMap,
} from 'zhin.js/plugin-runtime';
import type { CapabilityContext } from 'zhin.js';
import { parsePluginConfigSchema } from '@zhin.js/runtime';
import { FakeClock, FakeScheduleRootHost } from './fake-clock.js';
import { FakeDatabaseRootHost, FakeOutboundRootHost, type FakeOutboundCall } from './fake-hosts.js';

/** A typed `token -> value` binding; create with {@link fakeResource}. */
export interface FakeResource { readonly token: Token<unknown>; readonly value: unknown }

/** Bind a value to a token with the token's own type, so tests need no cast. */
export function fakeResource<T>(token: Token<T>, value: T): FakeResource {
  return { token: token as Token<unknown>, value };
}

export interface FakePluginOptions<TConfig = unknown> {
  /** Plugin name (also the instance key). Default `test-plugin`. */
  readonly name?: string;
  /** Value returned by `context.config.get()`. Default `{}`. */
  readonly config?: TConfig;
  /** Extra resources to `provide()` on the Scope, e.g. a hand-written fake for a custom token. */
  readonly resources?: readonly FakeResource[];
  /** Install the fake Database / Schedule / Outbound hosts (default: all `true`). */
  readonly hosts?: { readonly database?: boolean; readonly schedule?: boolean; readonly outbound?: boolean };
  /** Start time or an existing clock shared by several fakes. */
  readonly clock?: FakeClock | number | Date;
  /** Feature projections returned by `capabilityContext().project()`. */
  readonly projections?: ReadonlyMap<FeatureId, unknown>;
  readonly generation?: number;
}

/** A capability registered through `context.addFeature` / `context.addCommand` / `context.addXxx`. */
export interface FakeRegisteredFeature {
  readonly kind: string;
  readonly localName: string;
  readonly definition: unknown;
}

/**
 * Typed fake of one plugin's runtime surface. Built from the real `Scope`, `DisposeStack`,
 * `GenerationHandoffStack` and the real owner-bound `PluginDatabaseHost` / `PluginScheduleHost` /
 * `PluginOutboundHost` facades, over in-memory process hosts. No `as never` needed in tests.
 */
export class FakePlugin<TConfig = unknown> {
  readonly id: PluginId = rootPluginId();
  readonly name: string;
  readonly config: TConfig;
  readonly resources: Scope;
  readonly lifecycle = new DisposeStack();
  readonly handoff = new GenerationHandoffStack();
  readonly clock: FakeClock;
  readonly generation: number;
  readonly projections: ReadonlyMap<FeatureId, unknown>;
  /** Features registered by `setup()` through `addFeature` / `addCommand` / `addMiddleware` ... */
  readonly features: FakeRegisteredFeature[] = [];
  /** Process-level fakes behind the facades. */
  readonly databaseHost = new FakeDatabaseRootHost();
  readonly outboundHost = new FakeOutboundRootHost();
  readonly scheduleHost: FakeScheduleRootHost;
  /** Facades exactly as `resources.use(token)` returns them. */
  readonly database: PluginDatabaseHost;
  readonly schedule: PluginScheduleHost;
  readonly outbound: PluginOutboundHost;
  readonly #abort = new AbortController();
  readonly #events = createPluginEventChannel();
  readonly #context: PluginSetupContext<TConfig>;

  constructor(options: FakePluginOptions<TConfig> = {}) {
    this.name = options.name ?? 'test-plugin';
    this.config = (options.config ?? {}) as TConfig;
    this.generation = options.generation ?? 1;
    this.projections = options.projections ?? new Map();
    this.clock = options.clock instanceof FakeClock ? options.clock : new FakeClock(options.clock);
    this.scheduleHost = new FakeScheduleRootHost(this.clock);
    this.resources = new Scope(this.id, undefined, this.lifecycle);
    this.database = new PluginDatabaseHost(this.id, this.databaseHost);
    this.schedule = new PluginScheduleHost(this.id, this.scheduleHost);
    this.outbound = new PluginOutboundHost(this.id, this.outboundHost);
    const hosts = options.hosts ?? {};
    if (hosts.database !== false) this.resources.provide(databaseHostToken, this.database);
    if (hosts.schedule !== false) this.resources.provide(scheduleHostToken, this.schedule);
    if (hosts.outbound !== false) this.resources.provide(outboundHostToken, this.outbound);
    for (const { token, value } of options.resources ?? []) this.resources.provide(token, value);
    this.#context = this.#createSetupContext();
  }

  /** The `context` argument `setup()` receives. */
  get context(): PluginSetupContext<TConfig> { return this.#context; }
  get signal(): AbortSignal { return this.#abort.signal; }

  /** Messages recorded by the fake outbound host (every kind of call). */
  get sent(): readonly FakeOutboundCall[] { return this.outboundHost.calls; }

  /** Rows of a table the plugin created with `database.define(name, ...)`. */
  rows(name: string): readonly Record<string, unknown>[] {
    return this.databaseHost.rowsOf(qualifyPluginResourceName(this.id, name));
  }

  /** Run `definition.setup()` against this fake; a returned disposer joins `lifecycle`. */
  async setup(definition: PluginDefinition<TConfig>): Promise<void> {
    const dispose: void | Dispose = await definition.setup?.(this.#context);
    if (dispose) this.lifecycle.add(dispose);
  }

  /** Tokens declared in `requires` that this fake did not provide. */
  missingRequirements(definition: PluginDefinition<TConfig>): readonly Token<unknown>[] {
    return (definition.requires ?? []).filter(token => !this.resources.has(token));
  }

  /** A `CapabilityContext` for running commands / middleware / handlers against this fake. */
  capabilityContext(): CapabilityContext<TConfig> {
    const owner: PluginNodeSnapshot = Object.freeze({
      id: this.id, instanceKey: this.name, packageName: this.name, packageRoot: '/fake', children: [],
    });
    return Object.freeze({
      signal: this.signal, owner, generation: this.generation,
      config: this.config as Readonly<TConfig>,
      use: <T>(token: Token<T>): T => this.resources.use(token),
      has: (token: Token<unknown>): boolean => this.resources.has(token),
      project: <T>(feature: FeatureId): T => {
        if (!this.projections.has(feature)) throw new Error(`Missing Feature projection ${feature}`);
        return this.projections.get(feature) as T;
      },
    });
  }

  /** Abort `signal` and run every disposer (reverse order). */
  async dispose(): Promise<void> {
    this.#abort.abort();
    try { await this.lifecycle.dispose(); }
    finally { this.#events.dispose(); }
  }

  /** Deliver a Runtime lifecycle fact to this concrete test instance. */
  dispatchLifecycle<TName extends keyof PluginLifecycleEventMap>(name: TName, event: PluginLifecycleEventMap[TName]): Promise<void> {
    return this.#events.dispatch(name, event);
  }

  #createSetupContext(): PluginSetupContext<TConfig> {
    const base = {
      events: this.#events.events,
      signal: this.signal,
      plugin: Object.freeze({ id: this.id, instanceKey: this.name, root: this.id, role: 'root' as const }),
      config: Object.freeze({ get: () => this.config as Readonly<TConfig> }),
      resources: this.resources,
      lifecycle: this.lifecycle,
      handoff: this.handoff,
      addFeature: (feature: FeatureId | string, localName: string, definition: unknown) => {
        this.features.push({ kind: String(feature), localName, definition });
      },
    };
    // Feature packages augment the setup context with `addCommand` / `addMiddleware` / ...; record them all.
    return new Proxy(base, {
      get: (target, key, receiver) => {
        if (Reflect.has(target, key) || typeof key !== 'string' || !/^add[A-Z]/.test(key)) {
          return Reflect.get(target, key, receiver);
        }
        const kind = key.slice(3).toLowerCase();
        return (localName: string, definition: unknown) => { this.features.push({ kind, localName, definition }); };
      },
    }) as unknown as PluginSetupContext<TConfig>;
  }
}

export function createFakePlugin<TConfig = unknown>(options?: FakePluginOptions<TConfig>): FakePlugin<TConfig> {
  return new FakePlugin(options);
}

export interface RunPluginSetupOptions<TConfig = unknown> extends Omit<FakePluginOptions<TConfig>, 'name' | 'config'> {
  /**
   * Raw plugin configuration, as a user would write it under the instance key in `zhin.config.yml`.
   * When the definition declares `config`, it is validated and defaulted like the real Runtime does.
   */
  readonly config?: Partial<TConfig>;
  /**
   * Validate `config` against `definition.config` and apply its defaults (default `true`).
   * Set `false` to pass `config` to `setup()` verbatim, as earlier versions of `runPluginSetup` did.
   */
  readonly validateConfig?: boolean;
}

/** Thrown by {@link runPluginSetup} / {@link resolvePluginConfig} when config fails the plugin's schema. */
export class PluginConfigValidationError extends TypeError {
  override readonly name = 'PluginConfigValidationError';
  constructor(
    readonly plugin: string,
    /** Human-readable `instancePath message` lines, same wording as Runtime startup errors. */
    readonly issues: readonly string[],
  ) {
    super(`Invalid config for plugin ${plugin}:\n  ${issues.join('\n  ')}`);
  }
}

/**
 * Resolve the config view `setup()` would receive from the real Runtime: validate `input` against
 * `definition.config`, fill schema defaults, and keep only the top-level fields the schema declares.
 * Without a declared `config` schema the input is returned unchanged (`{}` when omitted).
 */
export function resolvePluginConfig<TConfig = unknown>(
  definition: Pick<PluginDefinition<TConfig>, 'name' | 'config'>,
  input?: unknown,
): TConfig {
  if (!definition.config) return (input ?? {}) as TConfig;
  const schema = definition.config.toJsonSchema();
  const { value, errors } = parsePluginConfigSchema(schema, input);
  if (errors.length) {
    throw new PluginConfigValidationError(definition.name, errors.map((error) => {
      const params = error.params as Record<string, unknown> | undefined;
      const detail = typeof params?.additionalProperty === 'string'
        ? ` (additionalProperty: ${params.additionalProperty})`
        : Array.isArray(params?.allowedValues) ? ` (allowedValues: ${JSON.stringify(params.allowedValues)})` : '';
      const path = error.instancePath.replace(/^\/candidate/, '');
      return `${path || '/'} ${error.message ?? error.keyword}${detail}`;
    }));
  }
  // The Runtime re-picks a plugin's own top-level fields (see config-composer `pickOwnFields`).
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? Object.keys(schema.properties)
    : [];
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const view: Record<string, unknown> = {};
  for (const key of properties) if (Object.hasOwn(record, key)) view[key] = record[key];
  return view as TConfig;
}

/**
 * Create a fake and run `definition.setup()` in one step. Call `dispose()` when done.
 *
 * When the plugin declares a `config` schema, `options.config` is validated and defaulted first
 * (throws {@link PluginConfigValidationError}); pass `validateConfig: false` to opt out.
 */
export async function runPluginSetup<TConfig = unknown>(
  definition: PluginDefinition<TConfig>,
  options: RunPluginSetupOptions<TConfig> = {},
): Promise<FakePlugin<TConfig>> {
  const { validateConfig = true, config, ...rest } = options;
  const resolved = validateConfig ? resolvePluginConfig(definition, config) : config as TConfig | undefined;
  const fake = new FakePlugin<TConfig>({ ...rest, ...(resolved === undefined ? {} : { config: resolved }), name: definition.name });
  await fake.setup(definition);
  return fake;
}
