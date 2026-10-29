import {
  buildStoredHeader,
  factsFromActor,
  factsFromBot,
  type AgentMessage,
  type AssistantMessage,
  type UserMessage,
} from '@zhin.js/ai';
import type { TurnContextState } from '../turn/turn-ingress.js';

/**
 * ADR 0041 §4: the trusted host stores the FULL participant header in `name` when an IM message
 * is created. Facts come only from the host-built `actor` / the turn's `contextState.bot`;
 * model output can never set `name`.
 */
export function stampUserHeader(user: UserMessage): UserMessage {
  if (!user.actor) return user;
  return { ...user, name: buildStoredHeader(factsFromActor(user.actor, user.messageId, user.timestamp), user.timestamp) };
}

/** Stamps every assistant message that carries text with the bot's full header; others stay untouched. */
export function stampAssistantHeaders(
  messages: AgentMessage[],
  bot: NonNullable<TurnContextState['bot']> | undefined,
): AgentMessage[] {
  const facts = factsFromBot(bot);
  if (!facts) return messages;
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const assistant = message as AssistantMessage;
    if (assistant.name !== undefined || !assistant.content.some(block => block.type === 'text')) return message;
    return { ...assistant, name: buildStoredHeader(facts, assistant.timestamp, { bot: true }) };
  });
}
