import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, locale?: Locale) {
  const data = await client.fetch('/kfc', undefined, locale);
  return `${t(locale, 'kfc')}\n\n${data.kfc || data.content || data.text || (typeof data === 'string' ? data : '')}`;
}
