import type { ConversationMessage, ConversationEvent, SequencedConversationEvent } from './conversation.js';
import type { ConversationRef, MessageRef } from './identity.js';

export interface ConversationEventStore {
  append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>>;
  getMessage(ref: MessageRef): Promise<ConversationMessage | undefined>;
  /** Latest events in (afterExclusive, throughInclusive], returned in ascending sequence order. */
  listBetween(
    conversation: ConversationRef,
    afterExclusive: number,
    throughInclusive: number,
    limit: number,
  ): Promise<readonly SequencedConversationEvent[]>;
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

  async listBetween(
    conversation: ConversationRef,
    afterExclusive: number,
    throughInclusive: number,
    limit: number,
  ): Promise<readonly SequencedConversationEvent[]> {
    const cap = Math.max(0, Math.floor(limit));
    const latest = [...this.#events.values()]
      .filter((entry) => entry.sequence > afterExclusive && entry.sequence <= throughInclusive)
      .filter((entry) => sameConversation(entry.event.conversation, conversation))
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, cap)
      .reverse();
    return Object.freeze(latest);
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

  async listBetween(
    conversation: ConversationRef,
    afterExclusive: number,
    throughInclusive: number,
    limit: number,
  ): Promise<readonly SequencedConversationEvent[]> {
    let selection = this.events.select('id', 'event_json')
      .where({
        conversation_key: conversationRefKey(conversation),
        id: { $gt: afterExclusive, $lte: throughInclusive },
      });
    selection = selection.orderBy?.('id', 'DESC') ?? selection;
    selection = selection.limit?.(Math.max(0, Math.floor(limit))) ?? selection;
    const rows = await Promise.resolve(selection);
    return Object.freeze(rows.map((row) => Object.freeze({
      sequence: Number(row.id),
      event: freezeConversationData(parseConversationEvent(row.event_json)),
    })).reverse());
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
