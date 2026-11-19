import { createHash } from 'node:crypto';
import { conversationRefKey, messageRefKey, type ConversationContextBlock, type ConversationRef, type MessageRef, type TextSegment } from '@zhin.js/im-contract';
import { createUserMessage, renderContextMessage, type UserMessage } from '@zhin.js/ai';
import { splitOutputMessages, type AgentOutputElement } from '../outbound/agent-output.js';
import type { DeliveryOutcome } from '../turn/turn-ingress.js';

/** Opaque identities keep platform paths and IDs out of provider-facing metadata. */
export function deliveredMessageContextRef(message: MessageRef, textDigest: string): string {
  return `delivered-message:${createHash('sha256').update(JSON.stringify([messageRefKey(message), textDigest])).digest('hex')}`;
}

export function deliveredTextDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function deliveredReplyContextRef(sessionId: string, turnId: string, phaseId?: string): string {
  return `delivered-reply:${createHash('sha256').update(JSON.stringify(phaseId === undefined ? [sessionId, turnId] : [sessionId, turnId, phaseId])).digest('hex')}`;
}

/** Capture primitive evidence before a send hook can mutate any shared segment objects. */
export function plannedReplyTexts(output: readonly AgentOutputElement[]): readonly (string | undefined)[] {
  return splitOutputMessages(output).map(message => {
    const parts: string[] = [];
    for (const element of message) {
      if (element.type === 'message' && element.segments.every((segment): segment is TextSegment => segment.type === 'text')) {
        parts.push(element.segments.map(segment => String(segment.data.text)).join(''));
      } else if (element.type === 'text') parts.push(element.content);
      else return undefined;
    }
    return parts.join('');
  });
}

/** Rich/rewritten/partial replies keep their events unless exact plain-text evidence covers them. */
export function deliveredReplyContextRefs(
  sessionId: string,
  turnId: string,
  plannedTexts: readonly (string | undefined)[],
  delivery: Extract<DeliveryOutcome, { status: 'sent' }>,
  phaseId?: string,
): readonly string[] {
  const contexts = delivery.messageContexts ?? [];
  const references = contexts.filter(item => plannedTexts.includes(item.plannedText))
    .map(item => deliveredMessageContextRef(item.message, deliveredTextDigest(item.plannedText)));
  if (plannedTexts.length > 0 && plannedTexts.length === contexts.length
    && plannedTexts.every((text, index) => text !== undefined && text === contexts[index]?.plannedText)) {
    references.push(deliveredReplyContextRef(sessionId, turnId, phaseId));
  }
  return references;
}

/** Preserve each original event so a later tail/branch view can project it again. */
export function conversationContextMessage(blocks: readonly ConversationContextBlock[]): UserMessage | undefined {
  if (!blocks.length) return undefined;
  const contextBlocks = blocks.map(block => ({
    type: 'untrusted_conversation_event' as const,
    eventType: block.eventType,
    text: block.text,
    source: 'external_content',
    ...((block.eventType === 'message.created' || block.eventType === 'message.updated') && block.message && block.messageTextDigest
      ? { reference: deliveredMessageContextRef(block.message, block.messageTextDigest) } : {}),
  }));
  return {
    ...createUserMessage(renderContextMessage({ role: 'user-context', blocks: contextBlocks })),
    contextBlocks,
  };
}

/**
 * #1250 `own-unhandled-message-counts-as-background` (ADR 0067 D8): the private chat and the person
 * whose own earlier messages there are not lower-trust content for this turn. Only a message-started
 * IM turn in a private conversation (`scope` and the canonical conversation kind both `private`), with
 * the canonical conversation address and a single principal, has one; anything else returns
 * `undefined`, and then every background block counts.
 */
export interface OwnPrivateInbound {
  readonly conversation: ConversationRef;
  readonly subjectId: string;
}

export function ownPrivateInbound(turn: Readonly<{
  origin: Readonly<{ kind: string; scope?: string; messageId?: string; conversation?: unknown }>;
  principal: Readonly<{ subjectId: string; origin?: string }>;
  input?: Readonly<{ mergedSenders?: readonly unknown[] }>;
}>): OwnPrivateInbound | undefined {
  const { origin, principal } = turn;
  if (origin.kind !== 'im' || origin.scope !== 'private' || !origin.messageId) return undefined;
  if (principal.origin !== undefined && principal.origin !== 'human') return undefined;
  if (turn.input?.mergedSenders?.length) return undefined;
  const conversation = origin.conversation as ConversationRef | undefined;
  if (!conversation || conversation.kind !== 'private' || !conversation.endpoint?.id || !conversation.endpoint.adapter) return undefined;
  return principal.subjectId ? Object.freeze({ conversation, subjectId: principal.subjectId }) : undefined;
}

/**
 * #1250 `own-reply-counts-as-background`: the background blocks that bring content the session
 * history does not already carry, i.e. the ones that make a turn read lower-trust content (ADR 0067).
 * A block of the bot's own message that this agent delivered as its reply in this session — same
 * platform message, same delivered text digest (`isDelivered`) — is history-equivalent: session
 * history (earlier replies, tool results, background) is not a provenance source either. The block
 * stays in the prompt (the model keeps the order of the chat); it only does not count. Every other
 * block counts: members' messages, scene events, and the bot's own messages sent by other paths
 * (plugin commands, scheduled deliveries, other sessions), whose text may be third-party content.
 *
 * ADR 0067 D8 (`own`): in a private chat, a block of the turn initiator's own inbound message, stored
 * as the endpoint delivered it (the IM runtime's `inboundActorId` / `inboundTextDigest` evidence), in
 * the same conversation (platform, endpoint, conversation) and from the same sender id, does not count
 * either: it is the initiator's own words, as trusted as the message that started the turn. A block
 * without that evidence (rewritten, quoting, media, forwarded, another sender, another conversation)
 * counts — fail closed.
 */
export function unrepresentedConversationBlocks(
  blocks: readonly ConversationContextBlock[],
  isDelivered: (contextRef: string) => boolean,
  own?: OwnPrivateInbound,
): readonly ConversationContextBlock[] {
  const ownConversation = own ? conversationRefKey(own.conversation) : undefined;
  return blocks.filter(block => {
    if (block.eventType !== 'message.created' && block.eventType !== 'message.updated') return true;
    if (!block.message) return true;
    if (block.messageTextDigest && isDelivered(deliveredMessageContextRef(block.message, block.messageTextDigest))) return false;
    return !(own && block.eventType === 'message.created' && block.inboundTextDigest && block.inboundActorId !== undefined
      && block.inboundActorId === own.subjectId && block.message.conversation.kind === 'private'
      && conversationRefKey(block.message.conversation) === ownConversation);
  });
}
