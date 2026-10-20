/**
 * Canonical Markdown → Telegram Bot API HTML.
 *
 * Telegram's MarkdownV2 is not CommonMark-compatible and rejects unescaped
 * punctuation. HTML gives the adapter a safer dialect seam: user text is
 * escaped first and only the subset supported by Bot API is emitted as tags.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const protectedFragments: string[] = [];
  const protect = (html: string): string => {
    const token = `\uE000${protectedFragments.length}\uE001`;
    protectedFragments.push(html);
    return token;
  };

  let value = protectTelegramFencedCode(markdown, protect);
  value = value.replace(/`([^`\n]+)`/g, (_match, code) => (
    protect(`<code>${escapeTelegramHtml(String(code))}</code>`)
  ));
  value = escapeTelegramHtml(value);

  value = value
    .replace(/!\[([^\[\]]*)\]\(([^()\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '$1')
    .replace(/\[([^\[\]]+)\]\(([^()\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
      (_match, label: string, href: string) => isSafeTelegramHref(href)
        ? `<a href="${href}">${label}</a>`
        : label)
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\s*[-+*]\s+(.+)$/gm, '• $1')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<i>$2</i>');

  for (let index = 0; index < protectedFragments.length; index += 1) {
    value = value.replace(`\uE000${index}\uE001`, protectedFragments[index]!);
  }
  return value;
}

function protectTelegramFencedCode(
  markdown: string,
  protect: (html: string) => string,
): string {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const opening = markdown.indexOf('```', cursor);
    if (opening < 0) {
      chunks.push(markdown.slice(cursor));
      break;
    }
    chunks.push(markdown.slice(cursor, opening));
    const contentStart = opening + 3;
    const closing = markdown.indexOf('```', contentStart);
    if (closing < 0) {
      chunks.push(markdown.slice(opening));
      break;
    }
    const newline = markdown.indexOf('\n', contentStart);
    const hasHeader = newline >= 0 && newline < closing;
    const language = markdown.slice(contentStart, hasHeader ? newline : closing).trim();
    let code = hasHeader ? markdown.slice(newline + 1, closing) : '';
    if (code.endsWith('\n')) code = code.slice(0, -1);
    const escapedCode = escapeTelegramHtml(code);
    chunks.push(/^[A-Za-z0-9_+-]+$/.test(language)
      ? protect(`<pre><code class="language-${language}">${escapedCode}</code></pre>`)
      : protect(`<pre>${escapedCode}</pre>`));
    cursor = closing + 3;
  }
  return chunks.join('');
}

function isSafeTelegramHref(value: string): boolean {
  return /^(?:https?:\/\/|tg:\/\/|mailto:)[^\s<>]+$/iu.test(value);
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
