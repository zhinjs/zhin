import { fetchApi, formatList, type ListItem } from '../api.js';

export default async function (args: { limit?: number }) {
  const data = await fetchApi<ListItem[]>('/zhihu');
  return ['🔥 知乎热榜', '', formatList(data, args.limit || 10)].join('\n');
}
