import type {
  CapabilitySlot,
  PluginId,
  RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  OwnerCapabilityIndex,
  createCapabilityContext,
  type OwnerCapabilityEntry,
} from '@zhin.js/feature-kit';
import type { AgentToolDefinition, ToolApproval, ToolScope } from './definition.js';

export interface ToolDescriptor {
  readonly owner: PluginId;
  readonly name: string;
  readonly qualifiedName: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly approval: ToolApproval;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ToolScope[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  readonly source: string;
}

export class ToolIndex {
  readonly #index: OwnerCapabilityIndex<AgentToolDefinition>;

  constructor(
    slots: readonly Readonly<CapabilitySlot<AgentToolDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    this.#index = new OwnerCapabilityIndex(slots, snapshot);
  }

  list(): readonly ToolDescriptor[] {
    return this.#index.entries().map(toDescriptor);
  }

  visible(requester: PluginId): readonly ToolDescriptor[] {
    return this.#index.visible(requester).map(toDescriptor);
  }

  has(requester: PluginId, name: string): boolean {
    return this.#index.resolve(requester, name) !== undefined;
  }

  async execute<TInput = unknown, TResult = unknown>(
    requester: PluginId,
    name: string,
    input: TInput,
  ): Promise<TResult> {
    const entry = this.#index.resolve(requester, name);
    if (!entry) throw new Error(`Unknown Agent Tool ${name} for ${requester}`);
    return entry.slot.definition.execute(
      input,
      createCapabilityContext(this.snapshot, entry.owner),
    ) as TResult | Promise<TResult>;
  }
}

function toDescriptor(entry: OwnerCapabilityEntry<AgentToolDefinition>): ToolDescriptor {
  const definition = entry.slot.definition;
  return Object.freeze({
    owner: entry.owner,
    name: entry.name,
    qualifiedName: entry.qualifiedName,
    description: definition.description,
    inputSchema: definition.inputSchema,
    approval: definition.approval,
    platforms: definition.platforms,
    scopes: definition.scopes,
    permissions: definition.permissions,
    hidden: definition.hidden,
    source: entry.source,
  });
}
