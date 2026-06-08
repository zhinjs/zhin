import type { AgentMessage, UserMessage } from '../llm/types/agent-message.js';
import { createUserMessage } from '../llm/types/agent-message.js';

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
  const images = message.content.filter((b) => b.type === 'image');
  return createUserMessage(
    text,
    images.length > 0 ? images : undefined,
    message.timestamp,
  );
}

/** 发给 LLM：按 extra 拼接引用块 + sender 前缀（不修改 DB payload） */
export function renderUserMessageForLlm(
  message: UserMessage,
  extra?: AgentMessageExtra | null,
): UserMessage {
  if (!extra?.quote?.block && !extra?.sender) return message;
  let text = userMessagePlainText(message);
  const stripped = stripSenderPrefixFromText(text);
  text = stripped.body;
  const quoteSplit = splitQuoteFromUserText(text);
  text = quoteSplit.body;

  if (extra.quote?.block?.trim()) {
    text = `${extra.quote.block.trim()}\n\n${CURRENT_USER_MESSAGE_MARKER}\n${text}`;
  } else if (quoteSplit.quote?.block) {
    text = `${quoteSplit.quote.block}\n\n${CURRENT_USER_MESSAGE_MARKER}\n${text}`;
  }

  let out = cloneUserMessageWithText(message, text);
  if (extra.sender) {
    out = applySenderExtraToUserMessage(out, { sender: extra.sender });
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
  return cloneUserMessageWithText(message, `${prefix} ${body}`);
}

/** 从 ai_messages 等表的 sender_id / sender_roles 列构建 extra */
export function senderExtraFromColumns(
  senderId: string | undefined,
  senderRolesJson: string | undefined,
  scope: SenderScope = 'group',
): AgentMessageSenderExtra | undefined {
  const id = senderId?.trim();
  if (!id) return undefined;
  let roles: string[] = ['user'];
  if (senderRolesJson?.trim()) {
    try {
      const parsed = JSON.parse(senderRolesJson) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        roles = parsed.map(String);
      }
    } catch {
      roles = senderRolesJson.split(',').map((r) => r.trim()).filter(Boolean);
    }
  }
  return { id, roles, scope };
}

/** ConversationMemory 等辅助表：读库后拼 LLM 用正文 */
export function formatAuxiliaryUserContentForLlm(
  content: string,
  senderId?: string,
  senderRolesJson?: string,
): string {
  const sender = senderExtraFromColumns(senderId, senderRolesJson);
  if (!sender) return content;
  const prefix = buildSenderPrefix(sender);
  if (!prefix) return content;
  const { body } = stripSenderPrefixFromText(content);
  return `${prefix} ${body}`;
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

  if (!extra && text === userMessagePlainText(user)) {
    return { message };
  }

  return {
    message: cloneUserMessageWithText(user, text),
    extra,
  };
}
