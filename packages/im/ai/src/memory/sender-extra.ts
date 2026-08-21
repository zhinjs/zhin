import {
  type AgentMessage,
  type ConversationActor,
  type UserMessage,
  createUserMessage,
} from '../llm/types/agent-message.js';
export type SenderScope = 'group' | 'channel' | 'private';

/** 与 core `QUOTED_MESSAGE_CONTEXT_MARKER` / `CURRENT_USER_MESSAGE_MARKER` 对齐 */
export const QUOTED_MESSAGE_CONTEXT_MARKER =
  '[Quoted message context - the user is replying to this]';
export const CURRENT_USER_MESSAGE_MARKER = '[Current message - respond to this]';

export interface AgentMessageSenderExtra {
  id: string;
  name?: string;
  roles: string[];
  scope: SenderScope;
}

export interface AgentMessageQuoteExtra {
  messageId?: string;
  /** 引用消息 context 块（不含当前用户正文） */
  block: string;
}

export interface AgentMessageExtra {
  sender?: AgentMessageSenderExtra;
  quote?: AgentMessageQuoteExtra;
}

const SENDER_ROLES_PREFIX_RE =
  /^\[sender:id=([^\s\]]+)(?:\s+name=([^\]\s]+))?\s+roles=([^\]]+)\]\s*/i;
const SENDER_PREFIX_RE = /^\[sender:(?:id=[^\]]*|[^\]]*)\]\s*/i;

export function parseAgentMessageExtra(
  raw: string | AgentMessageExtra | null | undefined,
): AgentMessageExtra | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw) as AgentMessageExtra;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function buildSenderPrefix(sender: AgentMessageSenderExtra): string | null {
  if (sender.scope !== 'group' && sender.scope !== 'channel') return null;
  const id = sender.id.trim() || 'unknown';
  const name = (sender.name?.trim() || 'unknown').replace(/[\]\s]+/g, '_').slice(0, 64);
  const roles = sender.roles.filter((r) => r !== 'user').join(',') || 'user';
  return `[sender:id=${id} name=${name} roles=${roles}]`;
}

export function stripSenderPrefixFromText(raw: string): {
  body: string;
  sender?: AgentMessageSenderExtra;
} {
  let text = raw.trimStart();
  const rolesMatch = text.match(SENDER_ROLES_PREFIX_RE);
  if (rolesMatch) {
    const roles = rolesMatch[3]!
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    return {
      body: text.slice(rolesMatch[0].length).trimStart(),
      sender: {
        id: rolesMatch[1]!,
        name: rolesMatch[2]?.trim() || undefined,
        roles: roles.length > 0 ? roles : ['user'],
        scope: 'group',
      },
    };
  }
  let changed = true;
  while (changed) {
    changed = false;
    const legacyMatch = text.match(SENDER_PREFIX_RE);
    if (legacyMatch) {
      text = text.slice(legacyMatch[0].length).trimStart();
      changed = true;
    }
  }
  return { body: text };
}

/** 从已拼接的 user 文本拆出引用块（遗留数据迁移） */
export function splitQuoteFromUserText(text: string): {
  body: string;
  quote?: AgentMessageQuoteExtra;
} {
  if (!text.includes(QUOTED_MESSAGE_CONTEXT_MARKER)
    || !text.includes(CURRENT_USER_MESSAGE_MARKER)) {
    return { body: text };
  }
  const idx = text.lastIndexOf(CURRENT_USER_MESSAGE_MARKER);
  if (idx < 0) return { body: text };
  const body = text.slice(idx + CURRENT_USER_MESSAGE_MARKER.length).trimStart();
  const block = text.slice(0, idx).trim();
  if (!block.includes(QUOTED_MESSAGE_CONTEXT_MARKER)) {
    return { body: text };
  }
  return { body, quote: { block } };
}

export function userMessagePlainText(message: UserMessage): string {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
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

function actorFromSender(sender: AgentMessageSenderExtra): ConversationActor {
  return {
    subjectId: sender.id,
    ...(sender.name ? { displayName: sender.name } : {}),
    roles: [...sender.roles],
    scope: sender.scope,
  };
}

function senderFromActor(actor: ConversationActor): AgentMessageSenderExtra | undefined {
  if (actor.scope !== 'group' && actor.scope !== 'channel') return undefined;
  return {
    id: actor.subjectId,
    ...(actor.displayName ? { name: actor.displayName } : {}),
    roles: [...(actor.roles ?? ['user'])],
    scope: actor.scope,
  };
}

/** 发给 LLM：按 extra 拼接引用块 + sender 前缀（不修改 DB payload） */
export function renderUserMessageForLlm(
  message: UserMessage,
  extra?: AgentMessageExtra | null,
): UserMessage {
  // The first-class actor is authoritative; `extra.sender` is the legacy
  // compatibility source for rows written before actor persistence existed.
  const sender = (message.actor ? senderFromActor(message.actor) : undefined) ?? extra?.sender;
  const quote = extra?.quote;
  if (!quote?.block && !sender) return message;
  let text = userMessagePlainText(message);
  const stripped = stripSenderPrefixFromText(text);
  text = stripped.body;
  const quoteSplit = splitQuoteFromUserText(text);
  text = quoteSplit.body;

  if (quote?.block?.trim()) {
    text = `${quote.block.trim()}\n\n${CURRENT_USER_MESSAGE_MARKER}\n${text}`;
  } else if (quoteSplit.quote?.block) {
    text = `${quoteSplit.quote.block}\n\n${CURRENT_USER_MESSAGE_MARKER}\n${text}`;
  }

  let out = cloneUserMessageWithText(message, text);
  if (sender) {
    out = applySenderExtraToUserMessage(out, { sender });
  }
  return out;
}

/** 发给 LLM 前：仅 sender 前缀 */
export function applySenderExtraToUserMessage(
  message: UserMessage,
  extra?: AgentMessageExtra | null,
): UserMessage {
  if (!extra?.sender) return message;
  const prefix = buildSenderPrefix(extra.sender);
  if (!prefix) return message;
  const { body } = stripSenderPrefixFromText(userMessagePlainText(message));
  return {
    ...cloneUserMessageWithText(message, `${prefix} ${body}`),
    actor: message.actor ?? actorFromSender(extra.sender),
  };
}

function mergeExtras(
  known?: AgentMessageExtra,
  parsed?: Partial<AgentMessageExtra>,
): AgentMessageExtra | undefined {
  const merged: AgentMessageExtra = {
    ...known,
    ...parsed,
    sender: known?.sender ?? parsed?.sender,
    quote: known?.quote ?? parsed?.quote,
  };
  if (!merged.sender && !merged.quote) return undefined;
  return merged;
}

/** 写入 DB：payload 仅存用户正文，元数据进 extra */
export function normalizeUserMessageForStorage(
  message: AgentMessage,
  knownExtra?: AgentMessageExtra,
): { message: AgentMessage; extra?: AgentMessageExtra } {
  if (message.role !== 'user') return { message };
  const user = message as UserMessage;
  let text = userMessagePlainText(user);
  const senderStripped = stripSenderPrefixFromText(text);
  text = senderStripped.body;
  const quoteSplit = splitQuoteFromUserText(text);
  text = quoteSplit.body;

  const extra = mergeExtras(knownExtra, {
    sender: senderStripped.sender,
    quote: quoteSplit.quote,
  });

  if (!extra && text === userMessagePlainText(user) && !user.media?.length) {
    return { message };
  }

  const stored = cloneUserMessageWithText(user, text);
  // 媒体块不持久化：payload 只留文本（媒体已在入站注入时消费，历史仅存文本视图）
  const { media: _dropped, ...strippedMessage } = stored;
  return {
    message: strippedMessage as UserMessage,
    extra,
  };
}
