/**
 * Milky 事件/消息段与 zhin Message 的转换
 */
import type { MessageBase, SendContent } from 'zhin.js';
import { Message } from 'zhin.js';
import type { MilkyEvent, MilkyIncomingMessage, MilkyIncomingSegment } from './types.js';

/** 将 Milky 接收消息段转为 zhin 的 $content（MessageSegment[]） */
export function formatMilkySegments(segments: MilkyIncomingSegment[]): Array<{ type: string; data: Record<string, unknown> }> {
  return segments.map((seg) => {
    const type = seg.type;
    const data = seg.data ?? {};
    switch (type) {
      case 'text':
        return { type: 'text', data: { text: (data as { text?: string }).text ?? '' } };
      case 'mention':
        return { type: 'at', data: { id: String((data as { user_id?: number }).user_id ?? '') } };
      case 'mention_all':
        return { type: 'at', data: { type: 'all' } };
      case 'face':
        return { type: 'face', data: { id: (data as { face_id?: string }).face_id ?? '' } };
      case 'reply':
        return {
          type: 'reply',
          data: { message_seq: (data as { message_seq?: number }).message_seq },
        };
      case 'image':
        return {
          type: 'image',
          data: {
            url: (data as { temp_url?: string }).temp_url ?? (data as { resource_id?: string }).resource_id ?? '',
          },
        };
      case 'record':
        return {
          type: 'record',
          data: {
            url: (data as { temp_url?: string }).temp_url ?? (data as { resource_id?: string }).resource_id ?? '',
          },
        };
      case 'video':
        return {
          type: 'video',
          data: {
            url: (data as { temp_url?: string }).temp_url ?? (data as { resource_id?: string }).resource_id ?? '',
          },
        };
      case 'file':
        return {
          type: 'file',
          data: {
            file_id: (data as { file_id?: string }).file_id,
            name: (data as { file_name?: string }).file_name,
          },
        };
      default:
        return { type, data: data as Record<string, unknown> };
    }
  });
}

/** message_receive 事件的 data 转为 zhin Message 的构造参数（含 $adapter、$bot） */
export function formatMilkyMessagePayload(
  event: MilkyEvent,
  data: MilkyIncomingMessage,
  recallFn: (msgId: string) => Promise<void>,
  replyFn: (channel: { id: string; type: 'group' | 'private' }, content: (string | { type: string; data?: Record<string, unknown> })[], quote?: boolean | string) => Promise<string>,
  adapterName: 'milky',
  botName: string,
): MessageBase {
  const scene = data.message_scene;
  const isGroup = scene === 'group';
  const channelId = data.peer_id.toString();
  const msgId = `${data.message_scene}:${data.peer_id}:${data.message_seq}`;
  const channel = { id: channelId, type: (isGroup ? 'group' : 'private') as 'group' | 'private' };
  const senderId = data.sender_id.toString();
  const senderName =
    (isGroup ? data.group_member?.card ?? data.group_member?.nickname : data.friend?.nickname) ?? senderId;
  const content = formatMilkySegments(data.segments);
  const raw = content.map((c) => (c.type === 'text' ? (c.data as { text?: string }).text : '')).join('');

  return {
    $id: msgId,
    $adapter: 'milky',
    $bot: botName,
    $channel: channel,
    $sender: { id: senderId, name: senderName },
    $content: content,
    $raw: raw,
    $timestamp: data.time,
    $recall: () => recallFn(msgId),
    $reply: (cnt: SendContent, quote?: boolean | string) =>
      replyFn(channel, (Array.isArray(cnt) ? cnt : [cnt]) as (string | { type: string; data?: Record<string, unknown> })[], quote),
  };
}

/** 根据 event_type 判断是否为 message_receive，并解析 data 为 MilkyIncomingMessage */
export function parseMessageReceiveData(event: MilkyEvent): MilkyIncomingMessage | null {
  if (event.event_type !== 'message_receive' || !event.data) return null;
  const data = event.data as unknown as MilkyIncomingMessage;
  if (!data.message_scene || !Number.isInteger(data.peer_id) || !Array.isArray(data.segments)) return null;
  return data;
}

/** zhin SendContent（string | MessageElement 或数组）转为 Milky OutgoingSegment[]（发送用） */
export function toMilkyOutgoingSegments(
  content: (string | { type: string; data?: Record<string, unknown> })[],
): Array<{ type: string; data: Record<string, unknown> }> {
  const out: Array<{ type: string; data: Record<string, unknown> }> = [];
  for (const seg of content) {
    const type = typeof seg === 'string' ? 'text' : seg.type;
    const data = typeof seg === 'string' ? { text: seg } : (seg.data ?? {});
    switch (type) {
      case 'text':
        out.push({ type: 'text', data: { text: String((data as { text?: string }).text ?? '') } });
        break;
      case 'at':
        if ((data as { type?: string }).type === 'all') {
          out.push({ type: 'mention_all', data: {} });
        } else {
          const id = (data as { id?: string }).id;
          if (id) out.push({ type: 'mention', data: { user_id: Number(id) || 0 } });
        }
        break;
      case 'face':
        out.push({ type: 'face', data: { face_id: String((data as { id?: string }).id ?? ''), is_large: false } });
        break;
      case 'reply':
        // message_id 可能为 scene:peer:seq 或仅 message_seq
        const mid = (data as { message_id?: string; message_seq?: number }).message_id ?? (data as { message_seq?: number }).message_seq;
        const seq = typeof mid === 'number' ? mid : parseInt(String(mid).split(':').pop() ?? '0', 10);
        out.push({ type: 'reply', data: { message_seq: seq } });
        break;
      case 'image':
        out.push({
          type: 'image',
          data: { uri: String((data as { url?: string }).url ?? (data as { uri?: string }).uri ?? '') },
        });
        break;
      case 'record':
        out.push({
          type: 'record',
          data: { uri: String((data as { url?: string }).url ?? (data as { uri?: string }).uri ?? '') },
        });
        break;
      case 'video':
        out.push({
          type: 'video',
          data: {
            uri: String((data as { url?: string }).url ?? (data as { uri?: string }).uri ?? ''),
            thumb_uri: (data as { thumb_uri?: string }).thumb_uri,
          },
        });
        break;
      default:
        out.push({ type, data: data as Record<string, unknown> });
    }
  }
  return out;
}

/** 解析 $id 为 message_scene、peer_id、message_seq（用于撤回） */
export function parseMilkyMessageId(
  msgId: string,
): { message_scene: 'friend' | 'group' | 'temp'; peer_id: number; message_seq: number } | null {
  const parts = msgId.split(':');
  if (parts.length < 3) return null;
  const [scene, peer, seq] = parts;
  if (scene !== 'friend' && scene !== 'group' && scene !== 'temp') return null;
  const peerId = parseInt(peer, 10);
  const messageSeq = parseInt(seq, 10);
  if (Number.isNaN(peerId) || Number.isNaN(messageSeq)) return null;
  return { message_scene: scene, peer_id: peerId, message_seq: messageSeq };
}
