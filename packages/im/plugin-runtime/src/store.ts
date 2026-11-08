import type { Dispose } from './dispose.js';
import type { PluginSetupContext } from './plugin.js';
import { createToken, type Token } from './token.js';

export interface ResourceReaderCarrier {
  use<T>(token: Token<T>): T;
  has?<T>(token: Token<T>): boolean;
}

export interface SetupResourceCarrier {
  readonly resources: {
    use<T>(token: Token<T>): T;
    has?<T>(token: Token<T>): boolean;
    provide<T>(token: Token<T>, value: T, dispose?: Dispose): void;
  };
}

export type PluginStoreCarrier = ResourceReaderCarrier | SetupResourceCarrier;

export interface PluginStoreOptions<TValue, TConfig = unknown> {
  readonly id: string;
  readonly description?: string;
  readonly create?: (context: PluginSetupContext<TConfig>) => TValue;
  readonly dispose?: (value: TValue) => void | Promise<void>;
}

export interface PluginStore<TValue, TConfig = unknown> extends Token<TValue> {
  readonly token: Token<TValue>;
  provide(
    context: PluginSetupContext<TConfig> | SetupResourceCarrier,
    valueOrFactory?: TValue | ((context: PluginSetupContext<TConfig>) => TValue),
  ): TValue;
  use(carrier: PluginStoreCarrier): TValue;
  has(carrier: PluginStoreCarrier): boolean;
  get(carrier: PluginStoreCarrier): TValue | undefined;
}

function deriveStoreDisposer<TValue, TConfig>(
  value: TValue,
  options: PluginStoreOptions<TValue, TConfig>,
): Dispose | undefined {
  const dispose = options.dispose;
  let rawDisposer: Dispose | undefined;
  if (dispose) {
    rawDisposer = () => dispose(value);
  } else if (value && typeof value === 'object') {
    const record = value as Record<PropertyKey, unknown>;
    if (typeof Symbol.asyncDispose === 'symbol' && typeof record[Symbol.asyncDispose] === 'function') {
      rawDisposer = () => (record[Symbol.asyncDispose] as () => void | Promise<void>).call(value);
    } else if (typeof Symbol.dispose === 'symbol' && typeof record[Symbol.dispose] === 'function') {
      rawDisposer = () => (record[Symbol.dispose] as () => void | Promise<void>).call(value);
    } else if (typeof record.dispose === 'function') {
      rawDisposer = () => (record.dispose as () => void | Promise<void>).call(value);
    } else if (typeof record.stop === 'function') {
      rawDisposer = () => (record.stop as () => void | Promise<void>).call(value);
    }
  }
  if (!rawDisposer) {
    return undefined;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    return rawDisposer();
  };
}

export function definePluginStore<TValue>(id: string, description?: string): PluginStore<TValue>;
export function definePluginStore<TValue, TConfig = unknown>(
  options: PluginStoreOptions<TValue, TConfig>,
): PluginStore<TValue, TConfig>;
export function definePluginStore<TValue, TConfig = unknown>(
  idOrOptions: string | PluginStoreOptions<TValue, TConfig>,
  description?: string,
): PluginStore<TValue, TConfig> {
  const options: PluginStoreOptions<TValue, TConfig> =
    typeof idOrOptions === 'string'
      ? { id: idOrOptions, description }
      : idOrOptions;
  const baseToken = createToken<TValue>(options.id, options.description);

  const store: PluginStore<TValue, TConfig> = Object.freeze({
    id: baseToken.id,
    ...(baseToken.description === undefined ? {} : { description: baseToken.description }),
    token: baseToken,
    provide(
      context: PluginSetupContext<TConfig> | SetupResourceCarrier,
      valueOrFactory?: TValue | ((context: PluginSetupContext<TConfig>) => TValue),
    ): TValue {
      let value: TValue;
      if (typeof valueOrFactory === 'function') {
        value = (valueOrFactory as (ctx: PluginSetupContext<TConfig>) => TValue)(
          context as PluginSetupContext<TConfig>,
        );
      } else if (valueOrFactory !== undefined) {
        value = valueOrFactory;
      } else if (options.create) {
        value = options.create(context as PluginSetupContext<TConfig>);
      } else {
        throw new TypeError(`PluginStore ${baseToken.id} requires a value or create() factory`);
      }
      const disposer = deriveStoreDisposer(value, options);
      context.resources.provide(store, value, disposer);
      return value;
    },
    use(carrier: PluginStoreCarrier): TValue {
      if ('use' in carrier && typeof carrier.use === 'function') {
        return carrier.use(store);
      }
      if (
        'resources' in carrier &&
        carrier.resources != null &&
        typeof carrier.resources.use === 'function'
      ) {
        return carrier.resources.use(store);
      }
      return (carrier as ResourceReaderCarrier).use(store);
    },
    has(carrier: PluginStoreCarrier): boolean {
      if ('has' in carrier && typeof carrier.has === 'function') {
        return carrier.has(store);
      }
      if (
        'resources' in carrier &&
        carrier.resources != null &&
        typeof carrier.resources.has === 'function'
      ) {
        return carrier.resources.has(store);
      }
      try {
        store.use(carrier);
        return true;
      } catch {
        return false;
      }
    },
    get(carrier: PluginStoreCarrier): TValue | undefined {
      return store.has(carrier) ? store.use(carrier) : undefined;
    },
  });

  return store;
}
