import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { formatList, type ListItem } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { limit?: number }, locale?: Locale) {
  const data = await client.fetch<ListItem[]>('/douyin', undefined, locale);
  return [t(locale, 'douyin'), '', formatList(data, args.limit || 10)].join('\n');
}
