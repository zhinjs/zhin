import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { asString } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, locale?: Locale) {
  const data = await client.fetch('/bing', undefined, locale);
  const lines = [t(locale, 'bing'), ''];
  if (data.title) lines.push(`📌 ${data.title}`);
  if (data.headline) lines.push(`💡 ${data.headline}`);
  if (data.copyright) lines.push(`📝 ${data.copyright}`);
  if (data.description) lines.push('', asString(data.description));
  const imgUrl = data.cover || data.cover_4k || data.url || data.image;
  if (imgUrl) lines.push('', asString(imgUrl));
  return lines.join('\n');
}
