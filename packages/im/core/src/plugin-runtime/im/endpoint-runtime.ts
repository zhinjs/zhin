import { operationEndpoint } from './operation-endpoint.js';
import type { CaptureEndpointOperationInput, CapturedEndpointOperation } from './captured-endpoint-operation.js';
export type { CaptureEndpointOperationInput, CapturedEndpointOperation } from './captured-endpoint-operation.js';
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
  readonly message: MessageRef;
  readonly emoji: string;
  readonly sceneType?: string;
  readonly channelId?: string;
}

export interface RuntimeEndpointRemoveReactionInput {
  readonly message: MessageRef;
  readonly reactionId: string;
}

export interface RuntimeEndpointMessageInput {
  readonly message: MessageRef;
}

export interface RuntimeEndpointEditInput extends RuntimeEndpointMessageInput {
  readonly content: unknown;
}

export interface RuntimeEndpointTypingInput {
  readonly conversation: ConversationRef;
  readonly active?: boolean;
}

/** One canonical operation; no independent selector can contradict the referenced account. */
interface EndpointControlInvocation<T> {
  readonly target: ConversationRef;
  readonly method: keyof EndpointControl;
  readonly run: (control: EndpointControl) => T | Promise<T>;
}

interface EndpointRuntimeContext {
  acquire(): SnapshotLease;
  /** Independently retain the current operation snapshot for detached source work. */
  retain(): SnapshotLease;
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

  /** Retain the actual ingress Client instead of resolving the latest account when work settles. */
  captureOperation(input: CaptureEndpointOperationInput): CapturedEndpointOperation {
    const target = normalizeDeliveryTarget(input.target);
    const snapshot = this.context.retain();
    let child: ReturnType<AdapterIndex['acquire']> | undefined;
    try {
      const index = requireAdapters(snapshot.value);
      const id = target.endpoint.id as CapabilityId;
      if (index.clientAdapter(id) !== target.endpoint.adapter) {
        throw new EndpointDeliveryError('endpoint_identity_mismatch', 'Source belongs to another adapter.', 'not_sent');
      }
      const callerSignal = input.signal
        ? AbortSignal.any([snapshot.stopSignal, input.signal]) : snapshot.stopSignal;
      child = index.acquireInbound(id, input.client, callerSignal);
      const captured = child;
      let released = false;
      let calls = 0;
      const releaseResources = () => {
        try { captured.release(); } finally { if (snapshot.active) this.context.release(snapshot); }
      };
      const assertActive = () => {
        if (released || !snapshot.active) throw new EndpointDeliveryError('operation_scope_ended', 'Retained operation has ended.', 'not_sent');
        captured.assertActive();
      };
      // The capture stops admitting on release; accepted calls retain its source and Root to drain.
      const retainCall = () => {
        calls += 1;
        return () => { if (--calls === 0 && released) releaseResources(); };
      };
      const scope = { assertActive, signal: captured.signal, retain: retainCall };
      const requester = input.requester ?? index.owner(id);
      const capabilities = index.capabilities(id);
      const declared = (['recall', 'edit', 'reaction', 'typing'] as const).find(operation => capabilities.operations?.[operation]);
      const port = declared ? index.control(id, declared, scope) : undefined;
      const controls = port && Object.freeze<EndpointControl>({
        ...(port.recall ? { recall: async request => {
          assertSameEndpoint(target, request.message.conversation); return port.recall!(request);
        } } : {}),
        ...(port.edit ? { edit: async request => {
          assertSameEndpoint(target, request.message.conversation); return port.edit!(request);
        } } : {}),
        ...(port.addReaction ? { addReaction: async request => {
          assertSameEndpoint(target, request.message.conversation); return port.addReaction!(request);
        } } : {}),
        ...(port.removeReaction ? { removeReaction: async request => {
          assertSameEndpoint(target, request.message.conversation); return port.removeReaction!(request);
        } } : {}),
        ...(port.typing ? { typing: async request => {
          assertSameEndpoint(target, request.conversation); return port.typing!(request);
        } } : {}),
      });
      return Object.freeze({
        target, signal: captured.signal, control: controls,
        management: index.management(id, scope),
        send: async (content, options) => {
          assertActive();
          // Retain the source authority, while each send owns its caller cancellation.
          const releaseCall = retainCall();
          try {
            const sendLease = index.acquire(id, options?.signal
              ? AbortSignal.any([captured.signal, options.signal]) : captured.signal, captured.endpoint);
            try {
              return await this.context.send({ conversation: target, requester, content,
                ...(options?.locale ? { locale: options.locale } : {}), [operationEndpoint]: sendLease }, snapshot.value);
            } finally { sendLease.release(); }
          } finally { releaseCall(); }
        },
        release: () => {
          if (released) return;
          released = true;
          if (!calls) releaseResources();
        },
      } satisfies CapturedEndpointOperation);
    } catch (error) {
      try { child?.release(); } finally { this.context.release(snapshot); }
      throw error;
    }
  }

  async send(input: RuntimeEndpointSendInput): Promise<{ messageId: string }> {
    const lease = this.context.acquire();
    try {
      const index = requireAdapters(lease.value);
      const resolved = index.resolve(input.adapter, input.endpointKey);
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
    return this.#withControl({ target: input.message.conversation, method: 'addReaction',
      run: control => control.addReaction!({ message: input.message, emoji: input.emoji, hint: {
        sceneType: input.sceneType, channelId: input.channelId,
      } }) });
  }

  async removeReaction(input: RuntimeEndpointRemoveReactionInput): Promise<void> {
    await this.#withControl({ target: input.message.conversation, method: 'removeReaction',
      run: control => control.removeReaction!({ message: input.message, reactionId: input.reactionId }) });
  }

  async recall(input: RuntimeEndpointMessageInput): Promise<void> {
    await this.#withControl({ target: input.message.conversation, method: 'recall',
      run: control => control.recall!({ message: input.message }) });
  }

  async edit(input: RuntimeEndpointEditInput): Promise<string | null> {
    return this.#withControl({ target: input.message.conversation, method: 'edit',
      run: control => control.edit!({ message: input.message, content: input.content }) });
  }

  async typing(input: RuntimeEndpointTypingInput): Promise<void> {
    await this.#withControl({ target: input.conversation, method: 'typing',
      run: control => control.typing!({ conversation: input.conversation, active: input.active }) });
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
      const id = index.resolve(adapter, endpointKey);
      const endpoint = id ? index.connection(String(id), String(id)) : undefined;
      if (!endpoint) return null;
      return await run(index.management(id!, { assertActive: () => {
        if (!lease.active) throw new EndpointDeliveryError('operation_scope_ended', 'Management operation scope has ended', 'not_sent');
      } }) ?? Object.freeze({}));
    } finally {
      this.context.release(lease);
    }
  }

  async #withControl<T>({ target: source, method, run }: EndpointControlInvocation<T>): Promise<T> {
    const target = normalizeDeliveryTarget(source);
    const lease = this.context.acquire();
    try {
      const index = requireAdapters(lease.value);
      const id = target.endpoint.id as CapabilityId;
      let actualAdapter: string;
      try { actualAdapter = index.clientAdapter(id); }
      catch { throw new EndpointDeliveryError('endpoint_not_found', 'The referenced account no longer exists.', 'not_sent'); }
      if (actualAdapter !== target.endpoint.adapter) {
        throw new EndpointDeliveryError('endpoint_identity_mismatch', 'Message reference belongs to another adapter.', 'not_sent');
      }
      const operation = method === 'addReaction' || method === 'removeReaction' ? 'reaction' : method;
      const control = index.control(id, operation, { assertActive: () => {
        if (!lease.active) throw new EndpointDeliveryError('operation_scope_ended', 'Control operation has ended.', 'not_sent');
      } });
      if (!control || typeof control[method] !== 'function') {
        throw new EndpointDeliveryError('unsupported_operation', `Endpoint does not support ${method}.`, 'not_sent');
      }
      return await run(control);
    } finally { this.context.release(lease); }
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

/** A canonical message/address cannot be redirected by a second endpoint selector. */
function assertSameEndpoint(expected: ConversationRef, actual: ConversationRef): void {
  if (expected.endpoint.id !== actual.endpoint.id || expected.endpoint.adapter !== actual.endpoint.adapter) {
    throw new EndpointDeliveryError('endpoint_identity_mismatch', 'Message reference belongs to another Endpoint.', 'not_sent');
  }
}
