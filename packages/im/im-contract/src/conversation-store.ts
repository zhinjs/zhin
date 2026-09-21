import type { ConversationMessage, ConversationEvent, SequencedConversationEvent } from './conversation.js';
import type { ConversationRef, MessageRef } from './identity.js';

export interface ConversationEventReader {
  getMessage(ref: MessageRef): Promise<ConversationMessage | undefined>;
  /** Latest events in (afterExclusive, throughInclusive], returned in ascending sequence order. */
  listBetween(
    conversation: ConversationRef,
    afterExclusive: number,
    throughInclusive: number,
    limit: number,
  ): Promise<readonly SequencedConversationEvent[]>;
  getCursor(consumer: string, conversation: ConversationRef): Promise<number>;
}

export interface ConversationEventWriter {
  append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>>;
  commitCursor(consumer: string, conversation: ConversationRef, sequence: number): Promise<void>;
}

export interface ConversationEventStore extends ConversationEventReader, ConversationEventWriter {}

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
  time: { type: 'bigint' as const, nullable: false },
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
        event_id: databaseTextKey(event.eventId),
        conversation_key: databaseTextKey(conversationRefKey(event.conversation)),
        message_key: event.type === 'message.created' ? databaseTextKey(messageRefKey(event.message.ref)) : '',
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
    const key = messageRefKey(ref);
    const select = async (storedKey: string): Promise<Record<string, unknown>[]> => {
      const rows = this.events.select('id', 'event_json')
        .where({ message_key: storedKey })
        .orderBy?.('id', 'DESC')
        .limit?.(1) ?? [];
      return Promise.resolve(rows);
    };
    const encoded = await select(databaseTextKey(key));
    const legacy = await toleratePostgresNul(() => select(key), []);
    const row = [...encoded, ...legacy]
      .sort((left, right) => Number(right.id) - Number(left.id))[0];
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
    const key = conversationRefKey(conversation);
    const select = async (storedKey: string): Promise<Record<string, unknown>[]> => {
      let selection = this.events.select('id', 'event_json')
        .where({
          conversation_key: storedKey,
          id: { $gt: afterExclusive, $lte: throughInclusive },
        });
      selection = selection.orderBy?.('id', 'DESC') ?? selection;
      selection = selection.limit?.(Math.max(0, Math.floor(limit))) ?? selection;
      return Promise.resolve(selection);
    };
    const encoded = await select(databaseTextKey(key));
    const legacy = await toleratePostgresNul(() => select(key), []);
    const rows = [...encoded, ...legacy]
      .sort((left, right) => Number(right.id) - Number(left.id))
      .slice(0, Math.max(0, Math.floor(limit)));
    return Object.freeze(rows.map((row) => Object.freeze({
      sequence: Number(row.id),
      event: freezeConversationData(parseConversationEvent(row.event_json)),
    })).reverse());
  }

  async getCursor(consumer: string, conversation: ConversationRef): Promise<number> {
    const key = cursorKey(consumer, conversation);
    const select = async (storedKey: string): Promise<Record<string, unknown>[]> => {
      const rows = this.cursors.select('sequence')
        .where({ cursor_key: storedKey })
        .limit?.(1) ?? [];
      return Promise.resolve(rows);
    };
    const encoded = await select(databaseTextKey(key));
    const legacy = await toleratePostgresNul(() => select(key), []);
    return Math.max(
      Number(encoded[0]?.sequence ?? 0),
      Number(legacy[0]?.sequence ?? 0),
    );
  }

  async commitCursor(consumer: string, conversation: ConversationRef, sequence: number): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Conversation cursor must be a non-negative integer');
    const key = databaseTextKey(cursorKey(consumer, conversation));
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
    const legacyKey = cursorKey(consumer, conversation);
    await toleratePostgresNul(
      () => Promise.resolve(this.cursors.update({ sequence }).where({
        cursor_key: legacyKey,
        sequence: { $lte: sequence },
      })),
      undefined,
    );
  }

  async #eventById(eventId: string): Promise<Record<string, unknown> | undefined> {
    const select = async (storedKey: string): Promise<Record<string, unknown> | undefined> => {
      const selected = this.events.select('id', 'event_json').where({ event_id: storedKey });
      const limited = selected.limit?.(1) ?? selected;
      return (await Promise.resolve(limited))[0];
    };
    const encoded = await select(databaseTextKey(eventId));
    if (encoded && parseConversationEvent(encoded.event_json).eventId === eventId) return encoded;
    const legacy = await toleratePostgresNul(() => select(eventId), undefined);
    return legacy && parseConversationEvent(legacy.event_json).eventId === eventId ? legacy : undefined;
  }
}

async function toleratePostgresNul<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid byte sequence.*(?:0x00|U\+0000)/iu.test(message)) return fallback;
    throw error;
  }
}

function parseConversationEvent(value: unknown): ConversationEvent {
  if (typeof value !== 'string') throw new TypeError('Conversation event row has invalid JSON');
  return JSON.parse(value) as ConversationEvent;
}

/**
 * Database text columns cannot represent every JavaScript string. PostgreSQL
 * rejects U+0000 in particular, while canonical IM keys deliberately use it as
 * an unambiguous separator. Keep canonical keys unchanged in memory and encode
 * only at the durable storage boundary. Percent is escaped first so the format
 * remains collision-free and reversible.
 */
function databaseTextKey(value: string): string {
  return `k1:${value.replaceAll('%', '%25').replaceAll('\0', '%00')}`;
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
