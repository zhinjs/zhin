import { createHash } from 'node:crypto';
import type {
  AgentMessage,
  AssistantMessage,
  ConversationActor,
  ConversationQuote,
  UserMessage,
} from '@zhin.js/ai';
import type { TurnContextState } from '../turn/turn-ingress.js';

/**
 * ADR 0041 §4 (amended): the trusted host stores only STRUCTURED participant facts; the header string is
 * rendered at the LLM boundary (`projectParticipantHeaders`). A user message already carries its host-built
 * `actor`, so this only attaches the quoted message (ADR 0043 §4) — `name` is never written.
 */
export function stampUserHeader(user: UserMessage, quote?: ConversationQuote): UserMessage {
  return quote ? { ...user, quote } : user;
}

/** The bot's own facts as a structured actor, from the turn's `contextState.bot`. */
export function assistantActorOf(bot: NonNullable<TurnContextState['bot']> | undefined): ConversationActor | undefined {
  if (!bot?.id) return undefined;
  return {
    subjectId: bot.id,
    ...(bot.name?.trim() ? { displayName: bot.name.trim() } : {}),
    ...(bot.platformRole ? { roles: [bot.platformRole] } : {}),
    ...(bot.nickname ? { groupNickname: bot.nickname } : {}),
  };
}

/** Marks every assistant message that carries text with the bot's actor; others stay untouched. */
export function stampAssistantHeaders(
  messages: AgentMessage[],
  bot: NonNullable<TurnContextState['bot']> | undefined,
): AgentMessage[] {
  const assistantActor = assistantActorOf(bot);
  if (!assistantActor) return messages;
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const assistant = message as AssistantMessage;
    if (assistant.name !== undefined || assistant.assistantActor !== undefined
      || !assistant.content.some(block => block.type === 'text')) return message;
    return { ...assistant, assistantActor };
  });
}

/**
 * ADR 0043 §5: once delivery reports the platform id of the bot's reply, the last text-bearing assistant
 * message of the turn carries it, so later quotes of that reply resolve to an alias.
 */
export function stampDeliveredMessageId(messages: AgentMessage[], messageId: string | undefined, contextRefs?: readonly string[], messageIds?: readonly (string | null)[]): AgentMessage[] {
  // Providers do not own delivery provenance, including on intermediate assistant messages.
  let next = messages.map(message => {
    if (message.role !== 'assistant' || (!('contextRefs' in message) && !('contextDigest' in message) && !('messageIds' in message))) return message;
    const { contextRefs: _untrusted, contextDigest: _untrustedDigest, messageIds: _untrustedIds, ...clean } = message as AssistantMessage;
    return clean;
  });
  if (next.every((message, index) => message === messages[index])) next = messages;
  const confirmed = messageIds?.map(id => typeof id === 'string' && id.trim() ? id : null)
    ?? (messageId?.trim() ? [messageId] : []);
  if (!confirmed.length && !contextRefs?.length) return next;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const message = next[i]!;
    if (message.role !== 'assistant') continue;
    const assistant = message as AssistantMessage;
    if (!assistant.content.some(block => block.type === 'text')) continue;
    const stamped = next.slice();
    const firstKnown = confirmed.find((id): id is string => id !== null);
    stamped[i] = { ...assistant, ...(confirmed.length ? { ...(firstKnown ? { messageId: firstKnown } : {}), messageIds: confirmed } : {}), ...(contextRefs?.length ? {
      contextRefs: [...contextRefs], contextDigest: createHash('sha256').update(JSON.stringify(assistant.content.filter(block => block.type === 'text').map(block => block.text))).digest('hex'),
    } : {}) };
    return stamped;
  }
  return next;
}
