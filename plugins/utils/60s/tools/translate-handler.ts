import { fetchApi } from './_api.js';

export default async function (args: { text: string; to?: string }) {
  const params: Record<string, string> = { text: args.text };
  if (args.to) params.to = args.to;
  const data = await fetchApi<any>('/fanyi', params);
  const srcText = data.source?.text || args.text;
  const srcLang = data.source?.type_desc || data.source?.type || '';
  const tgtText =
    data.target?.text || data.result || data.translation || (typeof data === 'string' ? data : '');
  const tgtLang = data.target?.type_desc || data.target?.type || '';
  const lines = [
    '🌐 翻译结果',
    '',
    `原文${srcLang ? ` (${srcLang})` : ''}: ${srcText}`,
    `译文${tgtLang ? ` (${tgtLang})` : ''}: ${tgtText}`,
  ];
  if (data.target?.pronounce) lines.push(`发音: ${data.target.pronounce}`);
  return lines.join('\n');
}
