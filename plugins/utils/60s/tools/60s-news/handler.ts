import { fetchApi } from '../api.js';

export default async function () {
  const data = await fetchApi<any>('/60s');
  const lines = [`📰 今日60秒新闻 (${data.date || ''})`, ''];
  if (data.news && Array.isArray(data.news)) {
    lines.push(...data.news.map((n: string, i: number) => `${i + 1}. ${n}`));
  }
  if (data.tip) lines.push('', `💡 ${data.tip}`);
  return lines.join('\n');
}
