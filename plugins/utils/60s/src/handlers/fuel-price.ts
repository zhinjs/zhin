import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { asRecord, asString } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { province?: string }, locale?: Locale) {
  const params: Record<string, string> | undefined = args.province
    ? { province: args.province }
    : undefined;
  const data = await client.fetch('/fuel-price', params, locale);
  const lines = [t(locale, 'fuel'), ''];
  if (data.region) lines.push(`📍 ${data.region}`);
  if (data.items && Array.isArray(data.items)) {
    data.items.forEach((item: Record<string, unknown>) => {
      lines.push(`${item.name}: ${item.price_desc || t(locale, 'fuelPrice', { price: String(item.price) })}`);
    });
  }
  if (data.trend) {
    const trend = asRecord(data.trend);
    lines.push('', `📊 ${asString(trend.description)}`);
  }
  return lines.join('\n');
}
