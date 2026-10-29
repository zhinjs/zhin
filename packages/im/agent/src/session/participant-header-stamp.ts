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
export function stampDeliveredMessageId(messages: AgentMessage[], messageId: string | undefined): AgentMessage[] {
  if (!messageId) return messages;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== 'assistant') continue;
    const assistant = message as AssistantMessage;
    if (!assistant.content.some(block => block.type === 'text')) continue;
    const next = messages.slice();
    next[i] = { ...assistant, messageId };
    return next;
  }
  return messages;
}
