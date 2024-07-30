import { MessageElem, Sendable } from '@icqqjs/icqq';
import { parseFromTemplate } from 'zhin';

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
      return `${key}='${JSON.stringify(value)}'`;
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
      result.push(item);
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
