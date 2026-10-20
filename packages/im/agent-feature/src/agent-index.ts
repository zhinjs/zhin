import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  OwnerCapabilityIndex,
  type OwnerCapabilityEntry,
} from '@zhin.js/feature-kit';
import type { AgentDefinition } from './definition.js';

export interface AgentDescriptor extends AgentDefinition {
  readonly owner: PluginId;
  readonly qualifiedName: string;
  readonly source: string;
}

export class AgentIndex {
  readonly $projection = 'zhin.agent-index/1' as const;
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

/** Recognize the versioned projection across generation module identities. */
export function isAgentIndex(value: unknown): value is AgentIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.agent-index/1';
}
