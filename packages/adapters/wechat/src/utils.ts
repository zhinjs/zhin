import { Sendable, MessageElem, TextElem } from 'lib-wechat';
import { parseFromTemplate } from 'zhin';
export function sendableToString(message: Sendable) {
  let result = '';
  if (!Array.isArray(message)) message = [message as any];
  for (const item of message) {
    if (typeof item === 'string') {
      result += item;
      continue;
    }
    const { type, ...data } = item;
    if (type === 'text') {
      result += (item as TextElem)['text'];
      continue;
    }
    const attrs = Object.entries(data).map(([key, value]) => {
      return `${key}='${JSON.stringify(value)}'`;
    });
    result += `<${type} ${attrs.join(' ')}>`;
  }
  return result;
}
export function formatSendable(message: Sendable) {
  const result: MessageElem[] = [];
  if (!Array.isArray(message)) message = [message as any];
  for (const item of message) {
    if (typeof item !== 'string') {
      result.push(item);
    } else {
      result.push(
        ...parseFromTemplate(item).map(item => {
          const { type, data } = item;
          return {
            type,
            ...data,
          } as MessageElem;
        }),
      );
    }
  }
  return result as Sendable;
}
