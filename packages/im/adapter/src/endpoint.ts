import {
  createToken,
  type CapabilityId,
  type GenerationAdmissionGate,
} from '@zhin.js/plugin-runtime';
import type { ConversationRef, MessageRef } from '@zhin.js/im-contract';
import type { AdapterContext, EndpointSendRequest } from './definition.js';
import type { EndpointManagement } from './endpoint-management.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointContentPort } from './endpoint-content.js';

/** The one inbound event boundary shared by every platform Endpoint. */
export interface EndpointEventGateway {
  receive(event: EndpointEvent): Promise<unknown>;
}

/** Callback shape used by protocol normalizers which feed Endpoint.emit(). */
export type EndpointEventEmitter = <TPayload>(name: string, payload: TPayload) => Promise<unknown>;

/** Generation-bound gateway injected into Endpoint by AdapterIndex. */
export const endpointEventGatewayToken = createToken<EndpointEventGateway>(
  'zhin.adapter.endpoint-events',
);

/** Stable identity of the Endpoint which produced an event. */
export interface EndpointIdentity {
  readonly id: CapabilityId;
  readonly adapter: string;
}

/**
 * The single event context delivered from an Endpoint into Core and plugins.
 * `client` is the actual platform SDK/protocol client owned by the Endpoint.
 */
export interface EndpointEvent<
  TPayload = unknown,
  TClient = unknown,
  TName extends string = string,
> {
  readonly name: TName;
  readonly payload: TPayload;
  readonly endpoint: EndpointIdentity;
  readonly client: TClient;
}

/** Lossless native event delivered before any optional canonical projection. */
export interface PlatformEvent<
  TEvent = unknown,
  TName extends string = string,
> {
  /** Native SDK/protocol event name, for example `guild_member_add`. */
  readonly name: TName;
  /** Native SDK/protocol payload without canonicalization. */
  readonly event: TEvent;
}

/** A conversation address supplied by an Adapter without framework Endpoint identity. */
export type EndpointConversation = Omit<ConversationRef, 'endpoint'>;

/**
 * Compact inbound message shape for object-style Endpoint implementations.
 * Framework-owned Endpoint identity is attached by {@link EndpointEventSink.message}.
 */
export interface EndpointIncomingMessage<TSegment = unknown> {
  readonly conversation: EndpointConversation;
  readonly message?: MessageRef;
  readonly content: string;
  readonly segments?: readonly TSegment[];
  readonly sender?: Readonly<{
    id: string;
    name?: string;
    roles?: readonly string[];
  }>;
  readonly endpointId?: string;
  readonly mentioned?: boolean;
  readonly replyTo?: { readonly id: string };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Inbound event methods available while an object-style Endpoint is connected. */
export interface EndpointEventSink {
  /** Emit a canonical or Adapter-specific event. */
  emit<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown>;
  /** Preserve a native platform event before optional canonical projection. */
  platform<TEvent, TName extends string>(name: TName, event: TEvent): Promise<unknown>;
  /** Emit a canonical message and attach this Endpoint's identity automatically. */
  message<TSegment = unknown>(input: EndpointIncomingMessage<TSegment>): Promise<unknown>;
}

export type EndpointCleanup = () => void | Promise<void>;

/** Context passed once to an object-style Endpoint's `connect` hook. */
export interface EndpointConnectionContext {
  readonly signal: AbortSignal;
  readonly identity: EndpointIdentity;
  readonly events: EndpointEventSink;
}

/**
 * Small authoring interface for most Adapters.
 *
 * Return this object from `defineAdapter().create()` when a custom Endpoint
 * subclass is unnecessary. Runtime owns generation admission and the complete
 * start/open/close/stop lifecycle. `connect` waits for readiness and may return
 * one cleanup function; it is invoked exactly once during stop or rollback.
 */
export interface EndpointImplementation<TClient = unknown> {
  readonly client: TClient;
  readonly name?: string;
  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;
  connect?(context: EndpointConnectionContext): void | EndpointCleanup | Promise<void | EndpointCleanup>;
  /** Acquire listeners that must belong only to the active generation. */
  activate?(context: EndpointConnectionContext): void | EndpointCleanup;
  send?(request: EndpointSendRequest): string | Promise<string>;
}

const endpointBrand = Symbol.for('zhin.adapter.endpoint/1');
const endpointBind = Symbol.for('zhin.adapter.endpoint-bind/1');
const PRE_ADMISSION_EVENT_LIMIT = 256;

/**
 * Deep platform boundary.
 *
 * Platform implementations inherit this class, expose the platform-native
 * `client`, own account/transport lifecycle, and normalize every inbound SDK
 * callback through `emit()`. Core owns dispatch, admission and plugin context.
 */
export abstract class Endpoint<TClient = unknown> {
  readonly [endpointBrand] = true;
  /**
   * Platform SDK or protocol client exposed to plugin code.
   * It must be a distinct object: Endpoint owns framework lifecycle, Client
   * owns platform operations.
   */
  abstract readonly client: TClient;

  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;

  #identity?: EndpointIdentity;
  #events?: EndpointEventGateway;
  #admissionState: 'unbound' | 'pending' | 'active' | 'retired' = 'unbound';
  #pendingEvents: EndpointEvent[] = [];

  /** @internal Bound exactly once by the generation-owned AdapterIndex. */
  [endpointBind](context: AdapterContext, admission?: GenerationAdmissionGate): void {
    if (this.#events) throw new Error(`Endpoint ${context.id} is already bound`);
    this.#identity = Object.freeze({ id: context.id, adapter: context.name });
    this.#events = context.use(endpointEventGatewayToken);
    if (!admission) {
      this.#admissionState = 'active';
      return;
    }
    this.#admissionState = 'pending';
    admission.onActivate(() => {
      if (this.#admissionState !== 'pending') return;
      this.#admissionState = 'active';
      admission.onDeactivate(() => {
        this.#admissionState = 'retired';
        this.#pendingEvents.length = 0;
      });
      const pending = this.#pendingEvents.splice(0);
      for (const event of pending) {
        void this.#events?.receive(event).catch(() => undefined);
      }
    });
  }

  /** The identity is available after AdapterDefinition.create returns. */
  get identity(): EndpointIdentity {
    if (!this.#identity) throw new Error('Endpoint is not bound to a runtime generation');
    return this.#identity;
  }

  /** The only legal platform-to-framework event ingress. */
  protected emit<TPayload, TName extends string>(
    name: TName,
    payload: TPayload,
  ): Promise<unknown> {
    if (!this.#events || !this.#identity) {
      throw new Error('Endpoint emitted before it was bound to a runtime generation');
    }
    const event = Object.freeze({
      name,
      payload,
      endpoint: this.#identity,
      client: this.client,
    });
    if (this.#admissionState === 'pending') {
      if (this.#pendingEvents.length >= PRE_ADMISSION_EVENT_LIMIT) {
        this.#pendingEvents.shift();
      }
      this.#pendingEvents.push(event);
      return Promise.resolve(undefined);
    }
    if (this.#admissionState === 'retired') return Promise.resolve(undefined);
    return this.#events.receive(event);
  }

  /**
   * Lossless native-event projection. Adapters call this before deriving
   * message/notice/request/system events, including for unknown event kinds.
   */
  protected emitPlatform<TEvent, TName extends string>(
    name: TName,
    event: TEvent,
  ): Promise<unknown> {
    return this.emit('platform.receive', Object.freeze({ name, event }));
  }

  abstract start(signal: AbortSignal): void | Promise<void>;
  abstract open(): void;
  abstract close(): void | Promise<void>;
  abstract stop(): void | Promise<void>;
  send?(_request: EndpointSendRequest): string | Promise<string>;
}

class ObjectEndpoint<TClient> extends Endpoint<TClient> {
  readonly client: TClient;
  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;

  readonly #implementation: EndpointImplementation<TClient>;
  readonly #endpointId: string;
  #connection?: EndpointConnectionContext;
  #connectCleanup?: EndpointCleanup;
  #activationCleanup?: EndpointCleanup;
  #started = false;
  #open = false;
  #everOpened = false;
  #stopped = false;

  constructor(implementation: EndpointImplementation<TClient>, context: AdapterContext) {
    super();
    this.#implementation = implementation;
    this.#endpointId = context.endpointId;
    this.client = implementation.client;
    this.management = implementation.management;
    this.control = implementation.control;
    this.content = implementation.content;
  }

  get name(): string {
    return this.#implementation.name ?? this.#endpointId;
  }

  async start(signal: AbortSignal): Promise<void> {
    if (this.#started) return;
    if (this.#stopped) throw new Error(`Endpoint ${this.#endpointId} cannot restart after stop`);
    signal.throwIfAborted();
    const events: EndpointEventSink = Object.freeze({
      emit: <TPayload, TName extends string>(name: TName, payload: TPayload) =>
        this.#publish(name, payload),
      platform: <TEvent, TName extends string>(name: TName, event: TEvent) =>
        this.#publishPlatform(name, event),
      message: <TSegment>(input: EndpointIncomingMessage<TSegment>) =>
        this.#publishMessage(input),
    });
    const connection = Object.freeze({
      signal,
      identity: this.identity,
      events,
    });
    const cleanup = await this.#implementation.connect?.(connection);
    if (cleanup !== undefined && typeof cleanup !== 'function') {
      throw new TypeError(`Endpoint ${this.#endpointId} connect() must return a cleanup function`);
    }
    this.#connection = connection;
    this.#connectCleanup = cleanup || undefined;
    this.#started = true;
  }

  open(): void {
    const connection = this.#connection;
    if (!this.#started || this.#stopped || !connection) {
      throw new Error(`Endpoint ${this.#endpointId} must connect before open`);
    }
    this.#open = true;
    try {
      const cleanup = this.#implementation.activate?.(connection);
      if (cleanup !== undefined && typeof cleanup !== 'function') {
        throw new TypeError(`Endpoint ${this.#endpointId} activate() must return a cleanup function`);
      }
      this.#activationCleanup = cleanup || undefined;
      this.#everOpened = true;
    } catch (error) {
      this.#open = false;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#open = false;
    const cleanup = this.#activationCleanup;
    this.#activationCleanup = undefined;
    await cleanup?.();
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    await this.close();
    const cleanup = this.#connectCleanup;
    this.#connectCleanup = undefined;
    await cleanup?.();
  }

  send(request: EndpointSendRequest): string | Promise<string> {
    if (!this.#implementation.send) {
      throw new Error(`Endpoint ${this.#endpointId} does not support outbound messages`);
    }
    return this.#implementation.send(request);
  }

  #canPublish(): boolean {
    if (this.#stopped) return false;
    // Candidate readiness happens before open; Endpoint's generation gate owns
    // these early events. Once close has run, new transport events are ignored.
    return this.#open || !this.#everOpened;
  }

  #publish<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown> {
    if (!this.#canPublish()) return Promise.resolve(undefined);
    return this.emit(name, payload);
  }

  #publishPlatform<TEvent, TName extends string>(name: TName, event: TEvent): Promise<unknown> {
    if (!this.#canPublish()) return Promise.resolve(undefined);
    return this.emitPlatform(name, event);
  }

  #publishMessage<TSegment>(input: EndpointIncomingMessage<TSegment>): Promise<unknown> {
    return this.#publish('message.receive', Object.freeze({
      ...input,
      conversation: Object.freeze({
        ...input.conversation,
        endpoint: this.identity,
      }),
      endpointId: input.endpointId ?? this.name,
    }));
  }
}

/** @internal Convert the compact authoring form into the Runtime Endpoint contract. */
export function materializeEndpoint<TClient>(
  value: Endpoint<TClient> | EndpointImplementation<TClient>,
  context: AdapterContext,
): Endpoint<TClient> {
  if (isEndpoint(value)) return value as Endpoint<TClient>;
  if (!value || typeof value !== 'object' || !('client' in value)) {
    throw new TypeError(
      `Adapter ${context.id} create() must return an Endpoint or an object with a client`,
    );
  }
  if (value.client === value) {
    throw new TypeError(`Adapter Endpoint ${context.id} must expose a distinct platform client`);
  }
  return new ObjectEndpoint(value as EndpointImplementation<TClient>, context);
}

/** @internal AdapterIndex binding hook; deliberately not exported by name. */
export function bindEndpoint(
  endpoint: Endpoint,
  context: AdapterContext,
  admission?: GenerationAdmissionGate,
): void {
  endpoint[endpointBind](context, admission);
}

/** @internal Cross-generation Endpoint check that survives ESM module re-evaluation. */
export function isEndpoint(value: unknown): value is Endpoint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Endpoint> & {
    readonly [endpointBrand]?: unknown;
    readonly [endpointBind]?: unknown;
  };
  return candidate[endpointBrand] === true
    && typeof candidate[endpointBind] === 'function'
    && typeof candidate.start === 'function'
    && typeof candidate.open === 'function'
    && typeof candidate.close === 'function'
    && typeof candidate.stop === 'function'
    && 'client' in candidate;
}
