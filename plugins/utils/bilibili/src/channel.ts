import type { Locale } from 'zhin.js/i18n';
import { messages } from './i18n.js';
/** A subscription destination uses public Message fields, never CapabilityId internals. */

export interface ChannelInfo {
  adapterName: string;
  endpointKey: string;
  channelType: 'private' | 'group' | 'channel';
  channelId: string;
  senderId: string;
}

export const CHANNEL_REQUIRED_MESSAGE = '请在机器人私聊、群聊或频道内执行此命令；当前调用没有有效的订阅会话';
export const UNSUPPORTED_ADDRESS_MESSAGE = '暂不支持线程／父频道寻址的订阅，请在无需线程或父频道信息的会话内执行';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasUnsupportedAddress(input: unknown): boolean {
  return isRecord(input) && isRecord(input.conversation)
    && (input.conversation.parent !== undefined || input.conversation.threadId !== undefined);
}

export function channelSourceError(input: unknown, locale: Locale = 'zh-CN'): string {
  return messages(locale, hasUnsupportedAddress(input) ? 'address' : 'source');
}

/** No IM source means no destination; callers must not invent a global subscription. */
export function extractChannelInfo(input: unknown): ChannelInfo | null {
  if (!isRecord(input) || !isRecord(input.conversation)) return null;
  if (hasUnsupportedAddress(input)) return null;
  const conversation = input.conversation;
  const kind = conversation.kind;
  if (kind !== 'private' && kind !== 'group' && kind !== 'channel') return null;
  if (!isIdentifier(input.clientAdapter) || !isIdentifier(input.endpointId) || !isIdentifier(conversation.id)) return null;
  const sender = input.sender;
  return {
    adapterName: input.clientAdapter,
    endpointKey: input.endpointId,
    channelType: kind,
    channelId: conversation.id,
    senderId: isRecord(sender) && isIdentifier(sender.id) ? sender.id : '',
  };
}

/** Full subscription scope, including the bot endpoint for multi-account adapters. */
export function subscriptionScope(channel: ChannelInfo): Record<string, string> {
  return {
    adapter_name: channel.adapterName,
    endpoint_id: channel.endpointKey,
    channel_type: channel.channelType,
    channel_id: channel.channelId,
  };
}
