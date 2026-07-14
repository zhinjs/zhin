/**
 * Slack mrkdwn → 通用 Markdown（入站文本段）
 */
export function mrkdwnToMarkdown(text: string): string {
  let result = replaceSlackLinks(text);
  result = result.replace(/\*([^*]+)\*/g, '**$1**');
  result = result.replace(/_([^_]+)_/g, '*$1*');
  result = result.replace(/~([^~]+)~/g, '~~$1~~');
  return result;
}

function replaceSlackLinks(text: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    const end = text.indexOf('>', start + 1);
    if (end < 0) break;
    out += text.slice(cursor, start);
    const body = text.slice(start + 1, end);
    const sep = body.indexOf('|');
    const url = sep >= 0 ? body.slice(0, sep) : body;
    const label = sep >= 0 ? body.slice(sep + 1) : url;
    out += url.startsWith('http://') || url.startsWith('https://') ? `[${label}](${url})` : text.slice(start, end + 1);
    cursor = end + 1;
  }
  return out + text.slice(cursor);
}
