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

  let value = markdown.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, rawLanguage, code) => {
    const language = String(rawLanguage).trim();
    const escapedCode = escapeTelegramHtml(String(code).replace(/\n$/, ''));
    if (/^[A-Za-z0-9_+-]+$/.test(language)) {
      return protect(`<pre><code class="language-${language}">${escapedCode}</code></pre>`);
    }
    return protect(`<pre>${escapedCode}</pre>`);
  });
  value = value.replace(/`([^`\n]+)`/g, (_match, code) => (
    protect(`<code>${escapeTelegramHtml(String(code))}</code>`)
  ));
  value = escapeTelegramHtml(value);

  value = value
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<a href="$2">$1</a>')
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

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
