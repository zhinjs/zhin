/** Canonical Markdown → Telegram Bot API HTML, with optional source positions for streaming. */
interface ProjectedText {
  readonly text: string;
  /** UTF-16 source position for every HTML code unit; -1 denotes generated markup. */
  readonly source?: readonly number[];
}

export function markdownToTelegramHtml(markdown: string): string {
  return projectMarkdown({ text: markdown }).text;
}

/** Shares exactly the complete-message codec; generated tags never consume source text. */
export function projectTelegramMarkdown(markdown: string): { readonly html: string; readonly source: readonly number[] } {
  const value = projectMarkdown({ text: markdown, source: Array.from({ length: markdown.length }, (_, index) => index) });
  return { html: value.text, source: value.source! };
}

function projectMarkdown(markdown: ProjectedText): ProjectedText {
  const fragments: ProjectedText[] = [];
  const literal = (text: string, origin = -1): ProjectedText => ({ text,
    ...(markdown.source ? { source: Array<number>(text.length).fill(origin) } : {}) });
  const protect = (value: ProjectedText): ProjectedText => {
    const token = literal(`\uE000${fragments.length}\uE001`);
    fragments.push(value);
    return token;
  };
  const wrapped = (tag: string, value: ProjectedText): ProjectedText => join([
    literal(`<${tag}>`), value, literal(`</${tag.split(' ')[0]}>`),
  ]);
  let value = fencedCode(markdown, code => protect(code), literal);
  value = replace(value, /`([^`\n]+)`/g, (_match, group) => protect(wrapped('code', escape(group(1)))));
  value = escape(value);
  value = replace(value, /!\[([^\[\]]*)\]\(([^()\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_match, group) => group(1));
  value = replace(value, /\[([^\[\]]+)\]\(([^()\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_match, group) => {
    const label = group(1), href = group(2);
    return isSafeTelegramHref(href.text) ? join([literal('<a href="'), href, literal('">'), label, literal('</a>')]) : label;
  });
  value = replace(value, /^#{1,6}\s+(.+)$/gm, (_match, group) => wrapped('b', group(1)));
  value = replace(value, /^&gt;\s?(.*)$/gm, (_match, group) => wrapped('blockquote', group(1)));
  value = replace(value, /^\s*[-+*]\s+(.+)$/gm, (_match, group) => join([
    literal('• ', group(0).source?.find(position => position >= 0)), group(1),
  ]));
  for (const [pattern, tag] of [[/\*\*([^*\n]+)\*\*/g, 'b'], [/__([^_\n]+)__/g, 'b'], [/~~([^~\n]+)~~/g, 's']] as const) {
    value = replace(value, pattern, (_match, group) => wrapped(tag, group(1)));
  }
  for (const pattern of [/(^|[^*])\*([^*\n]+)\*/g, /(^|[^_])_([^_\n]+)_/g]) {
    value = replace(value, pattern, (_match, group) => join([group(1), wrapped('i', group(2))]));
  }
  for (let index = 0; index < fragments.length; index++) {
    value = replace(value, new RegExp(`\uE000${index}\uE001`), () => fragments[index]!);
  }
  return value;
}

function slice(value: ProjectedText, start: number, end?: number): ProjectedText {
  return { text: value.text.slice(start, end), ...(value.source ? { source: value.source.slice(start, end) } : {}) };
}

function join(values: readonly ProjectedText[]): ProjectedText {
  const mapped = values.some(value => value.source);
  return { text: values.map(value => value.text).join(''),
    ...(mapped ? { source: values.flatMap(value => value.source ? [...value.source] : Array<number>(value.text.length).fill(-1)) } : {}) };
}

function replace(value: ProjectedText, pattern: RegExp,
  project: (match: RegExpExecArray, group: (index: number) => ProjectedText) => ProjectedText,
): ProjectedText {
  const matcher = new RegExp(pattern.source, `${pattern.flags}d`);
  const chunks: ProjectedText[] = [];
  let cursor = 0;
  for (let match = matcher.exec(value.text); match; match = matcher.global ? matcher.exec(value.text) : null) {
    chunks.push(slice(value, cursor, match.index));
    const matched = match;
    chunks.push(project(match, index => {
      const [start, end] = matched.indices![index]!;
      return slice(value, start, end);
    }));
    cursor = match.index + match[0].length;
    if (!matcher.global) break;
  }
  chunks.push(slice(value, cursor));
  return join(chunks);
}

function escape(value: ProjectedText): ProjectedText {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return replace(value, /[&<>"]/g, (match, group) => {
    const origin = group(0).source?.[0];
    const text = entities[match[0]]!;
    return { text, ...(origin !== undefined ? { source: Array<number>(text.length).fill(origin) } : {}) };
  });
}

function fencedCode(value: ProjectedText, protect: (value: ProjectedText) => ProjectedText,
  literal: (text: string) => ProjectedText,
): ProjectedText {
  const chunks: ProjectedText[] = [];
  let cursor = 0;
  while (cursor < value.text.length) {
    const opening = value.text.indexOf('```', cursor);
    if (opening < 0) { chunks.push(slice(value, cursor)); break; }
    chunks.push(slice(value, cursor, opening));
    const contentStart = opening + 3;
    const closing = value.text.indexOf('```', contentStart);
    if (closing < 0) { chunks.push(slice(value, opening)); break; }
    const newline = value.text.indexOf('\n', contentStart);
    const hasHeader = newline >= 0 && newline < closing;
    const language = value.text.slice(contentStart, hasHeader ? newline : closing).trim();
    let code = hasHeader ? slice(value, newline + 1, closing) : literal('');
    if (code.text.endsWith('\n')) code = slice(code, 0, -1);
    const escaped = escape(code);
    chunks.push(protect(/^[A-Za-z0-9_+-]+$/.test(language)
      ? join([literal(`<pre><code class="language-${language}">`), escaped, literal('</code></pre>')])
      : join([literal('<pre>'), escaped, literal('</pre>')])));
    cursor = closing + 3;
  }
  return join(chunks);
}

function isSafeTelegramHref(value: string): boolean {
  return /^(?:https?:\/\/|tg:\/\/|mailto:)[^\s<>]+$/iu.test(value);
}

export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
