import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { createCapabilityContext } from './context.js';

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
  handle(...args: unknown[]): void | Promise<void>;
}

export function defineHandler<K extends keyof HandlerEventMap & string>(
  options: {
    readonly event: K;
    handle(...args: HandlerEventMap[K] extends unknown[] ? HandlerEventMap[K] : unknown[]): void | Promise<void>;
  },
): Readonly<HandlerDefinition<K>>;

export function defineHandler(
  options: {
    readonly event?: string;
    handle(...args: unknown[]): void | Promise<void>;
  },
): Readonly<HandlerDefinition>;

export function defineHandler(
  options: {
    readonly event?: string;
    handle(...args: unknown[]): void | Promise<void>;
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
  interface PluginSetupContext<TConfig> {
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

// ---------------------------------------------------------------------------
// HandlerIndex — projection
// ---------------------------------------------------------------------------

export interface HandlerDescriptor {
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly event: string;
}

interface HandlerRecord extends HandlerDescriptor {
  readonly slot: Readonly<CapabilitySlot<HandlerDefinition>>;
}

export class HandlerIndex {
  readonly $projection = 'zhin.handler-index/1' as const;
  readonly #byEvent: ReadonlyMap<string, readonly HandlerRecord[]>;
  readonly #snapshot: RuntimeSnapshot;

  constructor(
    slots: readonly Readonly<CapabilitySlot<HandlerDefinition>>[],
    snapshot: RuntimeSnapshot,
  ) {
    this.#snapshot = snapshot;
    const buckets = new Map<string, HandlerRecord[]>();
    for (const slot of slots) {
      const event = slot.definition.event ?? slot.localName;
      let list = buckets.get(event);
      if (!list) {
        list = [];
        buckets.set(event, list);
      }
      list.push(Object.freeze({
        owner: slot.owner,
        name: slot.localName,
        source: slot.source,
        event,
        slot,
      }));
    }
    const map = new Map<string, readonly HandlerRecord[]>();
    for (const [key, records] of buckets) {
      map.set(key, Object.freeze(records));
    }
    this.#byEvent = map;
  }

  events(): readonly string[] {
    return [...this.#byEvent.keys()];
  }

  list(): readonly HandlerDescriptor[] {
    const result: HandlerDescriptor[] = [];
    for (const records of this.#byEvent.values()) {
      for (const { slot: _slot, ...descriptor } of records) {
        result.push(descriptor);
      }
    }
    return result;
  }

  has(event: string): boolean {
    const records = this.#byEvent.get(event);
    return !!records && records.length > 0;
  }

  async dispatch(event: string, ...args: unknown[]): Promise<void> {
    const records = this.#byEvent.get(event);
    if (!records) return;
    for (const record of records) {
      const context = createCapabilityContext(this.#snapshot, record.owner);
      await record.slot.definition.handle.call(context, ...args);
    }
  }
}

export function isHandlerIndex(value: unknown): value is HandlerIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.handler-index/1';
}
