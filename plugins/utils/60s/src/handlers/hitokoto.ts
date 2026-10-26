import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { type?: string }, locale?: Locale) {
  const params: Record<string, string> | undefined = args.type
    ? { c: args.type }
    : undefined;
  const data = await client.fetch('/hitokoto', params, locale);
  const text = data.hitokoto || data.content || (typeof data === 'string' ? data : '');
  const lines = [t(locale, 'hitokoto'), '', `「${text}」`];
  if (data.from || data.source || data.from_who || data.author) {
    const author = data.from_who || data.author || '';
    const source = data.from || data.source || '';
    lines.push(`——${author}${source ? `《${source}》` : ''}`);
  }
  return lines.join('\n');
}
