import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { ip?: string }, locale?: Locale) {
  const params: Record<string, string> | undefined = args.ip
    ? { ip: args.ip }
    : undefined;
  const data = await client.fetch('/ip', params, locale);
  const lines = [t(locale, 'ip'), '', `IP: ${data.ip || args.ip || t(locale, 'currentIp')}`];
  if (data.country || data.region || data.city) {
    lines.push(t(locale, 'location', { value: [data.country, data.region, data.city].filter(Boolean).join(' ') }));
  }
  if (data.location) lines.push(t(locale, 'location', { value: String(data.location) }));
  if (data.isp) lines.push(t(locale, 'isp', { value: String(data.isp) }));
  return lines.join('\n');
}
