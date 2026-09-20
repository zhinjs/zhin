import {
  AdapterIndex,
  adapterFeatureId,
  isAdapterIndex,
  resolveEndpointManagement,
  type AdapterEndpointPhase,
  type AdapterOperation,
  type EndpointControl,
  type EndpointManagement,
  type EndpointManagementCapability,
} from '@zhin.js/adapter';
import type { RuntimeSnapshot, SnapshotLease } from '@zhin.js/plugin-runtime';
import type {
  ConversationRef,
  DeliveryReceipt,
  EndpointCapabilities,
  MessageRef,
} from '@zhin.js/im-contract';
import type {
  ConversationAddress,
  SendContent,
  SendRequest,
} from './contracts.js';

export interface EndpointRuntimeSummary {
  readonly id: string;
  readonly name: string;
  readonly adapter: string;
  readonly owner: string;
  readonly connected: boolean;
  readonly status: 'online' | 'offline';
  readonly phase: AdapterEndpointPhase;
  readonly operations: readonly AdapterOperation[];
  readonly managementCapabilities: readonly EndpointManagementCapability[];
}

export type EndpointRuntimeDetail = Omit<EndpointRuntimeSummary, 'id' | 'owner'>;

export interface RuntimeEndpointSendInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversation: ConversationAddress;
  readonly content: unknown;
}

export interface RuntimeEndpointReactionInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: MessageRef;
  readonly emoji: string;
  readonly sceneType?: string;
  readonly channelId?: string;
}

export interface RuntimeEndpointRemoveReactionInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: MessageRef;
  readonly reactionId: string;
}

export interface RuntimeEndpointMessageInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: MessageRef;
}

export interface RuntimeEndpointEditInput extends RuntimeEndpointMessageInput {
  readonly content: unknown;
}

export interface RuntimeEndpointTypingInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversation: ConversationRef;
  readonly active?: boolean;
}

interface EndpointRuntimeContext {
  acquire(): SnapshotLease;
  release(lease: SnapshotLease): void;
  send(request: SendRequest, snapshot: RuntimeSnapshot): Promise<DeliveryReceipt>;
}

/** Owns generation-leased Endpoint discovery, control, management, and Console delivery. */
export class EndpointRuntime {
  constructor(private readonly context: EndpointRuntimeContext) {}

  list(): readonly EndpointRuntimeSummary[] {
    return this.#withLease<readonly EndpointRuntimeSummary[]>((snapshot) =>
      requireAdapters(snapshot).describe().map((row) =>
        Object.freeze({
          id: String(row.id),
          name: row.name,
          adapter: adapterTypeName(snapshot.tree.get(row.owner)?.packageName) ?? row.name,
          owner: row.owner,
          connected: row.connected,
          status: row.status,
          phase: row.phase,
          operations: row.operations,
          managementCapabilities: row.managementCapabilities,
        })), Object.freeze([]));
  }

  capabilities(input: {
    readonly adapter: string;
    readonly endpointKey: string;
  }): EndpointCapabilities | undefined {
    return this.#withLease((snapshot) => {
      const index = requireAdapters(snapshot);
      const id = index.resolve(input.adapter, input.endpointKey);
      return id ? index.capabilities(id) : undefined;
    }, undefined);
  }

  get(adapter: string, endpointKey: string): EndpointRuntimeDetail | null {
    return this.#withLease((snapshot) => {
      const index = requireAdapters(snapshot);
      const id = index.resolve(adapter, endpointKey);
      if (!id) return null;
      const row = index.describe().find((item) => item.id === id);
      if (!row) return null;
      return Object.freeze({
        name: row.name,
        adapter: adapterTypeName(snapshot.tree.get(row.owner)?.packageName) ?? row.name,
        connected: row.connected,
        status: row.status,
        phase: row.phase,
        operations: row.operations,
        managementCapabilities: row.managementCapabilities,
      });
    }, null);
  }

  async send(input: RuntimeEndpointSendInput): Promise<{ messageId: string }> {
    const lease = this.context.acquire();
    try {
      const index = requireAdapters(lease.value);
      const resolved = index.resolve(input.adapter, input.endpointKey);
      if (!resolved) throw new Error('endpoint not found');
      const requester = index.owner(resolved);
      const conversation: ConversationRef = {
        endpoint: { id: String(resolved), adapter: String(requester) },
        ...input.conversation,
      };
      const result = await this.context.send({
        conversation,
        requester,
        content: normalizeConsoleContent(input.content),
      }, lease.value);
      return { messageId: result.message?.id ?? '' };
    } finally {
      this.context.release(lease);
    }
  }

  async addReaction(input: RuntimeEndpointReactionInput): Promise<string | null> {
    return this.#withControl(input.adapter, input.endpointKey, 'reaction', (control) =>
      control.addReaction?.(input.message, input.emoji, {
        sceneType: input.sceneType,
        channelId: input.channelId,
      }) ?? null, null);
  }

  async removeReaction(input: RuntimeEndpointRemoveReactionInput): Promise<void> {
    await this.#withControl(input.adapter, input.endpointKey, 'reaction', (control) =>
      control.removeReaction?.(input.message, input.reactionId), undefined);
  }

  async recall(input: RuntimeEndpointMessageInput): Promise<void> {
    await this.#withControl(input.adapter, input.endpointKey, 'recall', (control) =>
      control.recall?.(input.message), undefined);
  }

  async edit(input: RuntimeEndpointEditInput): Promise<string | null> {
    return this.#withControl(input.adapter, input.endpointKey, 'edit', (control) =>
      control.edit?.(input.message, input.content) ?? null, null);
  }

  async typing(input: RuntimeEndpointTypingInput): Promise<void> {
    await this.#withControl(input.adapter, input.endpointKey, 'typing', (control) =>
      control.typing?.(input.conversation, input.active), undefined);
  }

  async withManagement<T>(
    adapter: string,
    endpointKey: string,
    run: (management: EndpointManagement) => T | Promise<T>,
  ): Promise<T | null> {
    let lease: SnapshotLease;
    try {
      lease = this.context.acquire();
    } catch {
      return null;
    }
    try {
      const endpoint = requireAdapters(lease.value).connection(adapter, endpointKey);
      if (!endpoint) return null;
      return await run(resolveEndpointManagement(endpoint) ?? Object.freeze({}));
    } finally {
      this.context.release(lease);
    }
  }

  async #withControl<T>(
    adapter: string,
    endpointKey: string,
    operation: AdapterOperation,
    run: (control: EndpointControl) => T | Promise<T>,
    fallback: T,
  ): Promise<T> {
    let lease: SnapshotLease;
    try {
      lease = this.context.acquire();
    } catch {
      return fallback;
    }
    try {
      const index = requireAdapters(lease.value);
      const id = index.resolve(adapter, endpointKey);
      const control = id ? index.control(id, operation) : undefined;
      return control ? await run(control) : fallback;
    } finally {
      this.context.release(lease);
    }
  }

  #withLease<T>(operation: (snapshot: RuntimeSnapshot) => T, fallback: T): T {
    let lease: SnapshotLease;
    try {
      lease = this.context.acquire();
    } catch {
      return fallback;
    }
    try {
      return operation(lease.value);
    } catch {
      return fallback;
    } finally {
      this.context.release(lease);
    }
  }
}

export function requireAdapters(snapshot: RuntimeSnapshot): AdapterIndex {
  const projection = snapshot.projections.get(adapterFeatureId);
  if (!isAdapterIndex(projection)) {
    throw new Error('Adapter Feature projection is not installed');
  }
  return projection;
}

export function adapterTypeName(packageName: string | undefined): string | undefined {
  if (!packageName) return undefined;
  return packageName.replace(/^@[^/]+\/adapter-/, '');
}

function normalizeConsoleContent(content: unknown): SendContent {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content as SendContent;
  return String(content);
}
