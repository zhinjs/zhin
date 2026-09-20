import { asArray, asRecord } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient) {
  const data = await client.fetch('/today-in-history');
  const dateStr = data.date || `${data.month || ''}月${data.day || ''}日`;
  const lines = [`📅 历史上的今天 (${dateStr})`, ''];
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
