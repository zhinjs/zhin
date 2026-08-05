/**
 * Transport-neutral IM identities. Platform adapters translate their native
 * identifiers at their boundary; framework code passes these values unchanged.
 */
export type ConversationKind = 'private' | 'group' | 'channel';

export interface EndpointRef {
  /** Stable AdapterIndex entry id, not a platform display name. */
  readonly id: string;
  /** Adapter feature that owns the endpoint. */
  readonly adapter: string;
}

export interface ConversationRef {
  readonly endpoint: EndpointRef;
  readonly kind: ConversationKind;
  /** Native conversation identifier, never prefixed by `kind:`. */
  readonly id: string;
  /** Optional platform container, for example a guild that owns a channel. */
  readonly parent?: Readonly<{
    readonly kind: 'group' | 'channel';
    readonly id: string;
  }>;
  /** Optional platform thread/topic identifier. */
  readonly threadId?: string;
}

export interface ActorRef {
  /** Stable platform user identifier. Display names must not be used here. */
  readonly id: string;
  readonly displayName?: string;
}

export interface MessageRef {
  readonly conversation: ConversationRef;
  /** Native platform message identifier, never composed with a target. */
  readonly id: string;
}

/** A bridge input that accepts either a structured reference or legacy string. */
export type ConversationTarget = ConversationRef | string;
/** A bridge input that accepts either a structured reference or legacy string. */
export type MessageTarget = MessageRef | string;

export type EndpointOperation = 'send' | 'recall' | 'edit' | 'reaction' | 'typing';

/**
 * Declared endpoint operations. This is intentionally separate from a
 * platform's implementation shape, so callers never need duck typing.
 */
export interface EndpointCapabilities {
  readonly inbound: boolean;
  readonly outbound: boolean;
  readonly operations?: Readonly<Partial<Record<EndpointOperation, true>>>;
}

export type DeliveryStatus = 'sent' | 'suppressed' | 'unsupported' | 'rejected' | 'failed';

export interface DeliveryFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
}

/** A serializable result for every attempted outbound delivery. */
export interface DeliveryReceipt {
  readonly status: DeliveryStatus;
  readonly message?: MessageRef;
  /**
   * Transitional identifier returned by an endpoint that has not yet adopted
   * `MessageRef`. Framework code must not compose or parse this value.
   */
  readonly legacyMessageId?: string;
  readonly failure?: DeliveryFailure;
}

const deliveryStatuses = new Set<DeliveryStatus>([
  'sent',
  'suppressed',
  'unsupported',
  'rejected',
  'failed',
]);

/** Runtime guard for endpoints that already return the structured contract. */
export function isDeliveryReceipt(value: unknown): value is DeliveryReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<DeliveryReceipt>;
  if (typeof receipt.status !== 'string' || !deliveryStatuses.has(receipt.status as DeliveryStatus)) {
    return false;
  }
  if (receipt.legacyMessageId !== undefined && typeof receipt.legacyMessageId !== 'string') {
    return false;
  }
  return true;
}

export interface LegacyConversationTarget {
  readonly kind: ConversationKind;
  readonly id: string;
}

export interface LegacyMessageReference {
  readonly target: string;
  readonly messageId: string;
}

const legacyConversationKinds: Readonly<Record<string, ConversationKind>> = {
  private: 'private',
  direct: 'private',
  c2c: 'private',
  temp: 'private',
  group: 'group',
  channel: 'channel',
};

/**
 * Decodes the legacy `kind:id` representation at an adapter boundary.
 * Unknown prefixes and empty ids are rejected rather than silently guessed.
 */
export function parseLegacyConversationTarget(target: string): LegacyConversationTarget | undefined {
  const separator = target.indexOf(':');
  if (separator <= 0 || separator === target.length - 1) return undefined;

  const kind = legacyConversationKinds[target.slice(0, separator)];
  const id = target.slice(separator + 1);
  return kind ? { kind, id } : undefined;
}

/** Encodes a conversation only for a legacy adapter API that still needs it. */
export function formatLegacyConversationTarget(target: LegacyConversationTarget): string {
  return `${target.kind}:${target.id}`;
}

/** Encodes a structured conversation only when crossing a legacy adapter boundary. */
export function formatLegacyConversationRef(conversation: ConversationRef): string {
  return formatLegacyConversationTarget(conversation);
}

/**
 * Returns the native platform conversation id from a legacy `kind:id` target.
 * Unknown target formats stay opaque.
 */
export function nativeConversationId(target: string): string {
  return parseLegacyConversationTarget(target)?.id ?? target;
}

/**
 * Parses the historical `target:messageId` format from the final separator so
 * an already-prefixed target (`group:123:456`) is not corrupted.
 */
export function parseLegacyMessageReference(reference: string): LegacyMessageReference | undefined {
  const separator = reference.lastIndexOf(':');
  if (separator <= 0 || separator === reference.length - 1) return undefined;
  return {
    target: reference.slice(0, separator),
    messageId: reference.slice(separator + 1),
  };
}

/** Encodes a message only for a legacy adapter API that still returns strings. */
export function formatLegacyMessageReference(reference: LegacyMessageReference): string {
  return `${reference.target}:${reference.messageId}`;
}

/** Encodes a structured message only when crossing a legacy adapter boundary. */
export function formatLegacyMessageRef(message: MessageRef): string {
  return formatLegacyMessageReference({
    target: formatLegacyConversationRef(message.conversation),
    messageId: message.id,
  });
}

/**
 * Checks a declared operation without inspecting platform implementation
 * details. Sending requires outbound capability; all other operations opt in.
 */
export function supportsEndpointOperation(
  capabilities: EndpointCapabilities,
  operation: EndpointOperation,
): boolean {
  if (operation === 'send') return capabilities.outbound;
  return capabilities.operations?.[operation] === true;
}
