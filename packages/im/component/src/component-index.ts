import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { createCapabilityContext } from '@zhin.js/feature-kit';
import type { ComponentContext, ComponentDefinition } from './definition.js';

export interface ComponentDescriptor {
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
}

interface ComponentRecord extends ComponentDescriptor {
  readonly slot: Readonly<CapabilitySlot<ComponentDefinition>>;
}

export class ComponentIndex {
  readonly #components = new Map<string, ComponentRecord>();
  readonly #descriptors: readonly ComponentDescriptor[];

  constructor(
    slots: readonly Readonly<CapabilitySlot<ComponentDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    const descriptors: ComponentDescriptor[] = [];
    for (const slot of slots) {
      const key = componentKey(slot.owner, slot.localName);
      if (this.#components.has(key)) {
        throw new Error(`Duplicate Component ${slot.localName} for ${slot.owner}`);
      }
      const record = Object.freeze({
        owner: slot.owner,
        name: slot.localName,
        source: slot.source,
        slot,
      });
      this.#components.set(key, record);
      descriptors.push(record);
    }
    this.#descriptors = Object.freeze(descriptors
      .sort((left, right) => componentKey(left.owner, left.name)
        .localeCompare(componentKey(right.owner, right.name)))
      .map(({ owner, name, source }) => Object.freeze({ owner, name, source })));
  }

  list(): readonly ComponentDescriptor[] {
    return this.#descriptors;
  }

  has(requester: PluginId, name: string): boolean {
    return this.#resolve(requester, name) !== undefined;
  }

  async render<TProps = unknown, TResult = unknown>(
    requesterId: PluginId,
    name: string,
    props: TProps,
  ): Promise<TResult> {
    const requester = this.snapshot.tree.get(requesterId);
    if (!requester) throw new Error(`Unknown Component requester: ${requesterId}`);
    const record = this.#resolve(requesterId, name);
    if (!record) throw new Error(`Unknown Component ${name} for ${requesterId}`);
    const context: ComponentContext = Object.freeze({
      ...createCapabilityContext(this.snapshot, record.owner),
      requester,
    });
    return record.slot.definition.render(props, context) as TResult | Promise<TResult>;
  }

  #resolve(requester: PluginId, name: string): ComponentRecord | undefined {
    let owner: PluginId | undefined = requester;
    while (owner) {
      const component = this.#components.get(componentKey(owner, name));
      if (component) return component;
      owner = this.snapshot.tree.get(owner)?.parent;
    }
    return undefined;
  }
}

function componentKey(owner: PluginId, name: string): string {
  return `${owner}\0${name}`;
}
