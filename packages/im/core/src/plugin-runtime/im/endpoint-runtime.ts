import {
  AdapterIndex,
  adapterFeatureId,
  isAdapterIndex,
  type AdapterEndpointPhase,
  type AdapterOperation,
  type EndpointControl,
  type AdapterEndpointSummary,
  type EndpointTransportState,
  type EndpointManagement,
  type EndpointManagementCapability,
} from '@zhin.js/adapter';
import { normalizeDeliveryTarget, type DeliveryTarget, type CapabilityId, type PluginId, type RuntimeSnapshot, type SnapshotLease, type Locale } from '@zhin.js/plugin-runtime';
import {
  EndpointDeliveryError,
  type ConversationRef,
  type DeliveryReceipt,
  type EndpointCapabilities,
  type MessageRef,
} from '@zhin.js/im-contract';
import type {
  ConversationAddress,
  SendContent,
  SendRequest,
} from './contracts.js';

export interface EndpointRuntimeSummary {
  readonly id: string;
  readonly endpoint: ConversationRef['endpoint'];
  readonly name: string;
  readonly adapter: string;
  readonly owner: string;
  readonly connected: boolean;
  readonly admitted: boolean;
  readonly transportState: EndpointTransportState | 'unknown';
  readonly eventDiagnostics: AdapterEndpointSummary['eventDiagnostics'];
  readonly status: 'online' | 'offline';
  readonly phase: AdapterEndpointPhase;
  readonly operations: readonly AdapterOperation[];
  readonly managementCapabilities: readonly EndpointManagementCapability[];
}

export type EndpointRuntimeDetail = Omit<EndpointRuntimeSummary, 'id' | 'owner'>;

export interface RuntimeEndpointSendInput {
  readonly locale?: Locale;
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
          endpoint: Object.freeze({ id: String(row.id), adapter: requireAdapters(snapshot).clientAdapter(row.id) }),
          name: row.name,
          adapter: adapterTypeName(snapshot.tree.get(row.owner)?.packageName) ?? row.name,
          owner: row.owner,
          connected: row.connected,
          admitted: row.admitted,
          transportState: row.transportState,
          eventDiagnostics: row.eventDiagnostics,
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
      const id = resolveEndpointIdentity(snapshot, index, input.adapter, input.endpointKey);
      return id ? index.capabilities(id) : undefined;
    }, undefined);
  }

  get(adapter: string, endpointKey: string): EndpointRuntimeDetail | null {
    return this.#withLease((snapshot) => {
      const index = requireAdapters(snapshot);
      const id = resolveEndpointIdentity(snapshot, index, adapter, endpointKey);
      if (!id) return null;
      const row = index.describe().find((item) => item.id === id);
      if (!row) return null;
      return Object.freeze({
        name: row.name,
        endpoint: Object.freeze({ id: String(row.id), adapter: index.clientAdapter(row.id) }),
        adapter: adapterTypeName(snapshot.tree.get(row.owner)?.packageName) ?? row.name,
        connected: row.connected,
          admitted: row.admitted,
          transportState: row.transportState,
          eventDiagnostics: row.eventDiagnostics,
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
      const resolved = resolveEndpointIdentity(lease.value, index, input.adapter, input.endpointKey);
      if (!resolved) throw new Error('endpoint not found');
      const requester = index.owner(resolved);
      const conversation: ConversationRef = {
        ...input.conversation,
        endpoint: { id: String(resolved), adapter: index.clientAdapter(resolved) },
      };
      const result = await this.context.send({
        conversation,
        requester,
        locale: input.locale,
        content: normalizeConsoleContent(input.content),
      }, lease.value);
      return requireSentReceipt(result);
    } finally {
      this.context.release(lease);
    }
  }

  /** Resolves a persisted identity exactly in the current operation generation. */
  async sendTarget(target: DeliveryTarget, content: unknown, requester?: PluginId, options?: Readonly<{ locale?: Locale }>): Promise<{ messageId: string }> {
    const conversation = normalizeDeliveryTarget(target);
    const lease = this.context.acquire();
    try {
      const index = requireAdapters(lease.value);
      const id = conversation.endpoint.id as CapabilityId;
      let owner: PluginId;
      let adapter: string;
      try {
        owner = index.owner(id);
        adapter = index.clientAdapter(id);
      } catch {
        throw new EndpointDeliveryError('endpoint_not_found', 'The saved delivery endpoint no longer exists.', 'not_sent');
      }
      if (adapter !== conversation.endpoint.adapter) {
        throw new EndpointDeliveryError('endpoint_identity_mismatch', 'The saved delivery endpoint belongs to a different adapter.', 'not_sent');
      }
      const result = await this.context.send({
        conversation,
        requester: requester ?? owner,
        locale: options?.locale,
        // The unified renderer validates JSX, components and native Segments.
        content: content as SendContent,
      }, lease.value);
      return requireSentReceipt(result);
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
      const index = requireAdapters(lease.value);
      const id = resolveEndpointIdentity(lease.value, index, adapter, endpointKey);
      const endpoint = id ? index.connection(String(id), String(id)) : undefined;
      if (!endpoint) return null;
      return await run(index.management(id!, () => {
        if (!lease.active) throw new EndpointDeliveryError('operation_scope_ended', 'Management operation scope has ended', 'not_sent');
      }) ?? Object.freeze({}));
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
      const id = resolveEndpointIdentity(lease.value, index, adapter, endpointKey);
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

/** Resolves public list identities against the exact operation snapshot; ambiguous aliases never pick an account. */
export function resolveEndpointIdentity(snapshot: RuntimeSnapshot, index: AdapterIndex, adapter: string, endpointKey: string) {
  const live = new Map(index.describe().map(row => [row.id, row.name]));
  const matches = index.list().filter(record => {
    const localName = record.id.split('\0').pop() ?? record.id;
    const alias = adapterTypeName(snapshot.tree.get(record.owner)?.packageName);
    const adapterMatches = index.clientAdapter(record.id) === adapter
      || alias === adapter || record.name === adapter || String(record.id) === adapter
      || localName === adapter || String(record.owner) === adapter || record.owner.endsWith(`/${adapter}`);
    const endpointMatches = record.name === endpointKey || String(record.id) === endpointKey
      || record.id.endsWith(`/${endpointKey}`) || live.get(record.id) === endpointKey;
    return adapterMatches && endpointMatches;
  });
  return matches.length === 1 ? matches[0]!.id : undefined;
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

function requireSentReceipt(result: DeliveryReceipt): { messageId: string } {
  if (result.status !== 'sent') {
    throw new EndpointDeliveryError(
      result.failure?.code ?? `outbound_${result.status}`,
      result.failure?.message ?? 'Outbound delivery was suppressed.',
      result.failure?.deliveryUnknown ? 'unknown'
        : result.status === 'rejected' ? 'rejected' : 'not_sent',
    );
  }
  return { messageId: result.message?.id ?? '' };
}
