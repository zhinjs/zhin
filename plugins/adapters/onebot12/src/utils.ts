/**
 * OneBot 12 事件与 zhin Message 的转换、消息段转换
 */
import type { SendContent } from 'zhin.js';
import type { OneBot12Event, OneBot12Segment } from './types.js';

/** 判断是否为消息事件（type=message） */
export function isMessageEvent(ev: OneBot12Event): ev is OneBot12Event & { message_id: string; message?: OneBot12Segment[] } {
  return ev.type === 'message' && !!ev.message_id;
}

/** 从事件得到 zhin 场景 id：私聊 user_id，群 group_id，频道 channel_id 或 guild_id:channel_id */
export function getChannelId(ev: OneBot12Event): string {
  if (ev.detail_type === 'private' && ev.user_id) return ev.user_id;
  if (ev.detail_type === 'group' && ev.group_id) return ev.group_id;
  if (ev.detail_type === 'channel' && ev.channel_id) {
    return ev.guild_id ? `${ev.guild_id}:${ev.channel_id}` : ev.channel_id;
  }
  return '';
}

/** 从事件得到 channel 类型 */
export function getChannelType(ev: OneBot12Event): 'private' | 'group' {
  if (ev.detail_type === 'private') return 'private';
  return 'group';
}

/** 将 OneBot 12 消息事件转为 zhin Message 的 MessageBase 所需字段 */
export function formatOneBot12MessagePayload(
  ev: OneBot12Event,
  botName: string,
  recallFn: (msgId: string) => Promise<void>,
  replyFn: (channel: { id: string; type: 'group' | 'private' }, content: (string | { type: string; data?: Record<string, unknown> })[], quote?: boolean | string) => Promise<string>,
): {
  $id: string;
  $adapter: 'onebot12';
  $bot: string;
  $channel: { id: string; type: 'group' | 'private' };
  $sender: { id: string; name: string };
  $content: Array<{ type: string; data: Record<string, unknown> }>;
  $raw: string;
  $timestamp: number;
  $recall: () => Promise<void>;
  $reply: (content: SendContent, quote?: boolean | string) => Promise<string>;
} {
  const channelId = getChannelId(ev);
  const channelType = getChannelType(ev);
  const raw = ev.alt_message ?? (Array.isArray(ev.message) ? ev.message.map((s) => (s.type === 'text' ? (s.data?.text as string) ?? '' : '')).join('') : '');
  const content = Array.isArray(ev.message)
    ? ev.message.map((s) => ({ type: s.type, data: (s.data ?? {}) as Record<string, unknown> }))
    : [{ type: 'text', data: { text: raw } }];
  const senderId = ev.user_id ?? '';
  const senderName = (ev as Record<string, unknown>)['user.name'] as string | undefined ?? (ev as Record<string, unknown>)['qq.nickname'] as string | undefined ?? senderId;

  return {
    $id: ev.message_id!,
    $adapter: 'onebot12',
    $bot: botName,
    $channel: { id: channelId, type: channelType },
    $sender: { id: senderId, name: senderName },
    $content: content,
    $raw: raw,
    $timestamp: ev.time ?? 0,
    $recall: () => recallFn(ev.message_id!),
    $reply: (cnt: SendContent, quote?: boolean | string) =>
      replyFn(
        { id: channelId, type: channelType },
        (Array.isArray(cnt) ? cnt : [cnt]) as (string | { type: string; data?: Record<string, unknown> })[],
        quote,
      ),
  };
}

/** 将 zhin 的 content（segment 数组或字符串）转为 OneBot 12 message 段数组；简单实现仅 text */
export function contentToOb12Segments(content: SendContent): OneBot12Segment[] {
  const arr = Array.isArray(content) ? content : [content];
  const segs: OneBot12Segment[] = [];
  for (const c of arr) {
    if (typeof c === 'string') {
      segs.push({ type: 'text', data: { text: c } });
    } else if (c && typeof c === 'object' && 'type' in c) {
      const el = c as { type: string; data?: Record<string, unknown> };
      segs.push({ type: el.type, data: el.data ?? {} });
    }
  }
  return segs.length ? segs : [{ type: 'text', data: { text: '' } }];
}
