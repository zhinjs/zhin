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
  /**
   * ADR 0044: what the Endpoint's static capability profile says per conversation kind. Consumers read
   * these instead of branching on the platform name; a missing kind or field means "not supported".
   */
  readonly kinds?: Readonly<Partial<Record<EndpointConversationKind, EndpointKindCapabilities>>>;
}

export type EndpointConversationKind = 'private' | 'group' | 'channel';

/** How the Endpoint shows "working on it" in this conversation kind. */
export interface EndpointFeedbackCapability {
  readonly mode: 'typing' | 'reaction' | 'status-message' | 'none';
  /** Emoji for `reaction`, text for `status-message`. */
  readonly emoji?: string;
  readonly text?: string;
  /** Refresh interval of a native `typing` indicator. */
  readonly refreshSeconds?: number;
}

/** Serializable consumer view of one conversation kind of a capability profile. */
export interface EndpointKindCapabilities {
  readonly feedback?: EndpointFeedbackCapability;
  /** The Bot can react to a message with an emoji here. */
  readonly reaction: boolean;
  readonly edit: boolean;
  readonly recall: boolean;
  /** Large media must be written to disk before sending (`delivery.spool`). */
  readonly spool: boolean;
  /** Messages here must quote an inbound message (`delivery.proactive === false`). */
  readonly needsReply: boolean;
  /** The group / member lookup ports are usable (`scene.groupInfo`, `scene.memberProfile`). */
  readonly groupInfo: boolean;
  readonly memberProfile: boolean;
}

export type DeliveryStatus = 'sent' | 'suppressed' | 'unsupported' | 'rejected' | 'failed';

export interface DeliveryFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  /** The platform may have accepted the message; resending can duplicate delivery. */
  readonly deliveryUnknown?: true;
}

/** Stable transport evidence; a generic thrown error must never imply safe retry. */
export class EndpointDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly disposition: 'not_sent' | 'rejected' | 'unknown',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EndpointDeliveryError';
  }
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
