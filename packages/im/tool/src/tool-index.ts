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
import type {
  AgentToolDefinition,
  ToolApproval,
  ToolExecutionContext,
  ToolInvocationContext,
  ToolScope,
} from './definition.js';
import { parseToolInputSchema } from './input-schema.js';
import type { ToolInputSchema } from './input-schema.js';

export interface ToolDescriptor {
  readonly owner: PluginId;
  readonly name: string;
  readonly qualifiedName: string;
  readonly description: string;
  readonly inputSchema?: ToolInputSchema;
  readonly approval: ToolApproval;
  readonly adapter?: string;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ToolScope[];
  readonly permissions?: readonly string[];
  readonly tags?: readonly string[];
  readonly keywords?: readonly string[];
  readonly hidden?: boolean;
  readonly placement?: AgentToolDefinition['placement'];
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
    invocation: ToolInvocationContext,
  ): Promise<TResult> {
    const entry = this.#index.resolve(requester, name);
    if (!entry) throw new Error(`Unknown Agent Tool ${name} for ${requester}`);
    const parsed = parseToolInputSchema(entry.slot.definition.inputSchema, input);
    if (!parsed.ok) {
      throw new TypeError(`Invalid Agent Tool input for ${entry.qualifiedName}: ${parsed.error}`);
    }
    const expectedAdapter = entry.slot.definition.adapter;
    if (expectedAdapter && invocation.client?.adapter !== expectedAdapter) {
      throw new Error(`Agent Tool ${entry.qualifiedName} requires adapter ${expectedAdapter}`);
    }
    const capability = createCapabilityContext(this.snapshot, entry.owner);
    const context = {
      ...capability,
      signal: invocation.signal,
      traceId: invocation.traceId,
      turnId: invocation.turnId,
      sessionKey: invocation.sessionKey,
      origin: Object.freeze({ ...invocation.origin }),
      principal: Object.freeze({
        subjectId: invocation.principal.subjectId,
        displayName: invocation.principal.displayName,
        roles: Object.freeze([...invocation.principal.roles]),
      }),
      policy: Object.freeze({
        permissions: Object.freeze([...invocation.policy.permissions]),
        unattended: invocation.policy.unattended,
        network: Object.freeze({
          enabled: invocation.policy.network.enabled,
          httpsOnly: invocation.policy.network.httpsOnly,
          allowedDomains: Object.freeze([...(invocation.policy.network.allowedDomains ?? [])]),
        }),
        ...(invocation.policy.shell
          ? { shell: Object.freeze({ ...invocation.policy.shell }) }
          : {}),
        ...(invocation.policy.filesystem
          ? { filesystem: Object.freeze({ ...invocation.policy.filesystem }) }
          : {}),
      }),
      ...(invocation.question ? { question: invocation.question } : {}),
    } as ToolExecutionContext;
    Object.defineProperty(context, '$client', {
      enumerable: true,
      get: () => invocation.client?.get(),
    });
    Object.freeze(context);
    return entry.slot.definition.execute(parsed.data as TInput, context) as TResult | Promise<TResult>;
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
    ...(definition.adapter ? { adapter: definition.adapter } : {}),
    platforms: definition.platforms,
    scopes: definition.scopes,
    permissions: definition.permissions,
    tags: definition.tags,
    keywords: definition.keywords,
    hidden: definition.hidden,
    placement: definition.placement,
    source: entry.source,
  });
}
