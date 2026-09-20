import { formatList, type ListItem } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { limit?: number }) {
  const data = await client.fetch<ListItem[]>('/weibo');
  return ['🔥 微博热搜', '', formatList(data, args.limit || 10)].join('\n');
}
