import type { MessageRef } from './identity.js';

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
  /** The platform may have accepted the message; resending can duplicate delivery. */
  readonly deliveryUnknown?: true;
}

/** One completed platform send, in order; a missing id means its identity is unconfirmed. */
export interface EndpointSendPart {
  readonly messageId?: string;
  /** Indices in the endpoint request's top-level payload, when the adapter can preserve them. */
  readonly sourceIndices?: readonly number[];
}

/** Existing endpoints may keep returning a single platform id. */
export type EndpointSendResult = string | Readonly<{ parts: readonly EndpointSendPart[] }>;

export interface DeliveryPart {
  readonly message?: MessageRef;
  readonly sourceIndices?: readonly number[];
  /** Digest of this part alone, only when its exact final plain-text body is verified. */
  readonly outboundTextDigest?: string;
}

/** Stable transport evidence; a generic thrown error must never imply safe retry. */
export class EndpointDeliveryError extends Error {
  readonly parts?: readonly EndpointSendPart[];
  constructor(
    readonly code: string,
    message: string,
    readonly disposition: 'not_sent' | 'rejected' | 'unknown',
    options?: ErrorOptions & { readonly parts?: readonly EndpointSendPart[] },
  ) {
    super(message, options);
    this.name = 'EndpointDeliveryError';
    this.parts = options?.parts;
  }
}

/** A serializable result for every attempted outbound delivery. */
export interface DeliveryReceipt {
  readonly status: DeliveryStatus;
  readonly message?: MessageRef;
  /** All completed platform sends, including slots whose native id is still unknown. */
  readonly parts?: readonly DeliveryPart[];
  /** Host-computed SHA-256 of the final exact plain-text payload; absent for rich/native content. */
  readonly outboundTextDigest?: string;
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
