import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { asArray, asRecord } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, locale?: Locale) {
  const data = await client.fetch('/today-in-history', undefined, locale);
  const dateStr = data.date || t(locale, 'monthDay', { month: String(data.month || ''), day: String(data.day || '') });
  const lines = [t(locale, 'history', { date: String(dateStr) }), ''];
  const items = asArray(data.items);
  items.slice(0, 10).forEach((item, i: number) => {
    const row = asRecord(item);
    const year = row.year || '';
    const title = row.title || row.event || row.content || item;
    const typeIcon = row.event_type === 'birth' ? '👶' : row.event_type === 'death' ? '🕊️' : '📌';
    lines.push(`${typeIcon} ${i + 1}. ${year ? `[${year}] ` : ''}${title}`);
  });
  return lines.join('\n');
}
