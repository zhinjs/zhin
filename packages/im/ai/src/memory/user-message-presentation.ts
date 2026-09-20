import {
  type AgentMessage,
  type ConversationActor,
  type UserMessage,
  createUserMessage,
} from '../llm/types/agent-message.js';

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

function sanitizeLabelAttribute(value: string | undefined): string {
  const normalized = value?.trim().replace(/[\]\s]+/g, '_').slice(0, 64);
  return normalized || 'unknown';
}

/** 将共享会话 actor 渲染为模型可见的非权威参与者标签。 */
export function buildActorPrefix(actor: ConversationActor): string | null {
  if (actor.scope !== 'group' && actor.scope !== 'channel') return null;
  const id = sanitizeLabelAttribute(actor.subjectId);
  const name = sanitizeLabelAttribute(actor.displayName);
  const roles = actor.roles?.filter((role) => role !== 'user').join(',') || 'user';
  return `[sender:id=${id} name=${name} roles=${roles}]`;
}

export function userMessagePlainText(message: UserMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .trim();
}

function cloneUserMessageWithText(message: UserMessage, text: string): UserMessage {
  return createUserMessage(
    text,
    message.media,
    message.timestamp,
    message.actor,
    message.cause,
  );
}

function stripKnownActorPrefix(message: UserMessage, text: string): string {
  const prefix = message.actor ? buildActorPrefix(message.actor) : null;
  if (!prefix || !text.startsWith(prefix)) return text;
  return text.slice(prefix.length).trimStart();
}

function stripKnownQuoteContext(text: string, quote?: AgentMessageQuoteExtra): string {
  const block = quote?.block.trim();
  if (!block) return text;
  const prefix = `${block}\n\n${CURRENT_USER_MESSAGE_MARKER}\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/** 返回不含模型展示标签的 canonical 用户正文。 */
export function userMessageBody(
  message: UserMessage,
  extra?: AgentMessageExtra | null,
): string {
  const withoutActor = stripKnownActorPrefix(message, userMessagePlainText(message));
  return stripKnownQuoteContext(withoutActor, extra?.quote);
}

/**
 * 在 LLM 边界渲染引用块和共享会话 actor 标签。
 * `UserMessage.actor` 是参与者身份的唯一权威；extra 只承载引用展示上下文。
 */
export function renderUserMessageForLlm(
  message: UserMessage,
  extra?: AgentMessageExtra | null,
): UserMessage {
  const actorPrefix = message.actor ? buildActorPrefix(message.actor) : null;
  const quoteBlock = extra?.quote?.block.trim();
  if (!quoteBlock && !actorPrefix) return message;

  let text = userMessageBody(message, extra);
  if (quoteBlock) {
    text = `${quoteBlock}\n\n${CURRENT_USER_MESSAGE_MARKER}\n${text}`;
  }
  if (actorPrefix) {
    text = `${actorPrefix} ${text}`;
  }
  return cloneUserMessageWithText(message, text);
}

/** 写入 DB：payload 保存 canonical 用户正文和 actor，媒体不进入历史。 */
export function normalizeUserMessageForStorage(
  message: AgentMessage,
  extra?: AgentMessageExtra,
): { message: AgentMessage; extra?: AgentMessageExtra } {
  if (message.role !== 'user') return { message };
  const user = message as UserMessage;
  const body = userMessageBody(user, extra);
  const stored = cloneUserMessageWithText(user, body);
  const { media: _dropped, ...withoutMedia } = stored;
  return {
    message: withoutMedia as UserMessage,
    ...(extra?.quote ? { extra: { quote: extra.quote } } : {}),
  };
}
