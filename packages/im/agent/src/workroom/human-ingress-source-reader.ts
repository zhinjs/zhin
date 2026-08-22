import {
  conversationRefKey,
  messageRefKey,
  type ConversationEvent,
  type ConversationEventStore,
} from '@zhin.js/im-contract';
import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import type { HumanIngressSourceAnchor } from './human-ingress.js';

export interface CanonicalHumanIngressSource {
  readonly version: 1;
  readonly ref: string;
  readonly digest: string;
  readonly sequence: number;
  readonly conversationKey: string;
  readonly eventId: string;
  readonly text: string;
  readonly event: ConversationEvent;
}

export interface HumanIngressSourceReaderPort {
  read(source: HumanIngressSourceAnchor): Promise<CanonicalHumanIngressSource>;
}

/** Digest binds the database sequence and complete canonical event payload. */
export function digestHumanIngressConversationEvent(
  sequence: number,
  event: ConversationEvent,
): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Human ingress source sequence must be a positive safe integer');
  }
  return digestCanonicalWorkroomValue({ version: 1, sequence, event });
}

export function humanIngressConversationEventRef(event: ConversationEvent): string {
  requireText(event.eventId, 'eventId');
  return `conversation-event:${event.eventId}`;
}

/**
 * Reads only the canonical ConversationEventStore. The caller-provided anchor
 * is evidence, never content: sequence, ref, conversation and full-event digest
 * all have to name the same durable message.created event.
 */
export class ConversationEventHumanIngressSourceReader
implements HumanIngressSourceReaderPort {
  constructor(readonly store: ConversationEventStore | (() => ConversationEventStore)) {}

  async read(source: HumanIngressSourceAnchor): Promise<CanonicalHumanIngressSource> {
    const anchor = normalizeAnchor(source);
    const eventId = anchor.ref.slice('conversation-event:'.length);
    const store = typeof this.store === 'function' ? this.store() : this.store;
    const events = await store.listBetween(
      parseConversationKey(anchor.conversationKey),
      anchor.sequence - 1,
      anchor.sequence,
      1,
    );
    const selected = events[0];
    if (!selected || selected.sequence !== anchor.sequence) {
      throw new Error('Canonical human ingress source event was not found at the anchored sequence');
    }
    const event = selected.event;
    if (event.type !== 'message.created') {
      throw new Error('Canonical human ingress source must be message.created');
    }
    if (event.eventId !== eventId
      || humanIngressConversationEventRef(event) !== anchor.ref
      || conversationRefKey(event.conversation) !== anchor.conversationKey
      || conversationRefKey(event.message.ref.conversation) !== anchor.conversationKey
      || event.eventId !== `message:${messageRefKey(event.message.ref)}`) {
      throw new Error('Canonical human ingress source ref or conversation does not match the durable event');
    }
    const digest = digestHumanIngressConversationEvent(selected.sequence, event);
    if (digest !== anchor.digest) {
      throw new Error('Canonical human ingress source digest does not match the durable event');
    }
    return deepFreeze({
      version: 1,
      ...anchor,
      eventId,
      text: plainText(event),
      event,
    });
  }
}

/*
 * listBetween requires a structured ConversationRef. The anchor intentionally
 * stores only the canonical key, so use getMessage to recover that structure
 * is impossible without parsing. Conversation keys are canonical JSON in the
 * IM contract; keep parsing private and verify round-trip before use.
 */
function parseConversationKey(key: string): import('@zhin.js/im-contract').ConversationRef {
  const [adapter, endpointId, kind, id, parentKind, parentId, threadId, ...extra] = key.split('\0');
  if (extra.length > 0 || !adapter || !endpointId || !id
    || (kind !== 'private' && kind !== 'group' && kind !== 'channel')
    || (Boolean(parentKind) !== Boolean(parentId))
    || (parentKind && parentKind !== 'private' && parentKind !== 'group' && parentKind !== 'channel')) {
    throw new Error('Human ingress source conversation key is not canonical');
  }
  const parsed: import('@zhin.js/im-contract').ConversationRef = Object.freeze({
    endpoint: Object.freeze({ adapter, id: endpointId }),
    kind,
    id,
    ...(parentKind && parentId
      ? { parent: Object.freeze({
          kind: parentKind as 'private' | 'group' | 'channel',
          id: parentId,
        }) }
      : {}),
    ...(threadId ? { threadId } : {}),
  });
  if (conversationRefKey(parsed) !== key) {
    throw new Error('Human ingress source conversation key is not canonical');
  }
  return parsed;
}

function normalizeAnchor(source: HumanIngressSourceAnchor): HumanIngressSourceAnchor {
  const snapshot = structuredClone(source);
  if (!snapshot || typeof snapshot !== 'object'
    || Object.keys(snapshot).sort().join(',') !== 'conversationKey,digest,ref,sequence') {
    throw new Error('Human ingress source anchor shape is invalid');
  }
  requireText(snapshot.ref, 'ref');
  if (!snapshot.ref.startsWith('conversation-event:')) {
    throw new Error('Human ingress source ref must identify a conversation event');
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(snapshot.digest)) {
    throw new Error('Human ingress source digest must be canonical SHA-256');
  }
  if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1) {
    throw new Error('Human ingress source sequence must be a positive safe integer');
  }
  requireText(snapshot.conversationKey, 'conversationKey');
  return deepFreeze(snapshot);
}

function plainText(event: Extract<ConversationEvent, { type: 'message.created' }>): string {
  return event.message.segments
    .filter(segment => segment.type === 'text')
    .map(segment => String((segment.data as Readonly<{ text?: unknown }>).text ?? ''))
    .join('')
    .trim();
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Human ingress source ${label} must be canonical text`);
  }
}
