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
import { assertCanonicalSegments } from '../../built/segment-contract/assert.js';
import { segmentsToPlainText } from '../../built/segment-contract/text.js';
import type { Notice } from '../../notice.js';
import type { Request } from '../../request.js';
import { SCENE_ONLY_EVENT_TYPES, SCENE_EVENT_TEXT_MAX, clipSceneText } from '../../side-event/scene-events.js';
import type { IncomingMessage, MessageSenderRef, SendRequest } from './contracts.js';

/**
 * Backlog messages older than this are dropped from the next turn's context:
 * a stale command from hours ago is not something the current reply should answer.
 */
export const CONVERSATION_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000;

const MAX_TRACKED_INTERACTION_ANSWERS = 1_000;

/** Owns one ImRuntime's conversation fact store, projections, and consumer cursors. */
export class ConversationRuntime {
  #events: ConversationEventStore;
  /** Messages consumed as answers to an interaction prompt (e.g. an approval reply). */
  readonly #interactionAnswers = new Set<string>();

  constructor(events: ConversationEventStore = new MemoryConversationEventStore()) {
    this.#events = events;
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
    return message
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
    for (const entry of events) {
      // Only message timestamps are runtime-assigned; notice clocks are adapter-defined.
      if (entry.event.type === 'message.created' && entry.event.timestamp < notBefore) continue;
      if (await this.#isOwnRecall(entry.event)) {
        if (entry.event.type === 'message.recalled') excluded.add(entry.event.message.id);
        continue;
      }
      if (entry.event.type === 'message.created'
        && this.#interactionAnswers.has(messageRefKey(entry.event.message.ref))) continue;
      relevant.push(entry);
    }
    return Object.freeze({
      blocks: aggregateConversationContext(relevant, excluded),
      cursor: Math.max(cursor, throughSequence),
    });
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
   * the model to answer it again. Kept in memory and bounded: the context age
   * window makes older answers irrelevant anyway.
   */
  markInteractionAnswer(message: MessageRef): void {
    this.#interactionAnswers.add(messageRefKey(message));
    if (this.#interactionAnswers.size > MAX_TRACKED_INTERACTION_ANSWERS) {
      const oldest = this.#interactionAnswers.values().next().value;
      if (oldest !== undefined) this.#interactionAnswers.delete(oldest);
    }
  }

  commitContext(conversation: ConversationRef, consumer: string, cursor: number): Promise<void> {
    return this.#events.commitCursor(consumer, conversation, cursor);
  }

  async recordIncoming(
    input: IncomingMessage,
    sender: MessageSenderRef | undefined,
  ): Promise<number | undefined> {
    if (!input.message?.id) return undefined;
    const timestamp = Date.now();
    const appended = await this.#events.append(Object.freeze({
      eventId: `message:${messageRefKey(input.message)}`,
      conversation: input.conversation,
      timestamp,
      type: 'message.created',
      message: Object.freeze({
        ref: input.message,
        // An actor-less message means the bot's own outbound; never leave an inbound one without.
        actor: sender
          ? Object.freeze({ id: sender.id, ...(sender.name ? { displayName: sender.name } : {}) })
          : UNKNOWN_SENDER,
        segments: Object.freeze(input.segments?.length
          ? [...input.segments]
          : [{ type: 'text', data: { text: input.content } }]),
        timestamp,
        ...(input.replyTo
          ? { replyTo: Object.freeze({ conversation: input.conversation, id: input.replyTo.id }) }
          : {}),
      }),
    }));
    return appended.sequence;
  }

  async recordOutbound(request: SendRequest, receipt: DeliveryReceipt): Promise<void> {
    if (receipt.status !== 'sent' || !receipt.message?.id) return;
    const timestamp = Date.now();
    await this.#events.append(Object.freeze({
      eventId: `message:${messageRefKey(receipt.message)}`,
      conversation: request.conversation,
      timestamp,
      type: 'message.created',
      message: Object.freeze({
        ref: receipt.message,
        segments: segmentsFromContent(request.content),
        timestamp,
      }),
    }));
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
): readonly ConversationContextBlock[] {
  const ordinary: ConversationContextBlock[] = [];
  const noisy = new Map<string, { sequence: number; event: ConversationEvent; count: number }>();
  for (const { sequence, event } of events) {
    // #996: these reach the model only through the short ephemeral `[Scene events]` block.
    if (SCENE_ONLY_EVENT_TYPES.has(event.type)) continue;
    if (event.type === 'message.created') {
      if (excluded.has(event.message.ref.id)) continue;
      const text = describeConversationMessage(event.message);
      if (!text) continue;
      ordinary.push(Object.freeze({
        kind: 'conversation_event',
        sequence,
        eventType: event.type,
        text,
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
  return `${actor} [message_id=${JSON.stringify(message.ref.id)}]: ${text || '(no plain-text content)'}${attachmentNote}`;
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

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) return content.map((item) => flattenContent(item)).join('');
  if (typeof content === 'object') {
    const record = content as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    if (typeof record.type === 'string') {
      if (data && typeof data.text === 'string') return data.text;
      return `[${record.type}]`;
    }
    if (typeof record.text === 'string') return record.text;
    try {
      return JSON.stringify(content) ?? '';
    } catch {
      return String(content);
    }
  }
  return String(content);
}
