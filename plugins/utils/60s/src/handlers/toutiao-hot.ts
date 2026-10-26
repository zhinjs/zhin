import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { formatList, type ListItem } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { limit?: number }, locale?: Locale) {
  const data = await client.fetch<ListItem[]>('/toutiao', undefined, locale);
  return [t(locale, 'toutiao'), '', formatList(data, args.limit || 10)].join('\n');
}
