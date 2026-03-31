import { fetchApi } from './_api.js';

export default async function (args: { ip?: string }) {
  const params: Record<string, string> | undefined = args.ip
    ? { ip: args.ip }
    : undefined;
  const data = await fetchApi<any>('/ip', params);
  const lines = ['🌐 IP 查询', '', `IP: ${data.ip || args.ip || '当前 IP'}`];
  if (data.country || data.region || data.city) {
    lines.push(`位置: ${[data.country, data.region, data.city].filter(Boolean).join(' ')}`);
  }
  if (data.location) lines.push(`位置: ${data.location}`);
  if (data.isp) lines.push(`运营商: ${data.isp}`);
  return lines.join('\n');
}
