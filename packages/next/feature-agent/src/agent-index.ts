import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/next-kernel';
import {
  OwnerCapabilityIndex,
  type OwnerCapabilityEntry,
} from '@zhin.js/next-feature-kit';
import type { AgentDefinition } from './definition.js';

export interface AgentDescriptor extends AgentDefinition {
  readonly owner: PluginId;
  readonly qualifiedName: string;
  readonly source: string;
}

export class AgentIndex {
  readonly #index: OwnerCapabilityIndex<AgentDefinition>;

  constructor(
    slots: readonly Readonly<CapabilitySlot<AgentDefinition>>[],
    snapshot: RuntimeSnapshot,
  ) {
    this.#index = new OwnerCapabilityIndex(slots, snapshot);
  }

  list(): readonly AgentDescriptor[] {
    return this.#index.entries().map(toDescriptor);
  }

  visible(requester: PluginId): readonly AgentDescriptor[] {
    return this.#index.visible(requester).map(toDescriptor);
  }

  get(requester: PluginId, name: string): AgentDescriptor | undefined {
    const entry = this.#index.resolve(requester, name);
    return entry ? toDescriptor(entry) : undefined;
  }
}

function toDescriptor(entry: OwnerCapabilityEntry<AgentDefinition>): AgentDescriptor {
  return Object.freeze({
    ...entry.slot.definition,
    owner: entry.owner,
    qualifiedName: entry.qualifiedName,
    source: entry.source,
  });
}
