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
    invocation: ToolInvocationContext,
  ): Promise<TResult> {
    const entry = this.#index.resolve(requester, name);
    if (!entry) throw new Error(`Unknown Agent Tool ${name} for ${requester}`);
    const parsedInput = parseExecutableInputSchema<TInput>(entry.qualifiedName, entry.slot.definition.inputSchema, input);
    const capability = createCapabilityContext(this.snapshot, entry.owner);
    const context: ToolExecutionContext = Object.freeze({
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
        ...(invocation.policy.filesystem
          ? { filesystem: Object.freeze({ workspaceRoot: invocation.policy.filesystem.workspaceRoot }) }
          : {}),
      }),
      ...(invocation.question ? { question: invocation.question } : {}),
    });
    return entry.slot.definition.execute(parsedInput, context) as TResult | Promise<TResult>;
  }
}

interface ExecutableInputSchema<T> {
  safeParse(input: unknown):
    | Readonly<{ success: true; data: T }>
    | Readonly<{ success: false; error?: Readonly<{ issues?: readonly Readonly<{ path?: readonly PropertyKey[]; message?: string }>[] }> }>;
}

function parseExecutableInputSchema<T>(name: string, schema: unknown, input: unknown): T {
  if (!schema || typeof schema !== 'object' || typeof (schema as ExecutableInputSchema<T>).safeParse !== 'function') {
    return input as T;
  }
  const result = (schema as ExecutableInputSchema<T>).safeParse(input);
  if (result.success) return result.data;
  const detail = result.error?.issues?.map((issue) => {
    const path = issue.path?.map(String).join('.') || 'root';
    return `${path}: ${issue.message ?? 'invalid'}`;
  }).join('; ') || 'invalid input';
  throw new TypeError(`Invalid Agent Tool input for ${name}: ${detail}`);
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
