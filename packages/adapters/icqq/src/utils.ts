import {
  genDmMessageId,
  genGroupMessageId,
  GroupMessageEvent,
  GuildMessageEvent,
  MessageElem,
  parseDmMessageId,
  parseGroupMessageId,
  PrivateMessageEvent,
  Sendable,
} from '@icqqjs/icqq';
import { escape, MessageBase, parseFromTemplate, unescape, valueMap } from 'zhin';
import { QQMessageEvent } from '@/types';
import { Quotable } from '@icqqjs/icqq/lib/message/elements';

export function sendableToString(message: Sendable) {
  let result = '';
  if (!Array.isArray(message)) message = [message];
  for (const item of message) {
    if (typeof item === 'string') {
      result += item;
      continue;
    }
    const { type, ...data } = item;
    if (type === 'text') {
      result += item['text'];
      continue;
    }
    const attrs = Object.entries(data).map(([key, value]) => {
      return `${key}='${escape(JSON.stringify(value))}'`;
    });
    result += `<${type} ${attrs.join(' ')}/>`;
  }
  return result;
}
export function formatSendable(message: Sendable): MessageElem[] {
  const result: MessageElem[] = [];
  if (!Array.isArray(message)) message = [message];
  for (const item of message) {
    if (typeof item !== 'string') {
      result.push(valueMap(item, unescape));
    } else {
      result.push(
        ...parseFromTemplate(item).map(ele => {
          const { type, data } = ele;
          return {
            ...data,
            type,
          } as MessageElem;
        }),
      );
    }
  }
  return result;
}
function createMessageBaseForGuild(event: GuildMessageEvent): MessageBase {
  return {
    message_id: `${event.seq}/${event.time}/${event.rand}`,
    message_type: 'guild',
    channel: `guild:${event.guild_id}:${event.channel_id}`,
    sender: {
      user_id: event.sender.tiny_id,
      user_name: event.sender.nickname,
    },
    raw_message: event.raw_message,
  };
}
function createPrivateQuote(event: PrivateMessageEvent) {
  const { time, seq, user_id, rand, message } = event.source || {};
  return {
    message_id: genDmMessageId(user_id!, seq!, rand!, time!),
    message: message as string,
  };
}
function createGroupQuote(event: GroupMessageEvent) {
  const { time, seq, user_id, rand, message } = event.source || {};
  return {
    message_id: genGroupMessageId(event.group_id!, user_id!, seq!, rand!, time!),
    message: message as string,
  };
}
export function createMessageBase(event: QQMessageEvent): MessageBase {
  if (event instanceof GuildMessageEvent) return createMessageBaseForGuild(event);
  switch (event.message_type) {
    case 'private':
      return {
        message_id: event.message_id,
        message_type: 'private',
        channel: `private:${event.sender.user_id}`,
        sender: {
          user_id: event.sender.user_id,
          user_name: event.sender.nickname,
        },
        quote: event.source ? createPrivateQuote(event) : undefined,
        raw_message: event.raw_message,
      };
    case 'group':
      return {
        message_id: event.message_id,
        message_type: 'group',
        channel: `group:${event.group_id}`,
        sender: {
          user_id: event.sender.user_id,
          user_name: event.sender.nickname,
        },
        raw_message: event.raw_message,
        quote: event.source ? createGroupQuote(event) : undefined,
      };
    default:
      return {
        message_id: event.message_id,
        message_type: 'direct',
        channel: `direct:${event.discuss_id}`,
        sender: {
          user_id: event.sender.user_id,
          user_name: event.sender.nickname,
        },
        raw_message: event.raw_message,
      };
  }
}
export function createQuote(event: MessageBase): Quotable {
  switch (event.message_type) {
    case 'private':
      return {
        ...parseDmMessageId(event.message_id!),
        message: event.raw_message,
      };
    case 'group':
      return {
        ...parseGroupMessageId(event.message_id!),
        message: event.raw_message,
      };
    default:
      throw new Error('不支持的消息类型');
  }
}
