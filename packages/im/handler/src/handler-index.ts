import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { createCapabilityContext } from '@zhin.js/feature-kit';
import type { HandlerDefinition } from './definition.js';

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
