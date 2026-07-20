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
  return stripMrkdwnMarkers(stripAngleBrackets(rewriteAngleLinks(text)));
}

/**
 * `<url|text>` → `text (url)`。
 * 线性扫描，语义等价于 `/<([^|>]+)\|([^>]+)>/g`（分组一不含 `|`，
 * 因此切分点恒为首个 `|`），但避免量词重叠在超长 `<...` 输入上的
 * 二次方回溯（js/polynomial-redos）。
 */
function rewriteAngleLinks(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open < 0) break;
    const close = text.indexOf('>', open + 1);
    if (close < 0) break;
    const inner = text.slice(open + 1, close);
    const pipe = inner.indexOf('|');
    if (pipe > 0 && pipe < inner.length - 1) {
      out += text.slice(i, open);
      out += `${inner.slice(pipe + 1)} (${inner.slice(0, pipe)})`;
      i = close + 1;
      continue;
    }
    // 非链接形态：本趟不匹配，原样保留 `<` 并继续（与原正则行为一致）。
    out += text.slice(i, open + 1);
    i = open + 1;
  }
  return out + text.slice(i);
}

/**
 * 剥掉剩余 `<...>` 的尖括号。线性扫描，等价于 `/<([^>]+)>/g`
 * （空内容 `<>` 不匹配、原样保留）。
 */
function stripAngleBrackets(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open < 0) break;
    const close = text.indexOf('>', open + 1);
    if (close < 0) break;
    if (close === open + 1) {
      out += text.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    out += text.slice(i, open);
    out += text.slice(open + 1, close);
    i = close + 1;
  }
  return out + text.slice(i);
}

/** 去掉 `*` `_` `~` `` ` `` 样式符号（等价于 `/[*_~`]/g`，逐字符线性）。 */
function stripMrkdwnMarkers(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch !== '*' && ch !== '_' && ch !== '~' && ch !== '`') out += ch;
  }
  return out;
}
