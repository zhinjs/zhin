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
  /**
   * #1250 b114: which of `refs` carry a `message.interaction_answered` event, at any sequence, as
   * {@link messageRefKey} keys. Optional: a store without it only has the events a read returns.
   */
  listInteractionAnswered?(refs: readonly MessageRef[]): Promise<ReadonlySet<string>>;
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
    : event.type === 'message.recalled' || event.type === 'message.interaction_answered' ? event.message : undefined;
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
  const { segments: _segments, contentStatus: _status, outboundTextDigest: _digest, inboundTextDigest: _inbound, revision: _revision, ...identity } = state.created.message;
  const content = state.latest ?? state.created.message;
  return { sequence: state.created.sequence, message: freezeConversationData({ ...identity, segments: content.segments,
    ...(content.contentStatus ? { contentStatus: content.contentStatus } : {}),
    ...(content.outboundTextDigest ? { outboundTextDigest: content.outboundTextDigest } : {}),
    ...(content.inboundTextDigest ? { inboundTextDigest: content.inboundTextDigest } : {}),
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
  readonly #answered = new Set<string>();
  #sequence = 0;

  async append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>> {
    assertMessageUpdate(event);
    const existing = this.#events.get(event.eventId);
    if (existing) return Object.freeze({ appended: false, sequence: existing.sequence });
    const sequence = ++this.#sequence;
    const stored = Object.freeze({ sequence, event: freezeConversationData(event) });
    this.#events.set(event.eventId, stored);
    if (event.type === 'message.interaction_answered') {
      this.#answered.add(messageRefKey(event.message));
      return Object.freeze({ appended: true, sequence });
    }
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

  async listInteractionAnswered(refs: readonly MessageRef[]): Promise<ReadonlySet<string>> {
    return new Set(refs.map(messageRefKey).filter(key => this.#answered.has(key)));
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
  platform_message_id: { type: 'text' as const, nullable: true },
  message_revision: { type: 'integer' as const, nullable: true }, query_version: { type: 'integer' as const, nullable: true },
});

export function conversationEventQueryFields(event: ConversationEvent): Record<string, string | number | null> {
  const conversation = event.conversation;
  const actor = event.type === 'message.created' || event.type === 'message.updated' ? event.message.actor : 'actor' in event ? event.actor : undefined;
  return { event_type: event.type, endpoint_adapter: databaseTextKey(conversation.endpoint.adapter), endpoint_id: databaseTextKey(conversation.endpoint.id),
    conversation_kind: conversation.kind, conversation_id: databaseTextKey(conversation.id), parent_kind: conversation.parent?.kind ?? null,
    parent_id: conversation.parent ? databaseTextKey(conversation.parent.id) : null, thread_id: conversation.threadId === undefined ? null : databaseTextKey(conversation.threadId),
    actor_id: actor ? databaseTextKey(actor.id) : null,
    platform_message_id: eventMessageRef(event) ? databaseTextKey(eventMessageRef(event)!.id) : null,
    message_key: eventMessageRef(event) ? databaseTextKey(messageRefKey(eventMessageRef(event)!)) : '',
    message_revision: event.type === 'message.created' || event.type === 'message.updated' ? event.message.revision ?? 0 : 0, query_version: 1 };
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

interface ConversationDbAggregation extends PromiseLike<Record<string, unknown>[]> {
  min(field: string, alias?: string): ConversationDbAggregation;
  max(field: string, alias?: string): ConversationDbAggregation;
  groupBy(...fields: string[]): ConversationDbAggregation;
  where(query: Record<string, unknown>): ConversationDbAggregation;
}

export interface ConversationDbModel {
  aggregate?(): ConversationDbAggregation;
  select(...fields: string[]): ConversationDbSelection;
  insert(row: Record<string, unknown>): unknown;
  update(patch: Record<string, unknown>): { where(query: Record<string, unknown>): unknown };
}

/** A stored row the reader skipped: its id and why, never its content. */
export interface InvalidConversationEventRow {
  readonly table: 'conversation_events';
  readonly id: string;
  readonly reason: StoredConversationEventProblem;
}

export interface DatabaseConversationEventStoreOptions {
  /**
   * Where skipped rows are reported (default: `console.warn`). Each row id is reported once, the
   * first {@link INVALID_ROW_REPORT_LIMIT} of them per store; after that one notice (id `*`,
   * reason `reports_suppressed`) says the rest go unreported.
   */
  readonly onInvalidRow?: (row: InvalidConversationEventRow) => void;
}

/** Message keys per `listInteractionAnswered` query (bounded `IN` lists). */
const ANSWERED_LOOKUP_BATCH = 200;

/** Distinct bad rows one store reports before going quiet. */
export const INVALID_ROW_REPORT_LIMIT = 20;

/**
 * Durable implementation; composition roots supply DatabaseHost models.
 *
 * A row whose `event_json` does not parse or is not a valid event (#1250: such rows are kept, not
 * deleted, by `migrateConversationColumns`) is skipped by every reader with a rate-limited report,
 * so one damaged row never makes a conversation's history unreadable. Limited pages read on past
 * skipped rows, so a page still holds `limit` valid events while there are more.
 */
export class DatabaseConversationEventStore implements ConversationEventStore {
  readonly #reported = new Set<string>();
  readonly #report: (row: InvalidConversationEventRow) => void;
  #suppressedNoticeSent = false;

  constructor(
    private readonly events: ConversationDbModel,
    private readonly cursors: ConversationDbModel,
    options: DatabaseConversationEventStoreOptions = {},
  ) {
    this.#report = options.onInvalidRow ?? (row => {
      console.warn(`[conversation-store] skipped stored event | table: ${row.table} | id: ${row.id} | reason: ${row.reason}`);
    });
  }

  /** The row's event, or undefined (reported, rate-limited) when the row is damaged. */
  #event(row: Record<string, unknown>): ConversationEvent | undefined {
    const read = readStoredConversationEvent(row.event_json);
    if (read.ok) return freezeConversationData(read.event);
    const id = String(row.id);
    if (!this.#reported.has(id)) {
      if (this.#reported.size < INVALID_ROW_REPORT_LIMIT) {
        this.#reported.add(id);
        try { this.#report({ table: 'conversation_events', id, reason: read.reason }); } catch { /* reporting never breaks a read */ }
      } else if (!this.#suppressedNoticeSent) {
        this.#suppressedNoticeSent = true;
        try { this.#report({ table: 'conversation_events', id: '*', reason: 'reports_suppressed' }); } catch { /* reporting never breaks a read */ }
      }
    }
    return undefined;
  }

  async append(event: ConversationEvent): Promise<Readonly<{ appended: boolean; sequence: number }>> {
    assertMessageUpdate(event);
    const existing = await this.#eventById(event.eventId);
    if (existing) return Object.freeze({ appended: false, sequence: Number(existing.id) });
    try {
      const insertResult = await Promise.resolve(this.events.insert({
        ...conversationEventQueryFields(event),
        event_id: databaseTextKey(event.eventId),
        conversation_key: databaseTextKey(conversationRefKey(event.conversation)),
        event_json: JSON.stringify(event),
        time: event.timestamp,
      }));
      const insertedSequence = extractInsertedSequence(insertResult);
      if (insertedSequence !== undefined) {
        return Object.freeze({ appended: true, sequence: insertedSequence });
      }
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
    const select = async (storedKey: string, before: number | undefined): Promise<Record<string, unknown>[]> => {
      let rows = this.events.select('id', 'event_json').where({ $and: [
        { conversation_key: storedKey }, { message_key: { $ne: '' } },
        { $or: [{ event_type: 'message.created' }, { event_type: null }] },
        ...(before === undefined ? [] : [{ id: { $lt: before } }]),
      ] });
      rows = rows.orderBy?.('id', 'DESC') ?? rows;
      rows = rows.limit?.(cap) ?? rows;
      return Promise.resolve(rows);
    };
    const key = conversationRefKey(conversation);
    type Creation = { sequence: number; event: Extract<ConversationEvent, { type: 'message.created' }> };
    const creations: Creation[] = [];
    // Reads on past rows that are skipped (damaged) or belong elsewhere, so `cap` stays a real page size.
    for (let before = beforeSequence; ;) {
      const encoded = await select(databaseTextKey(key), before);
      const legacy = await toleratePostgresNul(() => select(key, before), []);
      const rows = uniqueEventRows([...encoded, ...legacy]).sort((left, right) => Number(right.id) - Number(left.id)).slice(0, cap);
      for (const row of rows) {
        const event = this.#event(row);
        if (event?.type === 'message.created' && sameConversation(event.conversation, conversation)) {
          creations.push({ sequence: Number(row.id), event });
        }
      }
      if (creations.length >= cap || rows.length < cap) break;
      before = Number(rows.at(-1)?.id);
    }
    creations.sort((left, right) => right.sequence - left.sequence).splice(cap);
    creations.reverse();
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
    if (this.events.aggregate) {
      // This is an event-sequence boundary, not a cross-query SQL/MVCC snapshot.
      const [latest] = await this.events.aggregate().max('id', 'through');
      const through = Number(latest?.through ?? 0), conversationKey = conversationRefKey(conversation);
      const unindexed = async (storedKeys: readonly string[], storedConversation: string) => {
        const selection = this.events.select('id').where({ $and: [
          { id: { $lte: through } }, { message_revision: null }, { $or: [
            { message_key: { $in: storedKeys } },
            { $and: [{ conversation_key: storedConversation }, { message_key: '' },
              { $or: [{ event_type: 'message.recalled' }, { event_type: null }] }] },
          ] },
        ] });
        // A third-party model without bounded selections keeps its existing JSON reader.
        return selection.limit ? (await selection.limit(1)).length > 0 : true;
      };
      const encoded = await unindexed(keys.map(databaseTextKey), databaseTextKey(conversationKey));
      const legacy = encoded ? false : await toleratePostgresNul(() => unindexed(keys, conversationKey), false);
      if (!encoded && !legacy) return this.#indexedMessageStates(refs, through);
      // Older binaries may still write nullable metadata; preserve the established JSON reader until rebuilt.
    }
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
      const event = this.#event(row);
      if (!event) continue;
      const ref = eventMessageRef(event);
      if (!ref || !selected.has(messageRefKey(ref))) continue;
      const key = messageRefKey(ref), state = states.get(key) ?? { recalled: false };
      projectMessage(state, { sequence: Number(row.id), event });
      states.set(key, state);
    }
    return states;
  }

  /** Resolve only the selected bodies; aggregate scans never materialize cumulative JSON revisions. */
  async #indexedMessageStates(refs: readonly MessageRef[], through: number): Promise<Map<string, MessageProjection>> {
    const keys = refs.map(messageRefKey), selected = new Set(keys), aliases = new Map<string, string>();
    for (const key of keys) { aliases.set(key, key); aliases.set(databaseTextKey(key), key); }
    type Keyed = { key: string; row: Record<string, unknown> };
    const keyed = (rows: readonly Record<string, unknown>[]): Keyed[] | undefined => {
      const result: Keyed[] = [];
      for (const row of rows) {
        const key = aliases.get(String(row.message_key));
        if (!key) return undefined;
        result.push({ key, row });
      }
      return result;
    };
    // Some drivers (Node 22 node:sqlite) truncate returned TEXT at the first NUL, so a grouped legacy
    // key cannot always be mapped back from the row; re-read those per key and attribute by the query.
    const batches = async (read: (stored: readonly string[]) => PromiseLike<Record<string, unknown>[]> | undefined): Promise<Keyed[]> => {
      const run = (stored: readonly string[]) => toleratePostgresNul(() => Promise.resolve(read(stored) ?? []), []);
      const encoded = (await Promise.resolve(read(keys.map(databaseTextKey)) ?? [])).flatMap(row => keyed([row]) ?? []);
      const legacy = await run(keys);
      const resolved = keyed(legacy);
      if (resolved) return [...encoded, ...resolved];
      const perKey: Keyed[] = [];
      for (const key of keys) for (const row of await run([key])) perKey.push({ key, row });
      return [...encoded, ...perKey];
    };
    const first = await batches(stored => this.events.aggregate!().min('id', 'sequence').groupBy('message_key', 'event_type')
      .where({ $and: [{ id: { $lte: through } }, { message_key: { $in: stored } }, { event_type: { $in: ['message.created', 'message.recalled'] } }] }));
    const creations = new Map<string, number>(), recalls = new Map<string, number>();
    const retainFirst = (map: Map<string, number>, key: string, sequence: number) => map.set(key, Math.min(map.get(key) ?? sequence, sequence));
    for (const { key, row } of first) retainFirst(row.event_type === 'message.created' ? creations : recalls, key, Number(row.sequence));
    const scope = (stored: readonly string[], revisions?: ReadonlyMap<string, number>) => stored.flatMap(key => {
      const canonical = aliases.get(key)!, recall = recalls.get(canonical), revision = revisions?.get(canonical);
      return revisions && revision === undefined ? [] : [{ message_key: key,
        ...(recall === undefined ? {} : { id: { $lt: recall } }), ...(revision === undefined ? {} : { message_revision: revision }) }];
    });
    const highest = await batches(stored => this.events.aggregate!().max('message_revision', 'revision').groupBy('message_key')
      .where({ $and: [{ id: { $lte: through } }, { event_type: 'message.updated' }, { $or: scope(stored) }] }));
    const revisions = new Map<string, number>();
    for (const { key, row } of highest) {
      if (row.revision === null || row.revision === undefined) continue;
      revisions.set(key, Math.max(revisions.get(key) ?? 0, Number(row.revision)));
    }
    const updates = new Map<string, number>();
    if (revisions.size) {
      const selected = await batches(stored => {
        const scoped = scope(stored, revisions);
        return scoped.length ? this.events.aggregate!().min('id', 'sequence').groupBy('message_key')
          .where({ $and: [{ id: { $lte: through } }, { event_type: 'message.updated' }, { $or: scoped }] }) : undefined;
      });
      for (const { key, row } of selected) {
        if (row.sequence !== null && row.sequence !== undefined) retainFirst(updates, key, Number(row.sequence));
      }
    }
    const ids = [...new Set([...creations.values(), ...recalls.values(), ...updates.values()])];
    const states = new Map<string, MessageProjection>();
    if (!ids.length) return states;
    const rows = await this.events.select('id', 'event_json').where({ id: { $in: ids } });
    for (const row of rows.sort((left, right) => Number(left.id) - Number(right.id))) {
      const event = this.#event(row);
      const ref = event && eventMessageRef(event);
      if (!event || !ref || !selected.has(messageRefKey(ref))) continue;
      const key = messageRefKey(ref), state = states.get(key) ?? { recalled: false };
      projectMessage(state, { sequence: Number(row.id), event }); states.set(key, state);
    }
    return states;
  }

  async listBetween(
    conversation: ConversationRef,
    afterExclusive: number,
    throughInclusive: number,
    limit: number,
  ): Promise<readonly SequencedConversationEvent[]> {
    const cap = Math.max(0, Math.floor(limit));
    const key = conversationRefKey(conversation);
    const select = async (storedKey: string, through: number): Promise<Record<string, unknown>[]> => {
      let selection = this.events.select('id', 'event_json')
        .where({
          conversation_key: storedKey,
          id: { $gt: afterExclusive, $lte: through },
        });
      selection = selection.orderBy?.('id', 'DESC') ?? selection;
      selection = selection.limit?.(cap) ?? selection;
      return Promise.resolve(selection);
    };
    const events: SequencedConversationEvent[] = [];
    // Reads on past skipped (damaged) rows so the page still holds `cap` events while there are more.
    for (let through = throughInclusive; cap > 0;) {
      const encoded = await select(databaseTextKey(key), through);
      const legacy = await toleratePostgresNul(() => select(key, through), []);
      const rows = [...encoded, ...legacy]
        .sort((left, right) => Number(right.id) - Number(left.id))
        .slice(0, cap);
      for (const row of rows) {
        const event = this.#event(row);
        if (event && events.length < cap) events.push(Object.freeze({ sequence: Number(row.id), event }));
      }
      if (events.length >= cap || rows.length < cap) break;
      through = Number(rows.at(-1)?.id) - 1;
    }
    return Object.freeze(events.reverse());
  }

  async listInteractionAnswered(refs: readonly MessageRef[]): Promise<ReadonlySet<string>> {
    const wanted = new Set(refs.map(messageRefKey)), answered = new Set<string>();
    const keys = [...wanted];
    // Only this version writes the type, always with an encoded key: no legacy key to read.
    for (let start = 0; start < keys.length; start += ANSWERED_LOOKUP_BATCH) {
      const stored = keys.slice(start, start + ANSWERED_LOOKUP_BATCH).map(databaseTextKey);
      const rows = await Promise.resolve(this.events.select('id', 'event_json')
        .where({ $and: [{ event_type: 'message.interaction_answered' }, { message_key: { $in: stored } }] }));
      for (const row of rows) {
        // The parsed event names the message: a returned TEXT key may be truncated by some drivers.
        const event = this.#event(row);
        if (event?.type !== 'message.interaction_answered') continue;
        const key = messageRefKey(event.message);
        if (wanted.has(key)) answered.add(key);
      }
    }
    return answered;
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
    if (encoded.length > 0) {
      const encodedSeq = Number(encoded[0]?.sequence ?? 0);
      if (encodedSeq > 0) return encodedSeq;
    }
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
    if (encoded && this.#event(encoded)?.eventId === eventId) return encoded;
    const legacy = await toleratePostgresNul(() => select(eventId), undefined);
    return legacy && this.#event(legacy)?.eventId === eventId ? legacy : undefined;
  }
}

function extractInsertedSequence(result: unknown): number | undefined {
  if (typeof result === 'number' && Number.isSafeInteger(result) && result > 0) return result;
  if (result && typeof result === 'object') {
    const record = result as { id?: unknown; lastID?: unknown };
    const candidate = record.id ?? record.lastID;
    const num = Number(candidate);
    if (Number.isSafeInteger(num) && num > 0) return num;
  }
  return undefined;
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

/** Why a stored `event_json` is not an event (`reports_suppressed` only marks the end of reports). */
export type StoredConversationEventProblem = 'invalid_event_json' | 'invalid_event' | 'reports_suppressed';

const CONVERSATION_EVENT_TYPES: Readonly<Record<ConversationEvent['type'], true>> = Object.freeze({
  'message.created': true, 'message.updated': true, 'message.recalled': true, 'message.reaction_changed': true,
  'message.interaction_answered': true,
  'conversation.poked': true, 'member.joined': true, 'member.left': true, 'member.muted': true, 'member.unmuted': true,
  'member.role_changed': true, 'scene.join_requested': true, 'scene.notice_updated': true,
  'member.card_changed': true, 'member.title_changed': true, 'member.remark_changed': true,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const optionalActor = (value: unknown): boolean => value === undefined || (isRecord(value) && isString(value.id));

function isConversationRef(value: unknown): value is ConversationRef {
  if (!isRecord(value) || !isRecord(value.endpoint) || !isString(value.endpoint.adapter) || !isString(value.endpoint.id)) return false;
  if (!isString(value.kind) || !isString(value.id)) return false;
  if (value.parent !== undefined && !(isRecord(value.parent) && isString(value.parent.kind) && isString(value.parent.id))) return false;
  return value.threadId === undefined || isString(value.threadId);
}

const isMessageRef = (value: unknown): value is MessageRef => isRecord(value) && isString(value.id) && isConversationRef(value.conversation);

/**
 * Whether `value` has the shape every reader relies on: a known `type`, `eventId`, `timestamp`,
 * a conversation address and the type's own references (message body, message ref, member).
 */
export function isConversationEvent(value: unknown): value is ConversationEvent {
  if (!isRecord(value) || !isString(value.type) || !Object.hasOwn(CONVERSATION_EVENT_TYPES, value.type)) return false;
  if (!isString(value.eventId) || typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (!isConversationRef(value.conversation) || !optionalActor(value.actor)) return false;
  const type = value.type as ConversationEvent['type'];
  if (type === 'message.created' || type === 'message.updated') {
    const message = value.message;
    if (!isRecord(message) || !isMessageRef(message.ref) || !Array.isArray(message.segments)
      || typeof message.timestamp !== 'number' || !optionalActor(message.actor)) return false;
    return type === 'message.created' || typeof message.revision === 'number';
  }
  if (type === 'message.recalled' || type === 'message.reaction_changed' || type === 'message.interaction_answered') {
    return isMessageRef(value.message);
  }
  if (type === 'scene.join_requested') return isRecord(value.actor) && isString(value.actor.id);
  if (type.startsWith('member.')) return isRecord(value.member) && isString(value.member.id);
  return true;
}

/** A stored `event_json` as an event, or why it is not one. */
export function readStoredConversationEvent(value: unknown):
  | { readonly ok: true; readonly event: ConversationEvent }
  | { readonly ok: false; readonly reason: Exclude<StoredConversationEventProblem, 'reports_suppressed'> } {
  // Some drivers hand TEXT back as bytes.
  const text = typeof value === 'string' ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : undefined;
  if (text === undefined) return { ok: false, reason: 'invalid_event_json' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'invalid_event_json' }; }
  return isConversationEvent(parsed) ? { ok: true, event: parsed } : { ok: false, reason: 'invalid_event' };
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
