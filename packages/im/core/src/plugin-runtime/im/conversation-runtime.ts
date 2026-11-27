import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MemoryConversationEventStore,
  conversationRefKey,
  messageRefKey,
  type ConversationContextBlock,
  type ConversationEvent,
  type ConversationEventReader,
  type ConversationEventStore,
  type ConversationMessage,
  type ConversationReference,
  type ConversationResolution,
  type ConversationRef,
  type DeliveryReceipt,
  type MessageRef,
  type SequencedConversationEvent,
  type Segment,
} from '@zhin.js/im-contract';
import { getLogger } from '@zhin.js/logger';
import { redactChatIdentityBindText, redactChatOwnerClaimText } from '@zhin.js/kernel';
import { assertCanonicalSegments } from '../../built/segment-contract/assert.js';
import { segmentsToPlainText } from '../../built/segment-contract/text.js';
import type { Notice } from '../../notice.js';
import type { Request } from '../../request.js';
import { SCENE_ONLY_EVENT_TYPES, SCENE_EVENT_TEXT_MAX, clipSceneText } from '../../side-event/scene-events.js';
import type { IncomingMessage, MessageSenderRef, SendRequest } from './contracts.js';
import { flattenContent } from './message-events.js';

/**
 * Backlog messages older than this are dropped from the next turn's context:
 * a stale command from hours ago is not something the current reply should answer.
 */
export const CONVERSATION_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000;

const MAX_TRACKED_INTERACTION_ANSWERS = 1_000;
const logger = getLogger('im.conversation');

/**
 * Recorded text with one-time codes hidden: an open claim code becomes `***`, and a chat-identity
 * bind message (`绑定 <码>`, `/bind <code>`) becomes `绑定 ***` by its shape alone, open code or not
 * (#1250 sandbox-transcript-shared-bind-code: records are read back by every Console user who may
 * read the conversation, the shared Sandbox included).
 */
function redactRecordedText(text: string): string {
  return redactChatIdentityBindText(redactChatOwnerClaimText(text));
}

/** A text segment with one-time codes hidden ({@link redactRecordedText}); other segments unchanged. */
function redactClaimSegment<T extends { readonly type: unknown; readonly data?: unknown }>(segment: T): T {
  const data = segment.data as { text?: unknown } | undefined;
  if (segment.type !== 'text' || typeof data?.text !== 'string') return segment;
  const text = redactRecordedText(data.text);
  return text === data.text ? segment : { ...segment, data: { ...data, text } };
}

/** ADR 0067 D8: what the inbound path knows about the message's authorship when it stores it. */
export interface RecordIncomingOptions {
  /**
   * The adapter declares `messaging.inboundTextAuthoredBySender` for this conversation kind. Without
   * it the message never gets original-text evidence (fail closed).
   */
  readonly textAuthoredBySender?: boolean;
}

export interface ConversationRuntimeOptions {
  /**
   * ADR 0067 D8: key of the original-inbound-text evidence (HMAC-SHA256). Defaults to 32 random bytes
   * per runtime: evidence written before a restart no longer verifies (fail closed), and nobody who can
   * only write the event store can mint it.
   */
  readonly evidenceKey?: Uint8Array;
}

/** Owns one ImRuntime's conversation fact store, projections, and consumer cursors. */
export class ConversationRuntime {
  #events: ConversationEventStore;
  /** Messages consumed as answers to an interaction prompt (e.g. an approval reply). */
  readonly #interactionAnswers = new Set<string>();
  readonly #evidence: InboundTextEvidence;

  constructor(events: ConversationEventStore = new MemoryConversationEventStore(), options: ConversationRuntimeOptions = {}) {
    this.#events = events;
    this.#evidence = new InboundTextEvidence(options.evidenceKey ?? randomBytes(32));
  }

  get reader(): ConversationEventReader {
    return this.#events;
  }

  replaceStore(events: ConversationEventStore): void {
    this.#events = events;
  }

  async resolveLocal(
    reference: ConversationReference,
  ): Promise<ConversationResolution | undefined> {
    if (reference.kind !== 'message') return undefined;
    const message = await this.#events.getMessage(reference.message);
    return message && !message.recalled && message.contentStatus !== 'unavailable'
      ? Object.freeze({ status: 'resolved', reference, value: message })
      : undefined;
  }

  async readContext(
    conversation: ConversationRef,
    consumer: string,
    throughSequence: number,
    limit = 50,
    excludeMessageId?: string,
  ): Promise<Readonly<{ blocks: readonly ConversationContextBlock[]; cursor: number }>> {
    if (!Number.isSafeInteger(throughSequence) || throughSequence < 0) {
      throw new TypeError('Conversation context throughSequence must be a non-negative integer');
    }
    const cursor = await this.#events.getCursor(consumer, conversation);
    const events = await this.#events.listBetween(
      conversation,
      cursor,
      throughSequence,
      limit,
    );
    const notBefore = Date.now() - CONVERSATION_CONTEXT_MAX_AGE_MS;
    const relevant: SequencedConversationEvent[] = [];
    // The bot's own messages it later recalled (an activity indicator) never were part of the chat.
    const excluded = new Set<string>(excludeMessageId ? [excludeMessageId] : []);
    const answered = await this.#answeredMessages(events);
    for (const entry of events) {
      if (entry.event.type === 'message.interaction_answered') continue;
      // Only message timestamps are runtime-assigned; notice clocks are adapter-defined.
      if ((entry.event.type === 'message.created' || entry.event.type === 'message.updated') && entry.event.timestamp < notBefore) continue;
      if (await this.#isOwnRecall(entry.event)) {
        if (entry.event.type === 'message.recalled') excluded.add(entry.event.message.id);
        continue;
      }
      if ((entry.event.type === 'message.created' || entry.event.type === 'message.updated')
        && answered.has(messageRefKey(entry.event.message.ref))) continue;
      relevant.push(entry);
    }
    return Object.freeze({
      blocks: aggregateConversationContext(relevant, excluded, this.#evidence),
      cursor: Math.max(cursor, throughSequence),
    });
  }

  /**
   * #1250 b114: the window's messages that answered (or were) an interaction prompt — the in-memory
   * marks, the durable `message.interaction_answered` events inside the window, and one lookup by
   * message key for those whose event landed after it. The durable events survive a restart and the
   * bounded memory set, so an approval `y` never comes back as a background message.
   */
  async #answeredMessages(events: readonly SequencedConversationEvent[]): Promise<ReadonlySet<string>> {
    const answered = new Set<string>();
    const candidates = new Map<string, MessageRef>();
    for (const { event } of events) {
      if (event.type === 'message.interaction_answered') answered.add(messageRefKey(event.message));
      else if (event.type === 'message.created' || event.type === 'message.updated') {
        const key = messageRefKey(event.message.ref);
        if (this.#interactionAnswers.has(key)) answered.add(key);
        else candidates.set(key, event.message.ref);
      }
    }
    for (const key of answered) candidates.delete(key);
    if (candidates.size && this.#events.listInteractionAnswered) {
      try {
        for (const key of await this.#events.listInteractionAnswered([...candidates.values()])) answered.add(key);
      } catch {
        // A failed lookup keeps the window's own facts; it never fails the Agent turn.
      }
    }
    return answered;
  }

  /**
   * The bot recalling its own outbound message (e.g. an activity indicator with
   * autoRemove) is self-generated noise, not a conversation fact for the model.
   * Outbound messages are recorded without an actor, which identifies them here.
   */
  async #isOwnRecall(event: ConversationEvent): Promise<boolean> {
    if (event.type !== 'message.recalled') return false;
    const recalled = await this.#events.getMessage(event.message);
    return recalled !== undefined && recalled.actor === undefined;
  }

  /**
   * An answer to an interaction prompt (an approval `y`, a menu choice) was
   * already handled by that prompt; replaying it as background would invite
   * the model to answer it again. Marked in a bounded in-memory set (immediate)
   * and, #1250 b114, as an append-only `message.interaction_answered` event in the
   * conversation store, so the mark survives a restart and the memory bound.
   * The returned promise settles once the event is stored; it never rejects.
   */
  markInteractionAnswer(message: MessageRef): Promise<void> {
    const key = messageRefKey(message);
    this.#interactionAnswers.add(key);
    if (this.#interactionAnswers.size > MAX_TRACKED_INTERACTION_ANSWERS) {
      const oldest = this.#interactionAnswers.values().next().value;
      if (oldest !== undefined) this.#interactionAnswers.delete(oldest);
    }
    const store = this.#events;
    return store.append(Object.freeze({
      eventId: `interaction-answered:${key}`,
      conversation: message.conversation,
      timestamp: Date.now(),
      type: 'message.interaction_answered' as const,
      message: Object.freeze({ conversation: message.conversation, id: message.id }),
    })).then(() => undefined, (error: unknown) => {
      // The in-memory mark still holds for this process; only a restart can bring the message back.
      logger.warn(`interaction answer not stored | reason: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  commitContext(conversation: ConversationRef, consumer: string, cursor: number): Promise<void> {
    return this.#events.commitCursor(consumer, conversation, cursor);
  }

  async recordIncoming(
    input: IncomingMessage,
    sender: MessageSenderRef | undefined,
    options: RecordIncomingOptions = {},
  ): Promise<number | undefined> {
    if (!input.message?.id) return undefined;
    const timestamp = Date.now();
    const segments = Object.freeze(input.segments?.length
      ? input.segments.map(redactClaimSegment)
      : [{ type: 'text', data: { text: redactRecordedText(input.content) } }]);
    // ADR 0067 D8: the stored actor id is trimmed like the turn principal's `subjectId`.
    const actorId = typeof sender?.id === 'string' ? sender.id.trim() : '';
    const text = actorId && options.textAuthoredBySender === true ? originalInboundText(input, segments) : undefined;
    const inboundTextDigest = text === undefined ? undefined
      : this.#evidence.sign(input.message, actorId, text);
    const appended = await this.#events.append(Object.freeze({
      eventId: `message:${messageRefKey(input.message)}`,
      conversation: input.conversation,
      timestamp,
      type: 'message.created',
      message: Object.freeze({
        ref: input.message,
        // An actor-less message means the bot's own outbound; never leave an inbound one without.
        actor: sender && actorId
          ? Object.freeze({ id: actorId, ...(sender.name ? { displayName: sender.name } : {}) })
          : UNKNOWN_SENDER,
        // Backstop (ADR 0060 §3.3): an open chat-owner claim code is stored as `***`.
        segments,
        ...(inboundTextDigest ? { inboundTextDigest } : {}),
        timestamp,
        ...(input.replyTo
          ? { replyTo: Object.freeze({ conversation: input.conversation, id: input.replyTo.id }) }
          : {}),
      }),
    }));
    return appended.sequence;
  }

  async recordOutbound(request: SendRequest, receipt: DeliveryReceipt, canonicalContent?: readonly Segment[] | 'unavailable'): Promise<number | undefined> {
    if (receipt.status !== 'sent' || !receipt.message?.id) return undefined;
    const timestamp = Date.now();
    const appended = await this.#events.append(Object.freeze({
      eventId: `message:${messageRefKey(receipt.message)}`,
      conversation: request.conversation,
      timestamp,
      type: 'message.created',
      message: Object.freeze({
        ref: receipt.message,
        segments: canonicalContent === 'unavailable' ? [] : canonicalContent ?? segmentsFromContent(request.content),
        ...(canonicalContent === 'unavailable' ? { contentStatus: 'unavailable' as const } : {}),
        timestamp,
        ...(canonicalContent !== 'unavailable' && canonicalContent?.length && canonicalContent.every(segment => segment.type === 'text') && receipt.outboundTextDigest ? {
          outboundTextDigest: receipt.outboundTextDigest,
        } : {}),
      }),
    }));
    return appended.sequence;
  }

  /** Records a confirmed replacement body without inventing another physical message. */
  async recordOutboundUpdate(request: SendRequest, receipt: DeliveryReceipt, revision: number, canonicalContent?: readonly Segment[] | 'unavailable'): Promise<number | undefined> {
    if (receipt.status !== 'sent' || !receipt.message?.id) return undefined;
    const original = await this.#events.getMessage(receipt.message);
    if (!original) throw new Error('Cannot record an update before its original message');
    const { contentStatus: _status, outboundTextDigest: _digest, inboundTextDigest: _inbound, ...identity } = original;
    const appended = await this.#events.append(Object.freeze({
      eventId: `message:${messageRefKey(receipt.message)}:revision:${revision}`,
      conversation: request.conversation, timestamp: Date.now(), type: 'message.updated',
      message: Object.freeze({ ...identity, revision,
        segments: canonicalContent === 'unavailable' ? [] : canonicalContent ?? segmentsFromContent(request.content),
        ...(canonicalContent === 'unavailable' ? { contentStatus: 'unavailable' as const } : {}),
        ...(canonicalContent !== 'unavailable' && canonicalContent?.length && canonicalContent.every(segment => segment.type === 'text') && receipt.outboundTextDigest
          ? { outboundTextDigest: receipt.outboundTextDigest } : {}),
      }),
    }));
    return appended.sequence;
  }

  /** Records a normalized notice; returns the stored event (with its sequence) when newly appended. */
  async recordNotice(notice: Notice): Promise<SequencedConversationEvent | undefined> {
    const event = conversationEventFromNotice(notice);
    if (!event) return undefined;
    const appended = await this.#events.append(event);
    return appended.appended ? Object.freeze({ sequence: appended.sequence, event }) : undefined;
  }

  /** Join requests / invitations into a group or channel become `scene.join_requested` (#996). */
  async recordRequest(request: Request): Promise<SequencedConversationEvent | undefined> {
    const event = conversationEventFromRequest(request);
    if (!event) return undefined;
    const appended = await this.#events.append(event);
    return appended.appended ? Object.freeze({ sequence: appended.sequence, event }) : undefined;
  }
}

function conversationEventFromRequest(request: Request): ConversationEvent | undefined {
  const conversation = request.conversation;
  if (!conversation || conversation.kind === 'private' || !request.id || !request.actor?.id) return undefined;
  const sub = request.name.split('.').slice(2).join('.');
  if (sub !== 'add' && sub !== 'invite') return undefined;
  const actor = Object.freeze({
    id: String(request.actor.id),
    ...(request.actor.name ? { displayName: request.actor.name } : {}),
  });
  const comment = clipSceneText(request.comment, SCENE_EVENT_TEXT_MAX);
  return Object.freeze({
    eventId: `request:${conversationRefKey(conversation)}:${String(request.id)}`,
    conversation,
    timestamp: request.timestamp,
    type: 'scene.join_requested',
    actor,
    ...(comment ? { comment } : {}),
    ...(sub === 'invite' ? { invite: true } : {}),
  });
}

function conversationEventFromNotice(notice: Notice): ConversationEvent | undefined {
  const conversation = notice.conversation;
  if (!conversation || !notice.id) return undefined;
  const actor = notice.actor?.id
    ? Object.freeze({
      id: String(notice.actor.id),
      ...(notice.actor.name ? { displayName: notice.actor.name } : {}),
    })
    : undefined;
  const target = notice.target?.id
    ? Object.freeze({
      id: String(notice.target.id),
      ...(notice.target.name ? { displayName: notice.target.name } : {}),
    })
    : undefined;
  const base = Object.freeze({
    eventId: `notice:${conversationRefKey(conversation)}:${String(notice.id)}`,
    conversation,
    timestamp: notice.timestamp,
  });
  switch (notice.name.split('.').slice(2).join('.')) {
    case 'member_increase':
    case 'increase':
      return target
        ? Object.freeze({ ...base, type: 'member.joined', member: target, ...(actor ? { actor } : {}) })
        : undefined;
    case 'member_decrease':
      return target
        ? Object.freeze({
          ...base,
          type: 'member.left',
          member: target,
          ...(actor ? { actor } : {}),
          reason: actor ? 'removed' : 'left',
        })
        : undefined;
    case 'ban':
      if (!target) return undefined;
      return notice.durationSeconds === 0
        ? Object.freeze({
          ...base,
          type: 'member.unmuted',
          member: target,
          ...(actor ? { actor } : {}),
        })
        : Object.freeze({
          ...base,
          type: 'member.muted',
          member: target,
          ...(actor ? { actor } : {}),
          durationSeconds: notice.durationSeconds ?? 0,
        });
    case 'admin_change':
      return target && notice.role && typeof notice.enabled === 'boolean'
        ? Object.freeze({
          ...base,
          type: 'member.role_changed',
          member: target,
          ...(actor ? { actor } : {}),
          role: notice.role,
          enabled: notice.enabled,
        })
        : undefined;
    case 'recall':
      return notice.messageId
        ? Object.freeze({
          ...base,
          type: 'message.recalled',
          message: Object.freeze({ conversation, id: notice.messageId }),
          ...(actor ? { actor } : {}),
        })
        : undefined;
    case 'emoji_reaction':
      return notice.messageId && notice.reaction && notice.operation
        ? Object.freeze({
          ...base,
          type: 'message.reaction_changed',
          message: Object.freeze({ conversation, id: notice.messageId }),
          ...(actor ? { actor } : {}),
          reaction: notice.reaction,
          operation: notice.operation,
        })
        : undefined;
    case 'poke':
      return Object.freeze({
        ...base,
        type: 'conversation.poked',
        ...(actor ? { actor } : {}),
        ...(target ? { target } : {}),
      });
    case 'card_change':
    case 'title_change':
    case 'remark_change': {
      const member = target ?? actor;
      if (!member) return undefined;
      const value = clipSceneText(notice.value, SCENE_EVENT_TEXT_MAX);
      const type = notice.name.endsWith('card_change')
        ? 'member.card_changed' as const
        : notice.name.endsWith('title_change') ? 'member.title_changed' as const : 'member.remark_changed' as const;
      return Object.freeze({
        ...base,
        type,
        member,
        ...(actor && actor.id !== member.id ? { actor } : {}),
        ...(value ? { value } : {}),
      });
    }
    case 'notice_updated':
    case 'announce':
      return Object.freeze({
        ...base,
        type: 'scene.notice_updated',
        ...(actor ? { actor } : {}),
        text: clipSceneText(notice.value, SCENE_EVENT_TEXT_MAX),
      });
    default:
      return undefined;
  }
}

function aggregateConversationContext(
  events: readonly SequencedConversationEvent[],
  excluded: ReadonlySet<string>,
  evidence: InboundTextEvidence,
): readonly ConversationContextBlock[] {
  const ordinary: ConversationContextBlock[] = [];
  const noisy = new Map<string, { sequence: number; event: ConversationEvent; count: number }>();
  const latestMessages = new Map<string, SequencedConversationEvent>();
  const recalled = new Set<string>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === 'message.recalled') recalled.add(messageRefKey(event.message));
    if (event.type !== 'message.created' && event.type !== 'message.updated') continue;
    const key = messageRefKey(event.message.ref), previous = latestMessages.get(key);
    if (recalled.has(key)) continue;
    const previousRevision = previous && (previous.event.type === 'message.created' || previous.event.type === 'message.updated')
      ? previous.event.message.revision ?? 0 : -1;
    if ((event.message.revision ?? 0) > previousRevision) latestMessages.set(key, entry);
  }
  for (const { sequence, event } of events) {
    // #996: these reach the model only through the short ephemeral `[Scene events]` block.
    if (SCENE_ONLY_EVENT_TYPES.has(event.type) || event.type === 'message.interaction_answered') continue;
    if (event.type === 'message.created' || event.type === 'message.updated') {
      if (latestMessages.get(messageRefKey(event.message.ref))?.sequence !== sequence) continue;
      if (excluded.has(event.message.ref.id)) continue;
      const text = describeConversationMessage(event.message);
      if (!text) continue;
      ordinary.push(Object.freeze({
        kind: 'conversation_event',
        sequence,
        eventType: event.type,
        text,
        message: event.message.ref,
        timestamp: event.message.timestamp,
        // The stored `UNKNOWN_SENDER` placeholder is no sender identity: such a block carries neither.
        ...(!event.message.actor ? { ownMessage: true as const }
          : isUnknownSender(event.message.actor) ? {} : { actor: event.message.actor }),
        ...(event.message.outboundTextDigest ? { messageTextDigest: event.message.outboundTextDigest } : {}),
        ...(event.type === 'message.created' ? evidence.verify(event.message) : {}),
      }));
      continue;
    }
    if (event.type === 'message.reaction_changed' || event.type === 'conversation.poked') {
      const key = event.type === 'message.reaction_changed'
        ? `${event.type}:${event.message.id}:${event.actor?.id ?? ''}:${event.reaction}:${event.operation}`
        : `${event.type}:${event.actor?.id ?? ''}:${event.target?.id ?? ''}`;
      const previous = noisy.get(key);
      noisy.set(key, { sequence, event, count: (previous?.count ?? 0) + 1 });
      continue;
    }
    ordinary.push(Object.freeze({
      kind: 'conversation_event',
      sequence,
      eventType: event.type,
      text: describeConversationEvent(event),
    }));
  }
  for (const { sequence, event, count } of noisy.values()) {
    ordinary.push(Object.freeze({
      kind: 'conversation_event',
      sequence,
      eventType: event.type,
      text: `${describeConversationEvent(event)}${count > 1 ? ` (${count} similar events.)` : ''}`,
    }));
  }
  ordinary.sort((left, right) => left.sequence - right.sequence);
  return Object.freeze(ordinary);
}

function describeConversationEvent(event: ConversationEvent): string {
  const actor = 'actor' in event && event.actor
    ? `${event.actor.displayName ?? event.actor.id} (${event.actor.id})`
    : undefined;
  switch (event.type) {
    case 'message.recalled':
      return `${actor ?? 'Someone'} recalled message ${event.message.id}.`;
    case 'message.reaction_changed':
      return `${actor ?? 'Someone'} ${event.operation} reaction ${event.reaction} on message ${event.message.id}.`;
    case 'conversation.poked':
      return `${actor ?? 'Someone'} poked ${event.target ? `${event.target.displayName ?? event.target.id} (${event.target.id})` : 'someone'}.`;
    case 'member.joined':
      return `${event.member.displayName ?? event.member.id} (${event.member.id}) joined the conversation.`;
    case 'member.left':
      return `${event.member.displayName ?? event.member.id} (${event.member.id}) left the conversation (${event.reason ?? 'left'}).`;
    case 'member.muted':
      return `${event.member.displayName ?? event.member.id} (${event.member.id}) was muted for ${event.durationSeconds} seconds${actor ? ` by ${actor}` : ''}.`;
    case 'member.unmuted':
      return `${event.member.displayName ?? event.member.id} (${event.member.id}) was unmuted${actor ? ` by ${actor}` : ''}.`;
    case 'member.role_changed':
      return `${event.member.displayName ?? event.member.id} (${event.member.id}) role ${event.role} was ${event.enabled ? 'enabled' : 'disabled'}${actor ? ` by ${actor}` : ''}.`;
    case 'message.created':
    case 'message.updated':
    case 'message.interaction_answered':
    case 'scene.join_requested':
    case 'scene.notice_updated':
    case 'member.card_changed':
    case 'member.title_changed':
    case 'member.remark_changed':
      return '';
  }
}

/**
 * Label of the bot's own messages. Outbound messages are recorded without an actor; without
 * them the model cannot tell its own words from the members' or follow the order of the chat.
 */
export const OWN_MESSAGE_LABEL = 'You (this bot)';
const UNKNOWN_SENDER = Object.freeze({ id: 'unknown', displayName: 'Unknown sender' });
/** The stored placeholder of an inbound message without a usable sender (compared by value: stored events are copies). */
function isUnknownSender(actor: { readonly id: string; readonly displayName?: string }): boolean {
  return actor.id === UNKNOWN_SENDER.id && actor.displayName === UNKNOWN_SENDER.displayName;
}
/** In-turn progress updates (the Agent's `⏳ ` marker) are not part of the conversation. */
const OWN_PROGRESS_PREFIX = /^⏳\s*/u;

function describeConversationMessage(message: ConversationMessage): string {
  const text = segmentsToPlainText(message.segments).trim();
  if (!message.actor && OWN_PROGRESS_PREFIX.test(text)) return '';
  const actor = message.actor
    ? `${message.actor.displayName ?? message.actor.id} (${message.actor.id})`
    : OWN_MESSAGE_LABEL;
  const attachmentTypes = [...new Set(message.segments
    .filter((segment) => segment.type !== 'text' && segment.type !== 'mention' && segment.type !== 'at')
    .map((segment) => segment.type))];
  const attachmentNote = attachmentTypes.length > 0
    ? ` [message also contains ${attachmentTypes.join(', ')} data; inspect its reference before relying on that content]`
    : '';
  return `${actor} [message_id=${JSON.stringify(message.ref.id)}]: ${message.contentStatus === 'unavailable'
    ? '[Message content unavailable; inspect its reference.]' : text || '(no plain-text content)'}${attachmentNote}`;
}

/** Plain text of a text-only body; `undefined` when any segment is not text (media, mention, forward, …). */
function textOnlyBody(segments: readonly { readonly type: unknown; readonly data?: unknown }[]): string | undefined {
  if (!segments.length) return undefined;
  let text = '';
  for (const segment of segments) {
    const value = (segment.data as { text?: unknown } | undefined)?.text;
    if (segment.type !== 'text' || typeof value !== 'string') return undefined;
    text += value;
  }
  return text;
}

/**
 * #1250 (ADR 0067 D8): the sender's original text, taken before any middleware or plugin runs, when
 * the message may carry evidence of it: not marked `forwarded`, quoting nothing, every segment text,
 * the plain-text view the adapter gave equal to the segments (an adapter that appends embed titles,
 * sticker names or other placeholders to the view does not match), non-blank, and unchanged by the
 * claim-code redaction. `undefined` otherwise (it then counts as background).
 */
function originalInboundText(input: IncomingMessage, stored: readonly Segment[]): string | undefined {
  if (input.replyTo || input.forwarded === true) return undefined;
  let original: string | undefined;
  if (input.segments === undefined) original = input.content;
  else {
    original = textOnlyBody(input.segments);
    if (original !== input.content) return undefined;
  }
  const kept = textOnlyBody(stored);
  if (original === undefined || kept === undefined || original !== kept || !kept.trim()) return undefined;
  return kept;
}

/**
 * ADR 0067 D8: original-inbound-text evidence, an HMAC bound to the conversation, the message, the
 * sender id and the exact text. Only this runtime holds the key, so a row written (or edited) by
 * anything else — a plugin with store access, a database writer, an older process — never verifies.
 */
class InboundTextEvidence {
  readonly #key: Uint8Array;

  constructor(key: Uint8Array) {
    if (!(key instanceof Uint8Array) || key.byteLength < 16) {
      throw new TypeError('Conversation evidence key must be at least 16 bytes');
    }
    this.#key = Uint8Array.from(key);
  }

  sign(message: MessageRef, actorId: string, text: string): string {
    return createHmac('sha256', this.#key)
      .update(JSON.stringify(['zhin.inbound-text.v1', conversationRefKey(message.conversation), messageRefKey(message), actorId, text]))
      .digest('hex');
  }

  /** Re-checks the evidence against the body this block shows; a stale, moved or forged digest is dropped. */
  verify(message: ConversationMessage): Partial<Pick<ConversationContextBlock, 'inboundActorId' | 'inboundTextDigest'>> {
    const digest = message.inboundTextDigest;
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest) || !message.actor?.id || message.replyTo
      || message.contentStatus || message.recalled || message.outboundTextDigest || (message.revision ?? 0) !== 0) return {};
    const text = textOnlyBody(message.segments);
    if (text === undefined || !text.trim()) return {};
    const expected = Buffer.from(this.sign(message.ref, message.actor.id, text), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(digest, 'hex'))) return {};
    return { inboundActorId: message.actor.id, inboundTextDigest: digest };
  }
}

function segmentsFromContent(content: unknown): readonly Segment[] {
  if (Array.isArray(content)) {
    try {
      assertCanonicalSegments(content);
      return Object.freeze([...content]);
    } catch {
      // Fall through to a truthful text projection of non-canonical output.
    }
  }
  return Object.freeze([{ type: 'text', data: Object.freeze({ text: flattenContent(content) }) }]);
}
