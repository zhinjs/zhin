import { asRecord, asString } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { text: string; to?: string }) {
  const params: Record<string, string> = { text: args.text };
  if (args.to) params.to = args.to;
  const data = await client.fetch('/fanyi', params);
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
    '🌐 翻译结果',
    '',
    `原文${srcLang ? ` (${srcLang})` : ''}: ${srcText}`,
    `译文${tgtLang ? ` (${tgtLang})` : ''}: ${tgtText}`,
  ];
  if (target.pronounce) lines.push(`发音: ${asString(target.pronounce)}`);
  return lines.join('\n');
}
