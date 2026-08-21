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
    readonly kind: 'private' | 'group' | 'channel';
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
  return true;
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
