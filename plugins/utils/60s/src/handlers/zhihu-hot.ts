import { formatList, type ListItem } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { limit?: number }) {
  const data = await client.fetch<ListItem[]>('/zhihu');
  return ['🔥 知乎热榜', '', formatList(data, args.limit || 10)].join('\n');
}
