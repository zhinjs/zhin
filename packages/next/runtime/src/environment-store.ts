import { createToken, type PluginId } from '@zhin.js/next-kernel';
import type { RuntimeEnvironment } from './environment.js';

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface EnvironmentLayers {
  readonly base?: EnvironmentSource;
  readonly environments?: Readonly<Record<string, EnvironmentSource>>;
  readonly plugins?: Readonly<Record<string, EnvironmentSource>>;
}

export interface EnvSchema<T> {
  readonly secretKeys?: readonly string[];
  parse(source: EnvironmentSource): T;
}

export interface EnvStore {
  readonly owner: PluginId;
  readonly environment: RuntimeEnvironment;
  has(key: string): boolean;
  get(key: string): string | undefined;
  require(key: string): string;
  parse<T>(schema: EnvSchema<T>): Readonly<T>;
  expand<T>(value: T): T;
  redact(value: unknown, secretKeys: readonly string[]): unknown;
}

export const envStoreToken = createToken<EnvStore>(
  'zhin.env',
  'Owner-scoped environment variables',
);

export class EnvironmentVariableMissingError extends Error {
  constructor(readonly owner: PluginId, readonly key: string) {
    super(`Missing environment variable ${key} for Plugin ${owner}`);
    this.name = 'EnvironmentVariableMissingError';
  }
}

export class EnvSchemaParseError extends Error {
  constructor(readonly owner: PluginId, message: string) {
    super(`Invalid environment for Plugin ${owner}: ${message}`);
    this.name = 'EnvSchemaParseError';
  }
}

export function defineEnvSchema<T>(schema: EnvSchema<T>): Readonly<EnvSchema<T>> {
  const secretKeys = Object.freeze([...(schema.secretKeys ?? [])]);
  for (const key of secretKeys) assertEnvironmentKey(key);
  return Object.freeze({
    secretKeys,
    parse: (source: EnvironmentSource) => schema.parse(source),
  });
}

export function defineEnvironmentLayers(
  layers: EnvironmentLayers = {},
): Readonly<EnvironmentLayers> {
  const environments = Object.fromEntries(
    Object.entries(layers.environments ?? {}).map(([name, source]) => {
      if (!/^[a-z0-9][a-z0-9-]*$/u.test(name)) {
        throw new TypeError(`Invalid environment overlay name: ${name}`);
      }
      return [name, copySource(source, `environment ${name}`)];
    }),
  );
  const plugins = Object.fromEntries(
    Object.entries(layers.plugins ?? {}).map(([owner, source]) => {
      if (!/^root(?:\/[a-z0-9][a-z0-9-]*)*$/u.test(owner)) {
        throw new TypeError(`Invalid Plugin environment overlay owner: ${owner}`);
      }
      return [owner, copySource(source, `Plugin ${owner}`)];
    }),
  );
  return Object.freeze({
    base: copySource(layers.base ?? {}, 'base environment'),
    environments: Object.freeze(environments),
    plugins: Object.freeze(plugins),
  });
}

export function createEnvStore(
  owner: PluginId,
  environment: RuntimeEnvironment,
  layers: EnvironmentLayers = {},
): EnvStore {
  return new EnvStoreFactory(environment, layers).create(owner);
}

/** Normalizes layers once, then derives immutable stores for each Plugin owner. */
export class EnvStoreFactory {
  readonly #environment: RuntimeEnvironment;
  readonly #layers: Readonly<EnvironmentLayers>;

  constructor(environment: RuntimeEnvironment, layers: EnvironmentLayers = {}) {
    this.#environment = environment;
    this.#layers = defineEnvironmentLayers(layers);
  }

  create(owner: PluginId): EnvStore {
    const source: Record<string, string> = {};
    applyLayer(source, this.#layers.base);
    applyLayer(source, this.#layers.environments?.[this.#environment.name]);
    for (const ancestor of pluginAncestors(owner)) {
      applyLayer(source, this.#layers.plugins?.[ancestor]);
    }
    return new OwnerEnvStore(owner, this.#environment, Object.freeze(source));
  }
}

class OwnerEnvStore implements EnvStore {
  readonly #source: Readonly<Record<string, string>>;

  constructor(
    readonly owner: PluginId,
    readonly environment: RuntimeEnvironment,
    source: Readonly<Record<string, string>>,
  ) {
    this.#source = source;
  }

  has(key: string): boolean {
    assertEnvironmentKey(key);
    return Object.hasOwn(this.#source, key);
  }

  get(key: string): string | undefined {
    assertEnvironmentKey(key);
    return this.#source[key];
  }

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined) throw new EnvironmentVariableMissingError(this.owner, key);
    return value;
  }

  parse<T>(schema: EnvSchema<T>): Readonly<T> {
    const secretKeys = schema.secretKeys ?? [];
    for (const key of secretKeys) assertEnvironmentKey(key);
    try {
      return freezeValue(schema.parse(this.#source));
    } catch (error) {
      // Do not retain the original cause: validation libraries commonly embed
      // source values in it, which would bypass the redacted public message.
      const message = error instanceof Error ? error.message : String(error);
      throw new EnvSchemaParseError(
        this.owner,
        redactString(message, secretValues(this.#source, secretKeys)),
      );
    }
  }

  expand<T>(value: T): T {
    return expandValue(value, (key) => this.require(key)) as T;
  }

  redact(value: unknown, secretKeys: readonly string[]): unknown {
    for (const key of secretKeys) assertEnvironmentKey(key);
    return redactValue(value, secretValues(this.#source, secretKeys));
  }
}

function copySource(source: EnvironmentSource, label: string): EnvironmentSource {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError(`${label} must be an object`);
  }
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    assertEnvironmentKey(key);
    if (value !== undefined && typeof value !== 'string') {
      throw new TypeError(`${label}.${key} must be a string or undefined`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

function applyLayer(
  target: Record<string, string>,
  layer: EnvironmentSource | undefined,
): void {
  for (const [key, value] of Object.entries(layer ?? {})) {
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
}

function pluginAncestors(owner: PluginId): readonly string[] {
  const segments = owner.split('/');
  return Object.freeze(segments.map((_, index) => segments.slice(0, index + 1).join('/')));
}

function assertEnvironmentKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
    throw new TypeError(`Invalid environment variable name: ${key}`);
  }
}

function expandValue(
  value: unknown,
  resolve: (key: string) => string,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_, key: string) => resolve(key));
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('Environment expansion input must be acyclic');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = Object.freeze(value.map((item) => expandValue(item, resolve, seen)));
    seen.delete(value);
    return result;
  }
  if (!isPlainRecord(value)) {
    seen.delete(value);
    return value;
  }
  const result = Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, expandValue(item, resolve, seen)]),
  ));
  seen.delete(value);
  return result;
}

function redactValue(
  value: unknown,
  secrets: readonly string[],
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return redactString(value, secrets);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    const result = Object.freeze({
      name: value.name,
      message: redactString(value.message, secrets),
      stack: value.stack ? redactString(value.stack, secrets) : undefined,
      cause: value.cause === undefined ? undefined : redactValue(value.cause, secrets, seen),
    });
    seen.delete(value);
    return result;
  }
  if (Array.isArray(value)) {
    const result = Object.freeze(value.map((item) => redactValue(item, secrets, seen)));
    seen.delete(value);
    return result;
  }
  if (!isPlainRecord(value)) {
    seen.delete(value);
    return value;
  }
  const result = Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets, seen)]),
  ));
  seen.delete(value);
  return result;
}

function redactString(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (result, secret) => result.replaceAll(secret, '[REDACTED]'),
    value,
  );
}

function secretValues(
  source: Readonly<Record<string, string>>,
  keys: readonly string[],
): readonly string[] {
  return Object.freeze(keys.flatMap((key) => {
    const value = source[key];
    return value ? [value] : [];
  }));
}

function freezeValue<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value) || isPlainRecord(value)) {
    for (const item of Object.values(value)) freezeValue(item, seen);
    Object.freeze(value);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
