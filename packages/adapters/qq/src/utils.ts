import { MessageElem, Sendable } from 'qq-official-bot';
import { escape, parseFromTemplate, unescape, valueMap } from 'zhin';
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
export function splitMessageElem(message: MessageElem[]) {
  return {
    music: null,
    share: null,
    messageList: message,
  };
}
export function formatSendable(message: Sendable) {
  const result: MessageElem[] = [];
  if (!Array.isArray(message)) message = [message as any];
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
  const { music, share, messageList } = splitMessageElem(result);
  return result as Sendable;
}
