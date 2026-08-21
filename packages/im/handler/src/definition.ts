import type { HandlerContext } from './context.js';

const handlerBrand = 'zhin.handler/1' as const;

/**
 * Augmentable event map. `@zhin.js/core` augments this with `Plugin.Lifecycle`
 * events so that `defineHandler({ event: 'message.receive', handle(msg) {} })`
 * infers the argument types automatically.
 */
export interface HandlerEventMap {
  // Augmented by higher-level packages (e.g. @zhin.js/core)
}

export interface HandlerDefinition<K extends string = string> {
  readonly $feature: typeof handlerBrand;
  readonly event?: K;
  handle(this: HandlerContext, ...args: unknown[]): void | Promise<void>;
}

export function defineHandler<K extends keyof HandlerEventMap & string>(
  options: {
    readonly event: K;
    handle(
      this: HandlerContext,
      ...args: HandlerEventMap[K] extends unknown[] ? HandlerEventMap[K] : unknown[]
    ): void | Promise<void>;
  },
): Readonly<HandlerDefinition<K>>;

export function defineHandler(
  options: {
    readonly event?: string;
    handle(this: HandlerContext, ...args: unknown[]): void | Promise<void>;
  },
): Readonly<HandlerDefinition>;

export function defineHandler(
  options: {
    readonly event?: string;
    handle(this: HandlerContext, ...args: unknown[]): void | Promise<void>;
  },
): Readonly<HandlerDefinition> {
  if (typeof options.handle !== 'function') {
    throw new TypeError('Handler handle must be a function');
  }
  if (options.event !== undefined && typeof options.event !== 'string') {
    throw new TypeError(`Invalid Handler event: ${String(options.event)}`);
  }
  if (options.event !== undefined && options.event.length === 0) {
    throw new TypeError('Handler event must be a non-empty string');
  }
  return Object.freeze({
    $feature: handlerBrand,
    ...(options.event !== undefined ? { event: options.event } : {}),
    handle: options.handle,
  });
}

declare module '@zhin.js/plugin-runtime' {
  // Generic name must match the canonical declaration for module merging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginSetupContext<TConfig = unknown> {
    addHandler(
      localName: string,
      definition: HandlerDefinition,
    ): void;
  }
}

export function parseHandlerDefinition(value: unknown): HandlerDefinition {
  if (!value || typeof value !== 'object') throw invalidHandler();
  const definition = value as Partial<HandlerDefinition>;
  if (
    definition.$feature !== handlerBrand
    || typeof definition.handle !== 'function'
  ) throw invalidHandler();
  if (definition.event !== undefined && typeof definition.event !== 'string') {
    throw invalidHandler();
  }
  return definition as HandlerDefinition;
}

function invalidHandler(): TypeError {
  return new TypeError('Handler module must default-export defineHandler(...)');
}
