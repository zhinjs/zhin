import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { asArray, asRecord } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, locale?: Locale) {
  const data = await client.fetch('/gold-price', undefined, locale);
  const lines = [t(locale, 'gold'), ''];
  if (data.date) lines.push(`📅 ${data.date}`);
  const metals = asArray(data.metals);
  if (metals.length > 0) {
    lines.push('');
    metals.forEach((item) => {
      const row = asRecord(item);
      const name = row.name || t(locale, 'goldName');
      const price = row.today_price || row.sell_price || row.price || 'N/A';
      const unit = row.unit || t(locale, 'goldUnit');
      if (price !== 'N/A') lines.push(`${name}: ¥${price} ${unit}`);
    });
  } else if (data.price) {
    lines.push(t(locale, 'goldPrice', { price: String(data.price) }));
  }
  return lines.join('\n');
}
