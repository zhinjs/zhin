import { type AgentMessageExtra, type AgentMessage, type UserMessage, createUserMessage, userMessagePlainText } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import { resolveTurnUserMessage } from '../session/session-io.js';
import { prependTurnContextEnvelope } from './turn-envelope.js';
export function buildTurnUserMessages(
  commMessage: Message,
  rawContent: string,
  passiveBlock?: string | null,
): {
  rawContent: string;
  userMessageExtra?: AgentMessageExtra;
  promptMessages: UserMessage[];
} {
  const { content, extra, llmMessage } = resolveTurnUserMessage(
    commMessage as import('@zhin.js/core').AgentTurnMessage,
    rawContent,
    { passiveBlock },
  );
  return {
    rawContent: content,
    userMessageExtra: extra,
    promptMessages: [llmMessage],
  };
}

export function applyTurnContextToUserMessages(
  messages: UserMessage[],
  envelope: string | null | undefined,
): UserMessage[] {
  if (!envelope?.trim() || messages.length === 0) return messages;
  return messages.map((msg, i) => {
    if (i !== 0 || msg.role !== 'user') return msg;
    const text = userMessagePlainText(msg);
    return createUserMessage(prependTurnContextEnvelope(text, envelope));
  });
}

export function prependEnvelopeToFirstUserText(
  messages: AgentMessage[],
  envelope: string | null | undefined,
): AgentMessage[] {
  if (!envelope?.trim() || messages.length === 0) return messages;
  const first = messages[0];
  if (!first || first.role !== 'user') return messages;

  const content = first.content;
  if (!Array.isArray(content)) return messages;

  const textIdx = content.findIndex((b) => b?.type === 'text');
  if (textIdx < 0) {
    return [
      { ...first, content: [{ type: 'text', text: envelope.trim() }, ...content] },
      ...messages.slice(1),
    ];
  }

  const block = content[textIdx];
  if (block.type !== 'text') return messages;
  const nextText = prependTurnContextEnvelope(block.text, envelope);
  if (nextText === block.text) return messages;

  const nextContent = [...content];
  nextContent[textIdx] = { type: 'text', text: nextText };
  return [{ ...first, content: nextContent }, ...messages.slice(1)];
}
