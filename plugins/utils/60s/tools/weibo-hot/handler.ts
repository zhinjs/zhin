import { fetchApi, formatList } from '../api.js';

export default async function (args: { limit?: number }) {
  const data = await fetchApi<any[]>('/weibo');
  return ['🔥 微博热搜', '', formatList(data, args.limit || 10)].join('\n');
}
