import { fetchApi, formatList } from '../api.js';

export default async function (args: { limit?: number }) {
  const data = await fetchApi<any[]>('/toutiao');
  return ['🔥 头条热搜', '', formatList(data, args.limit || 10)].join('\n');
}
