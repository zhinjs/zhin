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
      if (price !== 'N/A') lines.push(`${name}: ${currencySymbol(String(unit))}${price} ${unit}`);
    });
  } else if (data.price) {
    lines.push(t(locale, 'goldPrice', { price: String(data.price) }));
  }
  return lines.join('\n');
}

/**
 * The symbol matching the unit the API returns (#1250 60s-gold-currency-mixed): `$` for US
 * dollars, `¥` for yuan, none for anything else (the unit already names the currency).
 */
export function currencySymbol(unit: string): string {
  if (/美元|USD|US\$/iu.test(unit)) return '$';
  if (/港元|港币|HKD|日元|JPY|欧元|EUR|英镑|GBP/iu.test(unit)) return '';
  if (/元|CNY|RMB|人民币/iu.test(unit)) return '¥';
  return '';
}
