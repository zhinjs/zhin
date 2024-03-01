import { Dict, unwrap } from 'zhin';

export interface MessageV12 {
  raw_message: string;
  user_id: number;
  message_id: string;
  nickname?: string;
  group_id: number;
  message_type: 'group' | 'private';
  message: string | (MessageV12.Segment | string)[];
}
export namespace MessageV12 {
  export type Segment = {
    type: string;
    data: Dict;
  };
  export type Ret = {
    message_id: number;
  };
  export type Sendable = string | Segment | (string | Segment)[];
  export function parseSegmentsFromTemplate(template: string): Segment[] {
    const result: Segment[] = [];
    const reg = /(<[^>]+>)/;
    while (template.length) {
      const [match] = template.match(reg) || [];
      if (!match) break;
      const index = template.indexOf(match);
      const prevText = template.slice(0, index);
      if (prevText) result.push({ type: 'text', data: { text: prevText } });
      template = template.slice(index + match.length);
      const [type, ...attrs] = match.slice(1, -1).split(',');
      const data = Object.fromEntries(
        attrs.map(attrStr => {
          const [key, ...valueArr] = attrStr.split('=');
          try {
            return [key, JSON.parse(unwrap(valueArr.join('=')))];
          } catch {
            return [key, valueArr.join('=')];
          }
        }),
      );
      result.push({ type, data });
    }
    if (template.length) result.push({ type: 'text', data: { text: template } });
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

  export function formatSegments(message: Sendable): Segment[] {
    const result: Segment[] = [];
    if (!Array.isArray(message)) message = [message];
    for (const item of message) {
      if (typeof item === 'string') result.push(...parseSegmentsFromTemplate(item));
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
        result += `<${type},${Object.entries(data)
          .map(([key, value]) => `${key}=${JSON.stringify(value).replace(/,/g, '_🤤_🤖_')}`)
          .join(',')}>`;
    }
    return result;
  }
}
