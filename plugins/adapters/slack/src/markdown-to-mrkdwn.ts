/**
 * 常见 Markdown → Slack mrkdwn（Slack 粗体为 *text*，链接为 <url|text>）
 */
export const SLACK_MRKDWN_TEXT_MAX = 2900;

export function markdownToMrkdwn(text: string): string {
  let result = replaceMarkdownLinks(text);
  result = result.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  result = result.replace(/__([^_]+)__/g, '*$1*');
  result = result.replace(/~~([^~]+)~~/g, '~$1~');
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  return result;
}

function replaceMarkdownLinks(text: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const labelStart = text.indexOf('[', cursor);
    if (labelStart < 0) break;
    const labelEnd = text.indexOf(']', labelStart + 1);
    if (labelEnd < 0 || text[labelEnd + 1] !== '(') {
      out += text.slice(cursor, labelStart + 1);
      cursor = labelStart + 1;
      continue;
    }
    const urlEnd = text.indexOf(')', labelEnd + 2);
    if (urlEnd < 0) break;
    out += text.slice(cursor, labelStart);
    out += `<${text.slice(labelEnd + 2, urlEnd)}|${text.slice(labelStart + 1, labelEnd)}>`;
    cursor = urlEnd + 1;
  }
  return out + text.slice(cursor);
}

/** 按 Slack section mrkdwn 上限切分（尽量在换行/空格处断开） */
export function splitMrkdwnText(text: string, maxLen = SLACK_MRKDWN_TEXT_MAX): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks.length > 0 ? chunks : [text];
}

/** 通知栏 / 无障碍 fallback 用的纯文本 */
export function mrkdwnToPlainFallback(text: string): string {
  return text
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/[*_~`]/g, '');
}
