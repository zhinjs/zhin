import type { CapabilityId } from '@zhin.js/plugin-runtime';
import type { ConversationRef, MessageRef } from '@zhin.js/im-contract';
export type { EndpointSendPart, EndpointSendResult } from '@zhin.js/im-contract';

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
  /** Admit the complete SDK callback, including asynchronous normalization before emit. */
  run<T>(receive: () => T | Promise<T>): Promise<T>;
  /** Emit a canonical or Adapter-specific event. */
  emit<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown>;
  /** Await generation admission before acknowledging a platform update. */
  emitAccepted<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown>;
  /** Preserve a native platform event before optional canonical projection. */
  platform<TEvent, TName extends string>(name: TName, event: TEvent): Promise<unknown>;
  /** Emit a canonical message and attach this Endpoint's identity automatically. */
  message<TSegment = unknown>(input: EndpointIncomingMessage<TSegment>): Promise<unknown>;
}

/** Local transport facts; generation admission is tracked separately. */
export type EndpointTransportState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'stopped';
