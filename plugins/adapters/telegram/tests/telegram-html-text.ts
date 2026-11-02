import { Parser } from 'htmlparser2';

/** Independent text-only oracle for renderer output, preserving visible whitespace. */
export function telegramHtmlText(html: string): string {
  const chunks: string[] = [];
  new Parser({ ontext: text => { chunks.push(text); } }, { decodeEntities: true }).end(html);
  return chunks.join('');
}
