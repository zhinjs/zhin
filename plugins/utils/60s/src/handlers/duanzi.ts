import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, locale?: Locale) {
  const data = await client.fetch('/duanzi', undefined, locale);
  return `${t(locale, 'duanzi')}\n\n${data.duanzi || data.content || data.text || (typeof data === 'string' ? data : '')}`;
}
