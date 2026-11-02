import type { ConversationMessage, ConversationEvent, SequencedConversationEvent } from './conversation.js';
import type { ConversationRef, MessageRef } from './identity.js';

export interface ConversationEventReader {
  getMessage(ref: MessageRef): Promise<ConversationMessage | undefined>;
  /** Message entities in creation order, before an exclusive creation sequence; updates do not consume page slots. */
  listMessages?(conversation: ConversationRef, beforeSequence: number | undefined, limit: number): Promise<readonly SequencedConversationMessage[]>;
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

export interface SequencedConversationMessage {
  readonly sequence: number;
  readonly message: ConversationMessage;
}

interface MessageProjection {
  created?: SequencedConversationMessage;
  latest?: ConversationMessage;
  recalled: boolean;
}

function eventMessageRef(event: ConversationEvent): MessageRef | undefined {
  return event.type === 'message.created' || event.type === 'message.updated' ? event.message.ref
    : event.type === 'message.recalled' ? event.message : undefined;
}

function projectMessage(state: MessageProjection, entry: SequencedConversationEvent): void {
  const { event, sequence } = entry;
  if (event.type === 'message.created') {
    state.created ??= { sequence, message: event.message };
    if (state.latest && (state.latest.revision ?? 0) <= (state.created.message.revision ?? 0)) state.latest = undefined;
  } else if (event.type === 'message.updated' && !state.recalled) {
    if (event.message.revision > (state.latest?.revision ?? state.created?.message.revision ?? 0)) state.latest = event.message;
  } else if (event.type === 'message.recalled') state.recalled = true;
}

function projectedMessage(state: MessageProjection): SequencedConversationMessage | undefined {
  if (!state.created) return undefined;
  const { segments: _segments, contentStatus: _status, outboundTextDigest: _digest, revision: _revision, ...identity } = state.created.message;
  const content = state.latest ?? state.created.message;
  return { sequence: state.created.sequence, message: freezeConversationData({ ...identity, segments: content.segments,
    ...(content.contentStatus ? { contentStatus: content.contentStatus } : {}),
    ...(content.outboundTextDigest ? { outboundTextDigest: content.outboundTextDigest } : {}),
    ...(content.revision === undefined ? {} : { revision: content.revision }),
    ...(state.recalled ? { recalled: true as const } : {}),
  }) };
}

function assertMessageUpdate(event: ConversationEvent): void {
  if (event.type === 'message.updated' && (!Number.isSafeInteger(event.message.revision) || event.message.revision <= 0)) {
    throw new TypeError('Message update revision must be a positive integer');
  }
}

/** Process-local implementation; database hosts provide the same contract. */
export class MemoryConversationEventStore implements ConversationEventStore {
  readonly #events = new Map<string, SequencedConversationEvent>();
  readonly #messages = new Map<string, MessageProjection>();
  readonly #cursors = new Map<string, number>();
  #sequence = 0;

  async append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>> {
    assertMessageUpdate(event);
    const existing = this.#events.get(event.eventId);
    if (existing) return Object.freeze({ appended: false, sequence: existing.sequence });
    const sequence = ++this.#sequence;
    const stored = Object.freeze({ sequence, event: freezeConversationData(event) });
    this.#events.set(event.eventId, stored);
    const ref = eventMessageRef(event);
    if (ref) {
      const key = messageRefKey(ref), state = this.#messages.get(key) ?? { recalled: false };
      projectMessage(state, stored);
      this.#messages.set(key, state);
    }
    return Object.freeze({ appended: true, sequence });
  }

  async getMessage(ref: MessageRef): Promise<ConversationMessage | undefined> {
    const state = this.#messages.get(messageRefKey(ref));
    return state ? projectedMessage(state)?.message : undefined;
  }

  async listMessages(conversation: ConversationRef, beforeSequence: number | undefined, limit: number): Promise<readonly SequencedConversationMessage[]> {
    const cap = Math.max(0, Math.floor(limit));
    if (!cap) return [];
    return [...this.#messages.values()].flatMap(state => {
      const entry = projectedMessage(state);
      return entry && sameConversation(entry.message.ref.conversation, conversation)
        && (beforeSequence === undefined || entry.sequence < beforeSequence) ? [entry] : [];
    }).sort((left, right) => right.sequence - left.sequence).slice(0, cap).reverse();
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

export const CONVERSATION_EVENT_QUERY_MODEL = Object.freeze({
  event_type: { type: 'text' as const, nullable: true },
  endpoint_adapter: { type: 'text' as const, nullable: true }, endpoint_id: { type: 'text' as const, nullable: true },
  conversation_kind: { type: 'text' as const, nullable: true }, conversation_id: { type: 'text' as const, nullable: true },
  parent_kind: { type: 'text' as const, nullable: true }, parent_id: { type: 'text' as const, nullable: true },
  thread_id: { type: 'text' as const, nullable: true }, actor_id: { type: 'text' as const, nullable: true },
  platform_message_id: { type: 'text' as const, nullable: true }, query_version: { type: 'integer' as const, nullable: true },
});

export function conversationEventQueryFields(event: ConversationEvent): Record<string, string | number | null> {
  const conversation = event.conversation;
  const actor = event.type === 'message.created' || event.type === 'message.updated' ? event.message.actor : 'actor' in event ? event.actor : undefined;
  return { event_type: event.type, endpoint_adapter: databaseTextKey(conversation.endpoint.adapter), endpoint_id: databaseTextKey(conversation.endpoint.id),
    conversation_kind: conversation.kind, conversation_id: databaseTextKey(conversation.id), parent_kind: conversation.parent?.kind ?? null,
    parent_id: conversation.parent ? databaseTextKey(conversation.parent.id) : null, thread_id: conversation.threadId === undefined ? null : databaseTextKey(conversation.threadId),
    actor_id: actor ? databaseTextKey(actor.id) : null,
    platform_message_id: eventMessageRef(event) ? databaseTextKey(eventMessageRef(event)!.id) : null, query_version: 1 };
}

export const CONVERSATION_EVENT_MODEL = Object.freeze({
  ...CONVERSATION_EVENT_QUERY_MODEL,
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
    assertMessageUpdate(event);
    const existing = await this.#eventById(event.eventId);
    if (existing) return Object.freeze({ appended: false, sequence: Number(existing.id) });
    try {
      await Promise.resolve(this.events.insert({
        ...conversationEventQueryFields(event),
        event_id: databaseTextKey(event.eventId),
        conversation_key: databaseTextKey(conversationRefKey(event.conversation)),
        message_key: eventMessageRef(event) ? databaseTextKey(messageRefKey(eventMessageRef(event)!)) : '',
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
    const states = await this.#messageStates(ref.conversation, [ref]);
    const state = states.get(messageRefKey(ref));
    return state ? projectedMessage(state)?.message : undefined;
  }

  async listMessages(conversation: ConversationRef, beforeSequence: number | undefined, limit: number): Promise<readonly SequencedConversationMessage[]> {
    const cap = Math.max(0, Math.floor(limit));
    if (!cap) return [];
    const select = async (storedKey: string): Promise<Record<string, unknown>[]> => {
      let rows = this.events.select('id', 'event_json').where({ $and: [
        { conversation_key: storedKey }, { message_key: { $ne: '' } },
        { $or: [{ event_type: 'message.created' }, { event_type: null }] },
        ...(beforeSequence === undefined ? [] : [{ id: { $lt: beforeSequence } }]),
      ] });
      rows = rows.orderBy?.('id', 'DESC') ?? rows;
      rows = rows.limit?.(cap) ?? rows;
      return Promise.resolve(rows);
    };
    const key = conversationRefKey(conversation);
    const encoded = await select(databaseTextKey(key));
    const legacy = await toleratePostgresNul(() => select(key), []);
    const creations = uniqueEventRows([...encoded, ...legacy])
      .map(row => ({ sequence: Number(row.id), event: parseConversationEvent(row.event_json) }))
      .filter((entry): entry is SequencedConversationEvent & { event: Extract<ConversationEvent, { type: 'message.created' }> } =>
        entry.event.type === 'message.created' && sameConversation(entry.event.conversation, conversation))
      .sort((left, right) => right.sequence - left.sequence).slice(0, cap).reverse();
    const states = await this.#messageStates(conversation, creations.map(entry => entry.event.message.ref));
    return creations.flatMap(entry => {
      const state = states.get(messageRefKey(entry.event.message.ref));
      const message = state && projectedMessage(state);
      return message ? [message] : [];
    });
  }

  /** One bounded set of message identities is resolved in batches, including legacy recall rows. */
  async #messageStates(conversation: ConversationRef, refs: readonly MessageRef[]): Promise<Map<string, MessageProjection>> {
    const states = new Map<string, MessageProjection>();
    if (!refs.length) return states;
    const keys = refs.map(messageRefKey);
    const select = (storedKeys: readonly string[]) => Promise.resolve(this.events.select('id', 'event_json')
      .where({ message_key: { $in: storedKeys } }));
    const encoded = await select(keys.map(databaseTextKey));
    const legacy = await toleratePostgresNul(() => select(keys), []);
    const legacyRecalls = (storedKey: string) => Promise.resolve(this.events.select('id', 'event_json').where({ $and: [
      { conversation_key: storedKey }, { message_key: '' }, { $or: [{ event_type: 'message.recalled' }, { event_type: null }] },
    ] }));
    const conversationKey = conversationRefKey(conversation);
    const recalls = await legacyRecalls(databaseTextKey(conversationKey));
    const oldRecalls = await toleratePostgresNul(() => legacyRecalls(conversationKey), []);
    const selected = new Set(keys);
    for (const row of uniqueEventRows([...encoded, ...legacy, ...recalls, ...oldRecalls]).sort((left, right) => Number(left.id) - Number(right.id))) {
      const event = freezeConversationData(parseConversationEvent(row.event_json));
      const ref = eventMessageRef(event);
      if (!ref || !selected.has(messageRefKey(ref))) continue;
      const key = messageRefKey(ref), state = states.get(key) ?? { recalled: false };
      projectMessage(state, { sequence: Number(row.id), event });
      states.set(key, state);
    }
    return states;
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

function uniqueEventRows(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return [...new Map(rows.map(row => [Number(row.id), row])).values()];
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
