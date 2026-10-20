/** Safe, deliberately small Markdown subset for multipart email bodies. */
export function escapeMailHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(value: string): string {
  const tokens: string[] = [];
  const protect = (html: string) => `\uE000${tokens.push(html) - 1}\uE000`;
  let text = escapeMailHtml(value).replace(/`([^`]+)`/g, (_, code: string) => protect(`<code>${code}</code>`));
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => protect(`<a href="${url}">${label}</a>`));
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return text.replace(/\uE000(\d+)\uE000/g, (_, index: string) => tokens[Number(index)]!);
}

export function renderMailMarkdown(value: string): string {
  const output: string[] = [];
  let code: string[] | undefined;
  let list: 'ul' | 'ol' | undefined;
  const closeList = () => { if (list) output.push(`</${list}>`); list = undefined; };
  for (const line of value.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      closeList();
      if (code) { output.push(`<pre><code>${escapeMailHtml(code.join('\n'))}</code></pre>`); code = undefined; } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const bullet = /^\s*([-*+] |\d+\. )(.*)$/.exec(line);
    if (bullet) {
      const kind = /^\d/.test(bullet[1]!) ? 'ol' : 'ul';
      if (list !== kind) { closeList(); list = kind; output.push(`<${list}>`); }
      output.push(`<li>${inline(bullet[2]!)}</li>`); continue;
    }
    closeList();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) output.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
    else if (/^>\s?/.test(line)) output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (code) output.push(`<pre><code>${escapeMailHtml(code.join('\n'))}</code></pre>`);
  return output.join('\n');
}
