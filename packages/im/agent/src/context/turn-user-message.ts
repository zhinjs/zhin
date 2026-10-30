import { type AgentMessageExtra, type AgentMessage, type UserMessage, type TextContentBlock, createUserMessage, userMessagePlainText, userMessageBody, renderUserMessageForLlm, RUNTIME_CONTEXT_MARKER } from '@zhin.js/ai';
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

type UserBlock = UserMessage['content'][number];

function isRuntimeTailBlock(block: UserBlock): boolean {
  return block.type === 'text' && (block.perTurn === true || block.ephemeral === true);
}

function runtimeContextMarkerBlock(): TextContentBlock {
  return { type: 'text', text: RUNTIME_CONTEXT_MARKER, perTurn: true };
}

/** Runtime context is per-turn by definition: it never reaches storage (ADR 0043 §1). */
function asRuntimeTail(block: TextContentBlock): TextContentBlock {
  return block.perTurn === true || block.ephemeral === true ? block : { ...block, perTurn: true };
}

/** Context-ref blocks first (stable within the turn), then turn notes, ephemeral data last. */
function orderTail(blocks: readonly TextContentBlock[]): TextContentBlock[] {
  return [
    ...blocks.filter(block => block.contextRef && !block.ephemeral),
    ...blocks.filter(block => !block.contextRef && !block.ephemeral),
    ...blocks.filter(block => block.ephemeral),
  ];
}

/**
 * Prompt-cache layout of the current user message:
 *
 * 1. header + body (`presentation: 'user-input'`) and whatever else is stored with the message —
 *    byte-identical to how the same message renders later as history;
 * 2. `RUNTIME_CONTEXT_MARKER`;
 * 3. per-turn runtime context (session rules, guidance, memory snapshot, skills, `[Turn context]`,
 *    ledger…), ephemeral data last.
 *
 * Earlier the runtime context preceded the body, so the next request (where history carries the body
 * alone) diverged at the start of this message and lost every cached token after it.
 */
export function appendTurnContextBlocks(
  messages: AgentMessage[],
  blocks: readonly TextContentBlock[],
  extra?: AgentMessageExtra,
): AgentMessage[] {
  const first = messages[0];
  if (first?.role !== 'user' || !Array.isArray(first.content) || !blocks.length) return messages;
  const user = first as UserMessage;
  const hasOwnedBody = user.content.some(block => block.presentation === 'user-input');
  const isBody = (block: UserBlock): boolean => hasOwnedBody
    ? block.presentation === 'user-input'
    : block.type === 'text' && !block.contextRef && !isRuntimeTailBlock(block);
  const body: UserBlock[] = user.content.filter(isBody).map((block, index) => block.type !== 'text' ? block : {
    ...block, presentation: 'user-input' as const,
    text: index === 0 ? userMessageBody({ ...user, content: [block] }, extra) : block.text,
  });
  if (!body.length) body.push({ type: 'text', text: '', presentation: 'user-input' });
  // Stored with the message (and so replayed as history): keep them on the cached side of the marker.
  const persisted = user.content.filter(block => !isBody(block) && !isRuntimeTailBlock(block)
    && (hasOwnedBody || (block.type === 'text' && block.contextRef)));
  const existingTail = user.content.filter(block => isRuntimeTailBlock(block)
    && !(block.type === 'text' && block.text === RUNTIME_CONTEXT_MARKER)) as TextContentBlock[];
  const tail = orderTail([...blocks.map(asRuntimeTail), ...existingTail]);
  return [renderUserMessageForLlm({
    ...user,
    content: [...body, ...persisted, runtimeContextMarkerBlock(), ...tail],
  }, extra), ...messages.slice(1)];
}

/**
 * Adds runtime context to the tail of the last user message (after its marker, before ephemeral
 * data). Never inserts anything in front of the body or between a tool call and its result.
 */
export function appendRuntimeContext(
  messages: AgentMessage[],
  blocks: readonly TextContentBlock[],
): AgentMessage[] {
  if (!blocks.length) return messages;
  const added = blocks.map(asRuntimeTail);
  const userIndex = messages.map(message => message.role === 'user' && Array.isArray(message.content)).lastIndexOf(true);
  if (userIndex < 0) return [...messages, { ...createUserMessage(''), content: added }];
  return messages.map((message, index) => {
    if (index !== userIndex) return message;
    const content = (message as UserMessage).content;
    const markerIndex = content.findIndex(block => block.type === 'text' && block.perTurn === true && block.text === RUNTIME_CONTEXT_MARKER);
    if (markerIndex < 0) {
      const head = content.filter(block => !isRuntimeTailBlock(block));
      const tail = content.filter(isRuntimeTailBlock) as TextContentBlock[];
      return { ...message, content: [...head, runtimeContextMarkerBlock(), ...orderTail([...tail, ...added])] } as AgentMessage;
    }
    const tail = content.slice(markerIndex + 1) as TextContentBlock[];
    const ephemeralAt = tail.findIndex(block => block.ephemeral === true);
    const at = ephemeralAt < 0 ? tail.length : ephemeralAt;
    return { ...message, content: [...content.slice(0, markerIndex + 1), ...tail.slice(0, at), ...added, ...tail.slice(at)] } as AgentMessage;
  });
}
