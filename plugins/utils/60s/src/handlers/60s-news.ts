import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, locale?: Locale) {
  const data = await client.fetch('/60s', undefined, locale);
  const lines = [t(locale, 'news', { date: String(data.date || '') }), ''];
  if (data.news && Array.isArray(data.news)) {
    lines.push(...data.news.map((n: string, i: number) => `${i + 1}. ${n}`));
  }
  if (data.tip) lines.push('', `💡 ${data.tip}`);
  return lines.join('\n');
}
