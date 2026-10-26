import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { asRecord, asString } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { text: string; to?: string }, locale?: Locale) {
  const params: Record<string, string> = { text: args.text };
  if (args.to) params.to = args.to;
  const data = await client.fetch('/fanyi', params, locale);
  const source = asRecord(data.source);
  const target = asRecord(data.target);
  const srcText = asString(source.text) || args.text;
  const srcLang = asString(source.type_desc) || asString(source.type);
  const tgtText =
    asString(target.text) ||
    asString(data.result) ||
    asString(data.translation) ||
    (typeof data === 'string' ? data : '');
  const tgtLang = asString(target.type_desc) || asString(target.type);
  const lines = [
    t(locale, 'translation'),
    '',
    t(locale, 'source', { language: srcLang ? ` (${srcLang})` : '', text: srcText }),
    t(locale, 'target', { language: tgtLang ? ` (${tgtLang})` : '', text: tgtText }),
  ];
  if (target.pronounce) lines.push(t(locale, 'pronounce', { value: asString(target.pronounce) }));
  return lines.join('\n');
}
