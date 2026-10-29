import { type AgentMessageExtra, type AgentMessage, type UserMessage, type TextContentBlock, createUserMessage, userMessagePlainText, userMessageBody, renderUserMessageForLlm } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import { resolveTurnUserMessage } from '../session/session-io.js';
import { prependTurnContextEnvelope } from './turn-envelope.js';
export function buildTurnUserMessages(
  commMessage: Message,
  rawContent: string,
): {
  rawContent: string;
  userMessageExtra?: AgentMessageExtra;
  promptMessages: UserMessage[];
} {
  const { content, llmMessage } = resolveTurnUserMessage(
    commMessage as import('@zhin.js/core').AgentTurnMessage,
    rawContent,
  );
  return {
    rawContent: content,
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
    return {
      ...createUserMessage(
        prependTurnContextEnvelope(text, envelope),
        msg.media,
        msg.timestamp,
        msg.actor,
        msg.cause,
      ),
      ...(msg.messageId ? { messageId: msg.messageId } : {}),
      ...(msg.name ? { name: msg.name } : {}),
      ...(msg.quote ? { quote: msg.quote } : {}),
    };
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

/** State and applicable guidance precede the owned participant body; ephemeral data stays last. */
export function prependTurnContextBlocks(
  messages: AgentMessage[],
  blocks: readonly TextContentBlock[],
  extra?: AgentMessageExtra,
): AgentMessage[] {
  const first = messages[0];
  if (first?.role !== 'user' || !Array.isArray(first.content) || !blocks.length) return messages;
  const user = first as UserMessage;
  const stable = [...blocks.filter(block => block.contextRef && !block.ephemeral), ...user.content.filter(block => block.contextRef && !block.ephemeral)];
  const hasOwnedBody = user.content.some(block => block.presentation === 'user-input');
  const body = user.content.filter(block => hasOwnedBody ? block.presentation === 'user-input' : !block.contextRef && !block.ephemeral).map((block, index) => ({
    ...block, presentation: 'user-input' as const,
    text: index === 0 ? userMessageBody({ ...user, content: [block] }, extra) : block.text,
  }));
  if (!body.length) body.push({ type: 'text', text: '', presentation: 'user-input' });
  const current = [...(hasOwnedBody ? user.content.filter(block => !block.contextRef && !block.ephemeral && !block.presentation) : []),
    ...blocks.filter(block => !block.contextRef && !block.ephemeral)];
  const ephemeral = [...blocks, ...user.content].filter(block => block.ephemeral);
  return [renderUserMessageForLlm({ ...user, content: [...stable, ...current, ...body, ...ephemeral] }, extra), ...messages.slice(1)];
}
