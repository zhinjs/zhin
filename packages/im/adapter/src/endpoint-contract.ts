import type { CapabilityId } from '@zhin.js/plugin-runtime';
import type { ConversationRef, MessageRef, EndpointSendResult } from '@zhin.js/im-contract';
export type { EndpointSendPart, EndpointSendResult } from '@zhin.js/im-contract';
import type { EndpointManagement } from './endpoint-management.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointContentPort } from './endpoint-content.js';

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

/** Structured outbound request delivered to one platform Endpoint. */
export interface EndpointSendRequest {
  /** Account/operation cancellation; never serialized directly over a worker boundary. */
  readonly signal?: AbortSignal;
  /** Trusted operation language, resolved by the unified send chain. */
  readonly locale?: import('@zhin.js/plugin-runtime').Locale;
  /** The Endpoint derives its native target from this canonical conversation address. */
  readonly conversation: ConversationRef;
  readonly payload: unknown;
}

/** A conversation address supplied by an Adapter without framework Endpoint identity. */
export type EndpointConversation = Omit<ConversationRef, 'endpoint'>;

/** Compact inbound message shape; the framework attaches Endpoint identity. */
export interface EndpointIncomingMessage<TSegment = unknown> {
  /** Same SDK callback object; never serialized or frozen by the framework. */
  readonly event?: unknown;
  readonly platformSentAt?: number;
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

/** Inbound event methods available to a compact Endpoint implementation. */
export interface EndpointEventSink {
  /** Emit a canonical or Adapter-specific event. */
  emit<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown>;
  /** Preserve a native platform event before optional canonical projection. */
  platform<TEvent, TName extends string>(name: TName, event: TEvent): Promise<unknown>;
  /** Emit a canonical message and attach this Endpoint's identity automatically. */
  message<TSegment = unknown>(input: EndpointIncomingMessage<TSegment>): Promise<unknown>;
}

export type EndpointCleanup = () => void | Promise<void>;

/** Local transport facts; generation admission is tracked separately. */
export type EndpointTransportState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'stopped';

/** Event and identity context for an object-style Endpoint lifecycle hook. */
export interface EndpointActivationContext {
  readonly signal: AbortSignal;
  readonly identity: EndpointIdentity;
  readonly events: EndpointEventSink;
  /**
   * 上报登录后的平台账号 id（运行期事实）。空 / 非法值视为未登录并撤销登记；
   * 仅在 generation active 后才进入进程级 Peer Registry。
   */
  reportSelfUserId(userId: string | undefined): void;
}

/** Context passed once to an object-style Endpoint's `connect` hook. */
export interface EndpointConnectionContext extends EndpointActivationContext {
  /** Register cleanup immediately after acquiring a resource so failed setup can roll it back. */
  onCleanup(cleanup: EndpointCleanup): void;
}

/**
 * Small authoring interface for most Adapters.
 *
 * Runtime owns Endpoint identity, generation admission and lifecycle. `connect`
 * may register cleanup through `onCleanup` or return one cleanup function.
 */
export interface EndpointImplementation<TClient = unknown> {
  readonly client: TClient;
  readonly transportState?: EndpointTransportState;
  readonly name?: string;
  /** 登录后的平台账号 id；open() 后读取一次并上报，空则不上报。 */
  readonly selfUserId?: string;
  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;
  connect?(context: EndpointConnectionContext): void | EndpointCleanup | Promise<void | EndpointCleanup>;
  /** Acquire listeners that must belong only to the active generation. */
  activate?(context: EndpointActivationContext): void | EndpointCleanup;
  send?(request: EndpointSendRequest): EndpointSendResult | Promise<EndpointSendResult>;
}
