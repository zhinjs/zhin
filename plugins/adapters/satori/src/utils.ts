/**
 * Satori 事件与 zhin Message 的转换
 */
import type { SendContent } from 'zhin.js';
import { Message } from 'zhin.js';
import type { SatoriEventBody, SatoriMessage, SatoriChannel } from './types.js';

/** Satori Channel.type: 0=TEXT, 1=DIRECT, 2=CATEGORY, 3=VOICE */
export function isPrivateChannel(channel?: SatoriChannel): boolean {
  return channel?.type === 1;
}

/** 将 Satori 事件体转为 zhin Message 的 MessageBase（仅 message-created/updated，供 $formatMessage 使用） */
export function formatSatoriMessagePayload(
  body: SatoriEventBody,
  adapterName: 'satori',
  botName: string,
  recallFn: (msgId: string) => Promise<void>,
  replyFn: (channel: { id: string; type: 'group' | 'private' }, content: (string | { type: string; data?: Record<string, unknown> })[], quote?: boolean | string) => Promise<string>,
): {
  $id: string;
  $adapter: 'satori';
  $bot: string;
  $channel: { id: string; type: 'group' | 'private' };
  $sender: { id: string; name: string };
  $content: Array<{ type: string; data: Record<string, unknown> }>;
  $raw: string;
  $timestamp: number;
  $recall: () => Promise<void>;
  $reply: (content: SendContent, quote?: boolean | string) => Promise<string>;
} {
  const msg = body.message!;
  const channel = body.channel ?? msg.channel;
  const user = body.user ?? msg.user ?? msg.member?.user;
  const channelId = channel?.id ?? '';
  const isPrivate = isPrivateChannel(channel);
  const content = msg.content ?? '';
  const raw = typeof content === 'string' ? content : String(content);
  const senderId = user?.id ?? '';
  const senderName = user?.name ?? msg.member?.nick ?? senderId;

  return {
    $id: `${channelId}:${msg.id}`,
    $adapter: 'satori',
    $bot: botName,
    $channel: { id: channelId, type: isPrivate ? 'private' : 'group' },
    $sender: { id: senderId, name: senderName },
    $content: [{ type: 'text', data: { text: raw } }],
    $raw: raw,
    $timestamp: body.timestamp ?? msg.created_at ?? Math.floor(Date.now() / 1000),
    $recall: () => recallFn(`${channelId}:${msg.id}`),
    $reply: (cnt: SendContent, quote?: boolean | string) =>
      replyFn(
        { id: channelId, type: isPrivate ? 'private' : 'group' },
        (Array.isArray(cnt) ? cnt : [cnt]) as (string | { type: string; data?: Record<string, unknown> })[],
        quote,
      ),
  };
}

/** 判断是否为消息相关事件（message-created / message-updated） */
export function isMessageEvent(body: SatoriEventBody): body is SatoriEventBody & { message: SatoriMessage } {
  return (body.type === 'message-created' || body.type === 'message-updated') && !!body.message?.id;
}
