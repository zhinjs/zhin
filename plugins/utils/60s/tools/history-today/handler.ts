import { fetchApi } from '../api.js';

export default async function () {
  const data = await fetchApi<any>('/today-in-history');
  const dateStr = data.date || `${data.month || ''}月${data.day || ''}日`;
  const lines = [`📅 历史上的今天 (${dateStr})`, ''];
  const items = data.items || (Array.isArray(data) ? data : []);
  items.slice(0, 10).forEach((item: any, i: number) => {
    const year = item.year || '';
    const title = item.title || item.event || item.content || item;
    const typeIcon = item.event_type === 'birth' ? '👶' : item.event_type === 'death' ? '🕊️' : '📌';
    lines.push(`${typeIcon} ${i + 1}. ${year ? `[${year}] ` : ''}${title}`);
  });
  return lines.join('\n');
}
