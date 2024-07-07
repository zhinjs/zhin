import { Dict, parseFromTemplate } from 'zhin';

export interface MessageV11 {
  raw_message: string;
  user_id: number;
  message_id: string;
  nickname?: string;
  group_id: number;
  message_type: 'group' | 'private';
  sender: {
    user_id: number;
    nickname: string;
  };
  message: string | (MessageV11.Segment | string)[];
}
export namespace MessageV11 {
  export type Segment = {
    type: string;
    data: Dict;
  };
  export type Ret = {
    message_id: number;
  };
  export type Sendable = string | Segment | (string | Segment)[];

  export function segmentsToCqCode(segments: Segment[]) {
    let result = '';
    for (const item of segments) {
      const { type, data } = item;
      if (type === 'text') result += data.text || '';
      else
        result += `[CQ:${type},${Object.entries(data || {})
          .map(([key, value]) => `${key}=${value}`)
          .join(',')}]`;
    }
    return result;
  }

  export function parseSegmentsFromCqCode(template: string): Segment[] {
    const result: Segment[] = [];
    const reg = /(\[CQ:[!\]]+])/;
    while (template.length) {
      const [match] = template.match(reg) || [];
      if (!match) break;
      const index = template.indexOf(match);
      const prevText = template.slice(0, index);
      if (prevText) result.push({ type: 'text', data: { text: prevText } });
      template = template.slice(index + match.length);
      const [typeWithPrefix, ...attrs] = match.slice(1, -1).split(',');
      const type = typeWithPrefix.replace('CQ:', '');
      const data = Object.fromEntries(
        attrs.map(attrStr => {
          const [key, ...valueArr] = attrStr.split('=');
          return [key, valueArr.join('=')];
        }),
      );
      result.push({
        type,
        data,
      });
    }
    if (template.length) {
      result.push({
        type: 'text',
        data: {
          text: template,
        },
      });
    }
    return result;
  }

  export function formatSegments(message: Sendable, reply_id?: number): Segment[] {
    const result: Segment[] = [];
    if (reply_id) {
      result.push({
        type: 'reply',
        data: {
          id: reply_id,
        },
      });
    }
    if (!Array.isArray(message)) message = [message];
    for (const item of message) {
      if (typeof item === 'string') result.push(...parseFromTemplate(item));
      else result.push(item);
    }
    return result;
  }

  export function formatToString(message: string | (Segment | string)[]) {
    if (typeof message === 'string') return formatToString(parseSegmentsFromCqCode(message));
    let result: string = '';
    for (let item of message) {
      if (typeof item == 'string') item = { type: 'text', data: { text: item } };
      const { type, data } = item;
      if (type === 'text') result += data.text || '';
      else
        result += `<${type} ${Object.entries(data)
          .map(([key, value]) => {
            if (key === 'qq' && type === 'at') key = 'user_id';
            return `${key}='${JSON.stringify(value)}'`;
          })
          .join(' ')}>`;
    }
    return result;
  }
}
