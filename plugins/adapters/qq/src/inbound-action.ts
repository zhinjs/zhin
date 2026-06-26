/**
 * QQ 官方互动事件 → 标准 action 段
 * @see https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html
 */
import type {
  FriendActionNoticeEvent,
  GroupActionNoticeEvent,
  GuildActionNoticeEvent,
} from 'qq-official-bot';
import { Message, type MessageSegment, type SendContent } from 'zhin.js';

export type QqActionNoticeEvent =
  | FriendActionNoticeEvent
  | GroupActionNoticeEvent
  | GuildActionNoticeEvent;

export interface FormatQqActionMessageOptions {
  endpointName: string;
  send: (content: SendContent) => Promise<string>;
}

/** `group-{openid}:{msgId}` → 平台 msg_id */
export function stripQqOutboundMessageId(storedId: string): string {
  const match = /^(?:private|group|channel|direct)-[^:]+:(.+)$/.exec(storedId);
  return match ? match[1]! : storedId;
}

function prependReply(content: SendContent, msgId: string): MessageSegment[] {
  const items = Array.isArray(content) ? [...content] : [content];
  items.unshift({ type: 'reply', data: { id: msgId } });
  return items as MessageSegment[];
}

function createQqActionReplyHandler(
  send: (content: SendContent) => Promise<string>,
) {
  return async (content: SendContent, quote: boolean | string = false): Promise<string> => {
    const outbound = typeof quote === 'string'
      ? prependReply(content, stripQqOutboundMessageId(quote))
      : content;
    return await send(outbound);
  };
}

export function formatQqActionMessage(
  event: QqActionNoticeEvent,
  options: FormatQqActionMessageOptions,
): ReturnType<typeof Message.from<QqActionNoticeEvent>> {
  const resolved = event.data?.resolved;
  const buttonId = String(resolved?.button_id ?? '');
  const buttonData = resolved?.button_data != null ? String(resolved.button_data) : '';
  const payload = buttonData || buttonId;
  const sourceMessageId = resolved?.message_id != null ? String(resolved.message_id) : undefined;

  let channelType: 'private' | 'group' | 'channel' = 'private';
  let channelId = String(event.operator_id ?? '');

  if (event.notice_type === 'group') {
    channelType = 'group';
    channelId = String(event.group_id);
  } else if (event.notice_type === 'guild') {
    channelType = 'channel';
    channelId = String(event.channel_id);
  }

  const senderId = String(event.operator_id ?? '');

  return Message.from(event, {
    $id: event.notice_id ?? event.event_id ?? `action:${Date.now()}`,
    $adapter: 'qq',
    $endpoint: options.endpointName,
    $sender: { id: senderId, name: senderId },
    $channel: { id: channelId, type: channelType },
    $content: [{
      type: 'action',
      data: {
        id: buttonId,
        payload,
        sourceMessageId,
      },
    }],
    $raw: payload,
    $timestamp: Date.now(),
    $recall: async () => {},
    $reply: createQqActionReplyHandler(options.send),
  });
}
