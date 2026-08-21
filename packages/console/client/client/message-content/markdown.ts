export type MarkdownInline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'strong' | 'emphasis' | 'strike' | 'code'; readonly value: string }
  | { readonly type: 'link'; readonly value: string; readonly href: string };

export type MarkdownBlock =
  | { readonly type: 'heading'; readonly level: number; readonly content: MarkdownInline[] }
  | { readonly type: 'paragraph' | 'quote'; readonly content: MarkdownInline[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: ReadonlyArray<{ readonly content: MarkdownInline[]; readonly checked?: boolean }> }
  | { readonly type: 'code'; readonly language: string; readonly value: string; readonly closed: boolean }
  | { readonly type: 'table'; readonly header: ReadonlyArray<MarkdownInline[]>; readonly rows: ReadonlyArray<ReadonlyArray<MarkdownInline[]>> }
  | { readonly type: 'rule' };

export type CodeTokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'literal';

export interface CodeToken {
  readonly kind: CodeTokenKind;
  readonly value: string;
}

const INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\))|(https?:\/\/[^\s<>()]+)/g;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function isSafeMarkdownHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (/^(https?:|mailto:)/i.test(value)) return true;
  return /^(\/|#|\.\/|\.\.\/)/.test(value);
}

export function parseMarkdownInline(value: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(value)) !== null) {
    if (match.index > cursor) tokens.push({ type: 'text', value: value.slice(cursor, match.index) });
    const raw = match[0];
    if (match[1]) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (match[2]) {
      tokens.push({ type: 'strong', value: raw.slice(2, -2) });
    } else if (match[3]) {
      tokens.push({ type: 'strike', value: raw.slice(2, -2) });
    } else if (match[4]) {
      tokens.push({ type: 'emphasis', value: raw.slice(1, -1) });
    } else if (match[5]) {
      const parsed = raw.match(/^\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/);
      if (parsed && isSafeMarkdownHref(parsed[2])) {
        tokens.push({ type: 'link', value: parsed[1], href: parsed[2] });
      } else {
        tokens.push({ type: 'text', value: raw });
      }
    } else if (match[6]) {
      tokens.push({ type: 'link', value: raw, href: raw });
    }
    cursor = INLINE_PATTERN.lastIndex;
  }

  if (cursor < value.length) tokens.push({ type: 'text', value: value.slice(cursor) });
  const merged: MarkdownInline[] = [];
  for (const token of tokens) {
    const previous = merged.at(-1);
    if (token.type === 'text' && previous?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', value: previous.value + token.value };
    } else {
      merged.push(token);
    }
  }
  return merged.length > 0 ? merged : [{ type: 'text', value }];
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? '';
  return /^(?:```|~~~|#{1,6}\s+|>\s?|\s*(?:[-+*]|\d+[.)])\s+|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(line)
    || (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] ?? ''));
}

export function parseMarkdown(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*(```|~~~)\s*([^\s`]*)?.*$/);
    if (fence) {
      const marker = fence[1];
      const language = (fence[2] ?? '').toLowerCase();
      const code: string[] = [];
      let closed = false;
      index += 1;
      while (index < lines.length) {
        if (new RegExp(`^\\s*${marker}\\s*$`).test(lines[index])) {
          closed = true;
          index += 1;
          break;
        }
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'code', language, value: code.join('\n'), closed });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: parseMarkdownInline(heading[2]) });
      index += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', content: parseMarkdownInline(quoted.join('\n')) });
      continue;
    }

    const listMatch = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items: Array<{ content: MarkdownInline[]; checked?: boolean }> = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        const task = item[2].match(/^\[([ xX])\]\s+(.+)$/);
        items.push({
          content: parseMarkdownInline(task ? task[2] : item[2]),
          ...(task ? { checked: task[1].toLowerCase() === 'x' } : {}),
        });
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
      const header = splitTableRow(line).map(parseMarkdownInline);
      const rows: MarkdownInline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]).map(parseMarkdownInline));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: parseMarkdownInline(paragraph.join('\n')) });
  }

  return blocks;
}

const KEYWORDS: Record<string, ReadonlySet<string>> = {
  javascript: new Set(['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'static', 'switch', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'yield']),
  typescript: new Set(['abstract', 'any', 'as', 'asserts', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class', 'const', 'continue', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'infer', 'instanceof', 'interface', 'keyof', 'let', 'namespace', 'never', 'new', 'number', 'object', 'of', 'readonly', 'return', 'satisfies', 'static', 'string', 'switch', 'symbol', 'throw', 'try', 'type', 'typeof', 'undefined', 'unknown', 'var', 'void', 'while', 'yield']),
  python: new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']),
  shell: new Set(['case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for', 'function', 'if', 'in', 'local', 'then', 'while']),
  css: new Set(['@import', '@media', '@supports', 'and', 'important', 'not', 'only']),
};

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', bash: 'shell', sh: 'shell', zsh: 'shell', jsonc: 'json',
};

export function highlightCodeLine(line: string, language = ''): CodeToken[] {
  const normalized = LANGUAGE_ALIASES[language] ?? language;
  const keywords = KEYWORDS[normalized] ?? KEYWORDS.javascript;
  const tokens: CodeToken[] = [];
  let index = 0;

  const push = (kind: CodeTokenKind, value: string) => {
    if (value) tokens.push({ kind, value });
  };

  while (index < line.length) {
    const rest = line.slice(index);
    const comment = normalized === 'python' || normalized === 'shell'
      ? rest.match(/^#.*/)
      : rest.match(/^\/\/.*|^\/\*.*?\*\//);
    if (comment) {
      push('comment', comment[0]);
      index += comment[0].length;
      continue;
    }
    const string = rest.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/);
    if (string) {
      push('string', string[0]);
      index += string[0].length;
      continue;
    }
    const number = rest.match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
    if (number) {
      push('number', number[0]);
      index += number[0].length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_$@][\w$-]*/);
    if (word) {
      const literal = /^(?:true|false|null|undefined|None|True|False)$/.test(word[0]);
      push(literal ? 'literal' : keywords.has(word[0]) ? 'keyword' : 'plain', word[0]);
      index += word[0].length;
      continue;
    }
    const plain = rest.match(/^[^A-Za-z_$@'"`\d/#]+/) ?? rest.match(/^./);
    push('plain', plain?.[0] ?? '');
    index += plain?.[0].length ?? 1;
  }

  return tokens;
}
