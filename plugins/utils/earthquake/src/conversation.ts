import { createDeliveryTarget, type DeliveryTarget } from 'zhin.js/plugin-runtime';
import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
/**
 * Extracts a push destination from the public Message fields of a command input.
 * Platform-agnostic: only adapter name, endpoint, conversation kind/id and sender id.
 */
import { isRecord } from './sources/parse-helpers.js';
import type { ConversationKind } from './subscriptions.js';

export interface ConversationTarget {
  readonly target: DeliveryTarget;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversationKind: ConversationKind;
  readonly conversationId: string;
  readonly senderId: string;
}

export const CONVERSATION_REQUIRED_MESSAGE = '请在机器人私聊、群聊或频道中使用此命令';
export const THREAD_UNSUPPORTED_MESSAGE = '暂不支持在话题／子频道内订阅，请在主会话中使用';

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isThreaded(input: Record<string, unknown>): boolean {
  const conversation = input.conversation;
  if (!isRecord(conversation)) return false;
  return conversation.parent !== undefined || conversation.threadId !== undefined;
}

export function conversationError(input: unknown, locale: Locale = 'zh-CN'): string {
  if (isRecord(input) && isThreaded(input)) return t(locale, 'noThread');
  return t(locale, 'conversation');
}

/** Returns null when the input has no complete, un-threaded conversation address. */
export function extractConversation(input: unknown): ConversationTarget | null {
  if (!isRecord(input)) return null;
  if (isThreaded(input)) return null;
  const conversation = input.conversation;
  if (!isRecord(conversation)) return null;
  const kind = conversation.kind;
  if (kind !== 'private' && kind !== 'group' && kind !== 'channel') return null;
  // Canonical scene identity is authoritative; display names are never persisted as account identity.
  const endpoint = isRecord(conversation.endpoint) ? conversation.endpoint : {};
  const adapter = endpoint.adapter;
  const endpointKey = endpoint.id;
  if (!isIdentifier(adapter)) return null;
  if (!isIdentifier(endpointKey)) return null;
  if (!isIdentifier(conversation.id)) return null;
  const sender = input.sender;
  const senderId = isRecord(sender) && isIdentifier(sender.id) ? sender.id : '';
  return {
    target: createDeliveryTarget({ conversation: conversation as DeliveryTarget }),
    adapter,
    endpointKey,
    conversationKind: kind,
    conversationId: conversation.id,
    senderId,
  };
}
