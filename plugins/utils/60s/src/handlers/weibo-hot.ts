import { fetchApi, formatList, type ListItem } from '../api.js';

export default async function (args: { limit?: number }) {
  const data = await fetchApi<ListItem[]>('/weibo');
  return ['🔥 微博热搜', '', formatList(data, args.limit || 10)].join('\n');
}
