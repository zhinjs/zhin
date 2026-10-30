import { createHash } from 'node:crypto';
import { messageRefKey, type ConversationContextBlock, type MessageRef, type TextSegment } from '@zhin.js/im-contract';
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

export function deliveredReplyContextRef(sessionId: string, turnId: string): string {
  return `delivered-reply:${createHash('sha256').update(JSON.stringify([sessionId, turnId])).digest('hex')}`;
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
): readonly string[] {
  const contexts = delivery.messageContexts ?? [];
  const references = contexts.filter(item => plannedTexts.includes(item.plannedText))
    .map(item => deliveredMessageContextRef(item.message, deliveredTextDigest(item.plannedText)));
  if (plannedTexts.length > 0 && plannedTexts.length === contexts.length
    && plannedTexts.every((text, index) => text !== undefined && text === contexts[index]?.plannedText)) {
    references.push(deliveredReplyContextRef(sessionId, turnId));
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
    ...(block.eventType === 'message.created' && block.message && block.messageTextDigest
      ? { reference: deliveredMessageContextRef(block.message, block.messageTextDigest) } : {}),
  }));
  return {
    ...createUserMessage(renderContextMessage({ role: 'user-context', blocks: contextBlocks })),
    contextBlocks,
  };
}
