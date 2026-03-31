import { fetchApi } from '../api.js';

export default async function (args: { province?: string }) {
  const params: Record<string, string> | undefined = args.province
    ? { province: args.province }
    : undefined;
  const data = await fetchApi<any>('/fuel-price', params);
  const lines = ['⛽ 今日油价', ''];
  if (data.region) lines.push(`📍 ${data.region}`);
  if (data.items && Array.isArray(data.items)) {
    data.items.forEach((item: any) => {
      lines.push(`${item.name}: ${item.price_desc || `¥${item.price}/升`}`);
    });
  }
  if (data.trend) {
    lines.push('', `📊 ${data.trend.description || ''}`);
  }
  return lines.join('\n');
}
