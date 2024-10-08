import { Dict, escape, parseFromTemplate, unescape, valueMap } from 'zhin';

export interface Message {
  raw_message: string;
  user_id: number;
  message_id: string;
  nickname?: string;
  guild_id?: string;
  guild_name?: string;
  channel_id?: string;
  channel_name?: string;
  group_id?: number;
  permissions?: string[];
  detail_type: 'group' | 'private' | 'guild';
  message: string | (Message.Segment | string)[];
}
export namespace Message {
  export type Segment = {
    type: string;
    data: Dict;
  };
  export type Ret = null;
  export type Sendable = string | Segment | (string | Segment)[];
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
          return [key, escape(valueArr.join('='))];
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

  export function formatSegments(message: Sendable): Segment[] {
    const result: Segment[] = [];
    if (!Array.isArray(message)) message = [message];
    for (const item of message) {
      if (typeof item === 'string') result.push(...parseFromTemplate(item));
      else
        result.push({
          type: item.type,
          data: valueMap(item.data, unescape),
        });
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
            return `${key}='${escape(JSON.stringify(value))}'`;
          })
          .join(' ')}>`;
    }
    return result;
  }
}
