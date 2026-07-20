import { fetchApi, formatList, type ListItem } from '../api.js';

export default async function (args: { limit?: number }) {
  const data = await fetchApi<ListItem[]>('/douyin');
  return ['🔥 抖音热搜', '', formatList(data, args.limit || 10)].join('\n');
}
