import { MessageElem, Sendable } from 'icqq';
import { unwrap } from 'zhin';

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
      return `${key}=${JSON.stringify(value).replace(/=/g, '_🤤_🤖_')}`;
    });
    result += `<${type},${attrs.join(',')}>`;
  }
  return result;
}
function parseFromTemplate(template: string | MessageElem): MessageElem[] {
  if (typeof template !== 'string') return [template];
  const result: MessageElem[] = [];
  const reg = /(<[^>]+>)/;
  while (template.length) {
    const [match] = template.match(reg) || [];
    if (!match) break;
    const index = template.indexOf(match);
    const prevText = template.slice(0, index);
    if (prevText)
      result.push({
        type: 'text',
        text: prevText,
      });
    template = template.slice(index + match.length);
    const [type, ...attrArr] = match.slice(1, -1).split(',');
    const attrs = Object.fromEntries(
      attrArr.map((attr: string) => {
        const [key, ...values] = attr.split('=');
        return [key, JSON.parse(unwrap(values.join('=')))];
      }),
    );
    result.push({
      type: type as MessageElem['type'],
      ...attrs,
    } as MessageElem);
  }
  if (template.length) {
    result.push({
      type: 'text',
      text: template,
    });
  }
  return result;
}
export function formatSendable(message: Sendable) {
  const result: MessageElem[] = [];
  if (!Array.isArray(message)) message = [message];
  for (const item of message) {
    if (typeof item !== 'string') {
      result.push(item);
    } else {
      result.push(...parseFromTemplate(item));
    }
  }
  return result;
}
