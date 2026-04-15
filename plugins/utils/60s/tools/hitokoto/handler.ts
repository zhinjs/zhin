import { fetchApi } from '../api.js';

export default async function (args: { type?: string }) {
  const params: Record<string, string> | undefined = args.type
    ? { c: args.type }
    : undefined;
  const data = await fetchApi<any>('/hitokoto', params);
  const text = data.hitokoto || data.content || (typeof data === 'string' ? data : '');
  const lines = ['💬 一言', '', `「${text}」`];
  if (data.from || data.source || data.from_who || data.author) {
    const author = data.from_who || data.author || '';
    const source = data.from || data.source || '';
    lines.push(`——${author}${source ? `《${source}》` : ''}`);
  }
  return lines.join('\n');
}
