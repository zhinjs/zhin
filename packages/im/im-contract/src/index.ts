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

/** Canonical IM segment and media contracts. Platform-only fields belong in `platform`. */
export interface SegmentBase {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly platform?: Readonly<Record<string, unknown>>;
}

export interface MediaRef {
  readonly kind: 'url' | 'path' | 'base64' | 'file';
  readonly value: string;
  readonly mime_type?: string;
  readonly file_name?: string;
  readonly size?: number;
}

export interface TextSegment extends SegmentBase {
  readonly type: 'text';
  readonly data: Readonly<{ text: string }>;
}

export interface MentionSegment extends SegmentBase {
  readonly type: 'mention';
  readonly data: Readonly<{ target: string; name?: string }>;
}

export interface MediaSegment extends SegmentBase {
  readonly type: 'image' | 'audio' | 'video' | 'file';
  readonly data: Readonly<{
    media: MediaRef;
    alt?: string;
    duration?: number;
    name?: string;
  }>;
}

export interface ReplySegment extends SegmentBase {
  readonly type: 'reply';
  readonly data: Readonly<{ message_id: string }>;
}

export interface ForwardEntry {
  readonly actor?: ActorRef;
  readonly timestamp?: number;
  readonly segments: readonly Segment[];
}

export interface ForwardSegment extends SegmentBase {
  readonly type: 'forward';
  readonly data: Readonly<{
    forward_id: string;
    title?: string;
    entries?: readonly ForwardEntry[];
  }>;
}

export type Segment =
  | TextSegment
  | MentionSegment
  | MediaSegment
  | ReplySegment
  | ForwardSegment
  | SegmentBase;

export interface MessageRef {
  readonly conversation: ConversationRef;
  /** Native platform message identifier, never composed with a target. */
  readonly id: string;
}

export interface ConversationMessage {
  readonly ref: MessageRef;
  readonly actor?: ActorRef;
  readonly segments: readonly Segment[];
  readonly timestamp: number;
  readonly replyTo?: MessageRef;
}

export type ConversationReference =
  | Readonly<{ kind: 'message'; message: MessageRef }>
  | Readonly<{ kind: 'forward'; conversation: ConversationRef; forwardId: string }>
  | Readonly<{ kind: 'media'; conversation: ConversationRef; media: MediaRef }>;

export type ConversationResolution =
  | Readonly<{ status: 'resolved'; reference: ConversationReference; value: ConversationMessage | readonly ForwardEntry[] | MediaRef }>
  | Readonly<{ status: 'not_found' | 'unsupported' | 'forbidden' | 'expired' | 'failed'; code: string; message?: string }>;

interface ConversationEventBase {
  readonly eventId: string;
  readonly conversation: ConversationRef;
  readonly timestamp: number;
}

export type ConversationEvent =
  | (ConversationEventBase & Readonly<{ type: 'message.created'; message: ConversationMessage }>)
  | (ConversationEventBase & Readonly<{ type: 'message.recalled'; message: MessageRef; actor?: ActorRef; operator?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'message.reaction_changed'; message: MessageRef; actor?: ActorRef; reaction: string; operation: 'added' | 'removed' }>)
  | (ConversationEventBase & Readonly<{ type: 'conversation.poked'; actor?: ActorRef; target?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'member.joined'; member: ActorRef; actor?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'member.left'; member: ActorRef; actor?: ActorRef; reason?: 'left' | 'removed' }>)
  | (ConversationEventBase & Readonly<{ type: 'member.muted'; member: ActorRef; actor?: ActorRef; durationSeconds: number }>)
  | (ConversationEventBase & Readonly<{ type: 'member.unmuted'; member: ActorRef; actor?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'member.role_changed'; member: ActorRef; actor?: ActorRef; role: string; enabled: boolean }>);

export interface SequencedConversationEvent {
  readonly sequence: number;
  readonly event: ConversationEvent;
}

/** AI-neutral, explicitly untrusted projection of conversation facts. */
export interface ConversationContextBlock {
  readonly kind: 'conversation_event';
  readonly sequence: number;
  readonly eventType: ConversationEvent['type'];
  readonly text: string;
}

export interface ConversationEventStore {
  append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>>;
  getMessage(ref: MessageRef): Promise<ConversationMessage | undefined>;
  listAfter(conversation: ConversationRef, sequence: number, limit: number): Promise<readonly SequencedConversationEvent[]>;
  getCursor(consumer: string, conversation: ConversationRef): Promise<number>;
  commitCursor(consumer: string, conversation: ConversationRef, sequence: number): Promise<void>;
}

/** Process-local implementation; database hosts provide the same contract. */
export class MemoryConversationEventStore implements ConversationEventStore {
  readonly #events = new Map<string, SequencedConversationEvent>();
  readonly #messages = new Map<string, ConversationMessage>();
  readonly #cursors = new Map<string, number>();
  #sequence = 0;

  async append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>> {
    const existing = this.#events.get(event.eventId);
    if (existing) return Object.freeze({ appended: false, sequence: existing.sequence });
    const sequence = ++this.#sequence;
    const stored = Object.freeze({ sequence, event: freezeConversationData(event) });
    this.#events.set(event.eventId, stored);
    if (event.type === 'message.created') {
      this.#messages.set(messageRefKey(event.message.ref), event.message);
    }
    return Object.freeze({ appended: true, sequence });
  }

  async getMessage(ref: MessageRef): Promise<ConversationMessage | undefined> {
    return this.#messages.get(messageRefKey(ref));
  }

  async listAfter(conversation: ConversationRef, sequence: number, limit: number): Promise<readonly SequencedConversationEvent[]> {
    const cap = Math.max(0, Math.floor(limit));
    return Object.freeze([...this.#events.values()]
      .filter((entry) => entry.sequence > sequence && sameConversation(entry.event.conversation, conversation))
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, cap));
  }

  async getCursor(consumer: string, conversation: ConversationRef): Promise<number> {
    return this.#cursors.get(cursorKey(consumer, conversation)) ?? 0;
  }

  async commitCursor(consumer: string, conversation: ConversationRef, sequence: number): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Conversation cursor must be a non-negative integer');
    const key = cursorKey(consumer, conversation);
    const current = this.#cursors.get(key) ?? 0;
    if (sequence < current) throw new Error('Conversation cursor cannot move backwards');
    this.#cursors.set(key, sequence);
  }
}

export const CONVERSATION_EVENT_MODEL = Object.freeze({
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  event_id: { type: 'text' as const, nullable: false, unique: true },
  conversation_key: { type: 'text' as const, nullable: false },
  message_key: { type: 'text' as const, default: '' },
  event_json: { type: 'text' as const, nullable: false },
  time: { type: 'integer' as const, nullable: false },
});

export const CONVERSATION_CURSOR_MODEL = Object.freeze({
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  cursor_key: { type: 'text' as const, nullable: false, unique: true },
  sequence: { type: 'integer' as const, nullable: false },
});

type ConversationDbSelection = PromiseLike<Record<string, unknown>[]> & {
  where(query: Record<string, unknown>): ConversationDbSelection;
  orderBy?(field: string, direction?: 'ASC' | 'DESC'): ConversationDbSelection;
  limit?(count: number): ConversationDbSelection;
};

export interface ConversationDbModel {
  select(...fields: string[]): ConversationDbSelection;
  insert(row: Record<string, unknown>): unknown;
  update(patch: Record<string, unknown>): { where(query: Record<string, unknown>): unknown };
}

/** Durable implementation; composition roots supply DatabaseHost models. */
export class DatabaseConversationEventStore implements ConversationEventStore {
  constructor(
    private readonly events: ConversationDbModel,
    private readonly cursors: ConversationDbModel,
  ) {}

  async append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>> {
    const existing = await this.#eventById(event.eventId);
    if (existing) return Object.freeze({ appended: false, sequence: Number(existing.id) });
    try {
      await Promise.resolve(this.events.insert({
        event_id: event.eventId,
        conversation_key: conversationRefKey(event.conversation),
        message_key: event.type === 'message.created' ? messageRefKey(event.message.ref) : '',
        event_json: JSON.stringify(event),
        time: event.timestamp,
      }));
    } catch (error) {
      const raced = await this.#eventById(event.eventId);
      if (!raced) throw error;
      return Object.freeze({ appended: false, sequence: Number(raced.id) });
    }
    const inserted = await this.#eventById(event.eventId);
    if (!inserted) throw new Error('Conversation event insert did not become visible');
    return Object.freeze({ appended: true, sequence: Number(inserted.id) });
  }

  async getMessage(ref: MessageRef): Promise<ConversationMessage | undefined> {
    const rows = await this.events.select('id', 'event_json')
      .where({ message_key: messageRefKey(ref) })
      .orderBy?.('id', 'DESC')
      .limit?.(1) ?? [];
    const row = (await Promise.resolve(rows))[0];
    if (!row) return undefined;
    const event = parseConversationEvent(row.event_json);
    return event.type === 'message.created' ? event.message : undefined;
  }

  async listAfter(conversation: ConversationRef, sequence: number, limit: number): Promise<readonly SequencedConversationEvent[]> {
    let selection = this.events.select('id', 'event_json')
      .where({ conversation_key: conversationRefKey(conversation), id: { $gt: sequence } });
    selection = selection.orderBy?.('id', 'ASC') ?? selection;
    selection = selection.limit?.(Math.max(0, Math.floor(limit))) ?? selection;
    const rows = await Promise.resolve(selection);
    return Object.freeze(rows.map((row) => Object.freeze({
      sequence: Number(row.id),
      event: freezeConversationData(parseConversationEvent(row.event_json)),
    })));
  }

  async getCursor(consumer: string, conversation: ConversationRef): Promise<number> {
    const rows = await this.cursors.select('sequence')
      .where({ cursor_key: cursorKey(consumer, conversation) })
      .limit?.(1) ?? [];
    return Number((await Promise.resolve(rows))[0]?.sequence ?? 0);
  }

  async commitCursor(consumer: string, conversation: ConversationRef, sequence: number): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Conversation cursor must be a non-negative integer');
    const key = cursorKey(consumer, conversation);
    const current = await this.getCursor(consumer, conversation);
    if (sequence < current) throw new Error('Conversation cursor cannot move backwards');
    if (current === 0) {
      try {
        await Promise.resolve(this.cursors.insert({ cursor_key: key, sequence }));
        return;
      } catch {
        // A concurrent insert owns the key; update it below after rechecking.
      }
    }
    // Keep the monotonic invariant in the database predicate itself. A
    // read-then-update check can still regress when two successful turns commit
    // the same session cursor concurrently from different processes.
    await Promise.resolve(this.cursors.update({ sequence }).where({
      cursor_key: key,
      sequence: { $lte: sequence },
    }));
  }

  async #eventById(eventId: string): Promise<Record<string, unknown> | undefined> {
    const selected = this.events.select('id', 'event_json').where({ event_id: eventId });
    const limited = selected.limit?.(1) ?? selected;
    return (await Promise.resolve(limited))[0];
  }
}

function parseConversationEvent(value: unknown): ConversationEvent {
  if (typeof value !== 'string') throw new TypeError('Conversation event row has invalid JSON');
  return JSON.parse(value) as ConversationEvent;
}

function sameConversation(left: ConversationRef, right: ConversationRef): boolean {
  return left.endpoint.id === right.endpoint.id
    && left.endpoint.adapter === right.endpoint.adapter
    && left.kind === right.kind
    && left.id === right.id
    && left.parent?.kind === right.parent?.kind
    && left.parent?.id === right.parent?.id
    && left.threadId === right.threadId;
}

export function conversationRefKey(conversation: ConversationRef): string {
  return `${conversation.endpoint.adapter}\0${conversation.endpoint.id}\0${conversation.kind}\0${conversation.id}\0${conversation.parent?.kind ?? ''}\0${conversation.parent?.id ?? ''}\0${conversation.threadId ?? ''}`;
}

export function messageRefKey(ref: MessageRef): string {
  return `${conversationRefKey(ref.conversation)}\0${ref.id}`;
}

function cursorKey(consumer: string, conversation: ConversationRef): string {
  return `${consumer}\0${conversationRefKey(conversation)}`;
}

function freezeConversationData<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeConversationData(entry))) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, freezeConversationData(entry)]))) as T;
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
