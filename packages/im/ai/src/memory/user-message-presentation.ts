import {
  type AgentMessage,
  type UserMessage,
} from '../llm/types/agent-message.js';
import { renderSenderId } from './message-header.js';
import { parseParticipantHeader } from './participant-header.js';

/** 与 Core 的引用上下文标记保持一致。 */
export const QUOTED_MESSAGE_CONTEXT_MARKER =
  '[Quoted message context - the user is replying to this]';
export const CURRENT_USER_MESSAGE_MARKER = '[Current message - respond to this]';

export interface AgentMessageQuoteExtra {
  messageId?: string;
  /** 引用消息 context 块（不含当前用户正文）。 */
  block: string;
}

/** 不属于 AgentMessage 语义本体、但需要随消息持久化的展示上下文。 */
export interface AgentMessageExtra {
  quote?: AgentMessageQuoteExtra;
}

export function parseAgentMessageExtra(
  raw: string | AgentMessageExtra | null | undefined,
): AgentMessageExtra | undefined {
  if (raw == null || raw === '') return undefined;
  let parsed: unknown = raw;
  try {
    if (typeof raw === 'string') parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const quote = (parsed as { quote?: unknown }).quote;
  if (!quote || typeof quote !== 'object') return undefined;
  const block = (quote as { block?: unknown }).block;
  if (typeof block !== 'string' || !block.trim()) return undefined;
  const messageId = (quote as { messageId?: unknown }).messageId;
  return {
    quote: {
      block,
      ...(typeof messageId === 'string' ? { messageId } : {}),
    },
  };
}

export function userMessagePlainText(message: UserMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .trim();
}

function cloneUserMessageWithText(message: UserMessage, text: string): UserMessage {
  return { ...message, content: [{ type: 'text', text }] };
}

/**
 * Drops a rendered ADR 0041 header (full or short) from the first line. Only a header naming this
 * message's own sender is stripped, so a body that merely looks like one is left alone.
 */
function stripKnownHeaderLine(message: UserMessage, text: string): string {
  const own = parseParticipantHeader(message.name)?.userId
    ?? (message.actor ? renderSenderId(message.actor.subjectId) : undefined);
  if (!own) return text;
  const newline = text.indexOf('\n');
  const first = newline < 0 ? text : text.slice(0, newline);
  if (parseParticipantHeader(first)?.userId !== own) return text;
  return newline < 0 ? '' : text.slice(newline + 1);
}

function stripKnownQuoteContext(text: string, quote?: AgentMessageQuoteExtra): string {
  const block = quote?.block.trim();
  if (!block) return text;
  const prefix = `${block}\n\n${CURRENT_USER_MESSAGE_MARKER}\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function stripKnownUserPrefix(message: UserMessage, text: string): string {
  return stripKnownHeaderLine(message, text);
}

/** 返回不含模型展示标签的 canonical 用户正文。 */
export function userMessageBody(
  message: UserMessage,
  extra?: AgentMessageExtra | null,
): string {
  const body = message.content.filter(block => block.presentation === 'user-input');
  const withoutActor = stripKnownUserPrefix(message, userMessagePlainText(body.length ? { ...message, content: body } : message));
  return stripKnownQuoteContext(withoutActor, extra?.quote);
}

/**
 * 在 LLM 边界渲染引用块。参与者头（ADR 0041）由 `projectParticipantHeaders` 在投影时渲染；
 * extra 只承载引用展示上下文。
 */
export function renderUserMessageForLlm(
  message: UserMessage,
  extra?: AgentMessageExtra | null,
): UserMessage {
  const bodyIndex = message.content.findIndex(block => block.presentation === 'user-input');
  if (bodyIndex >= 0) {
    const block = message.content[bodyIndex]!;
    const text = renderBodyText(message, block.text, extra);
    return text === block.text ? message : { ...message, content: message.content.map((part, index) => index === bodyIndex ? { ...part, text } : part) };
  }
  if (message.content.some(isEphemeralBlock)) {
    // Ephemeral blocks stay separate (and keep their flag) so storage can drop them.
    const ephemeral = message.content.filter(isEphemeralBlock);
    const rendered = renderUserMessageForLlm({ ...message, content: message.content.filter(block => !isEphemeralBlock(block)) }, extra);
    return { ...rendered, content: [...rendered.content, ...ephemeral] };
  }
  if (message.content.some(block => block.contextRef)) {
    const [first, ...rest] = message.content;
    if (!first || first.contextRef) return message;
    const head = renderUserMessageForLlm({ ...message, content: [first] }, extra);
    return { ...head, content: [...head.content, ...rest] };
  }
  const quoteBlock = extra?.quote?.block.trim();
  if (!quoteBlock) return message;

  return cloneUserMessageWithText(message, renderBodyText(message, userMessagePlainText(message), extra));
}

function renderBodyText(message: UserMessage, body: string, extra?: AgentMessageExtra | null): string {
  const quoteBlock = extra?.quote?.block.trim();
  let text = stripKnownQuoteContext(stripKnownUserPrefix(message, body), extra?.quote);
  if (quoteBlock) {
    text = `${quoteBlock}\n\n${CURRENT_USER_MESSAGE_MARKER}\n${text}`;
  }
  return text;
}

/** 写入 DB：payload 保存 canonical 用户正文和 actor，媒体不进入历史。 */
export function normalizeUserMessageForStorage(
  message: AgentMessage,
  extra?: AgentMessageExtra,
): { message: AgentMessage; extra?: AgentMessageExtra } {
  if (message.role !== 'user') return { message };
  const user = message as UserMessage;
  if (user.content.some(block => block.presentation === 'user-input')) {
    const content = user.content.filter(block => !isEphemeralBlock(block));
    const bodyIndex = content.findIndex(block => block.presentation === 'user-input');
    const { media: _dropped, ...stored } = user;
    return {
      message: { ...stored, content: content.map((block, index) => index === bodyIndex
        ? { ...block, text: stripKnownQuoteContext(stripKnownUserPrefix(user, block.text), extra?.quote) } : block) },
      ...(extra?.quote ? { extra: { quote: extra.quote } } : {}),
    };
  }
  if (user.content.some(isEphemeralBlock)) {
    return normalizeUserMessageForStorage({ ...user, content: user.content.filter(block => !isEphemeralBlock(block)) }, extra);
  }
  if (user.content.some(block => block.contextRef)) {
    const [first, ...rest] = user.content;
    // Injections have an unmarked leading presentation block. Preserve marked
    // blocks even for custom callers that put one first; do not guess at text.
    const head = first && !first.contextRef
      ? normalizeUserMessageForStorage({ ...user, content: [first] }, extra)
      : { message: { ...user, content: [] }, extra };
    const { media: _dropped, ...stored } = head.message as UserMessage;
    return {
      message: { ...stored, content: first?.contextRef ? user.content : [...stored.content, ...rest] },
      ...(head.extra ? { extra: head.extra } : {}),
    };
  }
  const body = userMessageBody(user, extra);
  const stored = cloneUserMessageWithText(user, body);
  const { media: _dropped, ...withoutMedia } = stored;
  return {
    message: withoutMedia as UserMessage,
    ...(extra?.quote ? { extra: { quote: extra.quote } } : {}),
  };
}

/** Per-turn block (ADR 0043 §1): `ephemeral` data or an explicitly `perTurn` runtime context block. */
function isEphemeralBlock(block: UserMessage['content'][number]): boolean {
  return block.type === 'text'
    && ((block as { ephemeral?: unknown }).ephemeral === true || (block as { perTurn?: unknown }).perTurn === true);
}
