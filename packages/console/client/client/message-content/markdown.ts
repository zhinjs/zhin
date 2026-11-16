import { resolveMediaSrc } from '../mediaSrc.js';

/**
 * Inline Markdown tokens. `value` is always the plain text of the token, so a consumer that ignores
 * `children` still shows readable text. ADR 0064 G5: `children` carries nested formatting (bold
 * inside a link, a link inside emphasis, …) and `image` is an inline `![alt](src)`.
 */
export type MarkdownInline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'strong' | 'emphasis' | 'strike'; readonly value: string; readonly children?: readonly MarkdownInline[] }
  | { readonly type: 'link'; readonly value: string; readonly href: string; readonly children?: readonly MarkdownInline[] }
  | { readonly type: 'image'; readonly value: string; readonly src: string };

export interface MarkdownListItem {
  readonly content: MarkdownInline[];
  readonly checked?: boolean;
  /** ADR 0064 G5: blocks indented under the item (nested lists, continuation paragraphs). */
  readonly children?: readonly MarkdownBlock[];
}

export type MarkdownBlock =
  | { readonly type: 'heading'; readonly level: number; readonly content: MarkdownInline[] }
  | { readonly type: 'paragraph' | 'quote'; readonly content: MarkdownInline[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: ReadonlyArray<MarkdownListItem> }
  | { readonly type: 'code'; readonly language: string; readonly value: string; readonly closed: boolean }
  | { readonly type: 'table'; readonly header: ReadonlyArray<MarkdownInline[]>; readonly rows: ReadonlyArray<ReadonlyArray<MarkdownInline[]>> }
  | { readonly type: 'rule' };

export type CodeTokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'literal';

export interface CodeToken {
  readonly kind: CodeTokenKind;
  readonly value: string;
}

/** Nesting deeper than these limits is shown flat (bounded work on adversarial input). */
const MAX_INLINE_DEPTH = 6;
const MAX_LIST_DEPTH = 8;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const LIST_ITEM = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
const BARE_URL = /https?:\/\/[^\s<>()]+/y;
const LINK_TARGET = /\(([^\s()]+)(?:\s+"[^"\n]*")?\)/y;
const WORD_CHAR = /[\p{L}\p{N}]/u;

export function isSafeMarkdownHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (/^(https?:|mailto:)/i.test(value)) return true;
  return /^(\/|#|\.\/|\.\.\/)/.test(value);
}

/**
 * ADR 0064 G5: an inline image source the Console may load — http(s) / blob URLs and base64 data
 * URLs of raster image types only (no SVG, no script-capable types), the same allow-list as
 * media segments. `undefined` keeps the Markdown source as text.
 */
export function safeMarkdownImageSrc(src: string): string | undefined {
  return resolveMediaSrc(src, 'image');
}

/** Matching `]` for every `[` on the same line, computed once in linear time. */
function matchBrackets(value: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\n') stack.length = 0;
    else if (char === '[') stack.push(index);
    else if (char === ']' && stack.length > 0) pairs.set(stack.pop()!, index);
  }
  return pairs;
}

interface InlineScan {
  readonly value: string;
  readonly brackets: Map<number, number>;
  /**
   * Per delimiter, the end of the line on which a closer search already failed: every later opener
   * on that line fails too, which keeps runs of unmatched delimiters linear.
   */
  readonly unclosed: Map<string, number>;
}

function lineEnd(value: string, from: number): number {
  const newline = value.indexOf('\n', from);
  return newline < 0 ? value.length : newline;
}

/** Index after a code span starting at `index`, or `index` when it is not one. */
function skipCodeSpan(value: string, index: number, end: number): number {
  if (value[index] !== '`') return index;
  const close = value.indexOf('`', index + 1);
  return close > index && close < end ? close : index;
}

/** Closer of a `**` / `__` / `~~` run opened at `open`, skipping nested single emphasis. */
function findDoubleCloser(scan: InlineScan, open: number, delimiter: string): number {
  const { value } = scan;
  const end = lineEnd(value, open);
  if ((scan.unclosed.get(delimiter) ?? -1) === end) return -1;
  const single = delimiter[0]!;
  // A run needs content other than its own delimiter characters (`****` stays text).
  let content = false;
  for (let index = open + 2; index < end; index += 1) {
    const skipped = skipCodeSpan(value, index, end);
    if (skipped !== index) { content = true; index = skipped; continue; }
    if (value.startsWith(delimiter, index)) {
      if (!content) { index += 1; continue; }
      // `***both***`: the outer run is the double one, the inner `*…*` its emphasis.
      if (single !== '~' && value[open + 2] === single && value[index + 2] === single) return index + 1;
      return index;
    }
    if (value[index] === single && single !== '~') {
      const close = value.indexOf(single, index + 1);
      if (close > index + 1 && close < end && value[close + 1] !== single) { content = true; index = close; continue; }
    }
    if (value[index] !== single) content = true;
  }
  scan.unclosed.set(delimiter, end);
  return -1;
}

/** Closer of a single `*` / `_` emphasis opened at `open`, skipping nested `**` / `__` runs. */
function findSingleCloser(scan: InlineScan, open: number, delimiter: string): number {
  const { value } = scan;
  const end = lineEnd(value, open);
  if ((scan.unclosed.get(delimiter) ?? -1) === end) return -1;
  const double = delimiter + delimiter;
  let content = false;
  for (let index = open + 1; index < end; index += 1) {
    const skipped = skipCodeSpan(value, index, end);
    if (skipped !== index) { content = true; index = skipped; continue; }
    if (value.startsWith(double, index)) {
      const close = value.indexOf(double, index + 2);
      if (close > index + 2 && close < end) {
        // `*a **b***`: the `***` closes the inner run and this one together.
        if (value[close + 2] === delimiter && close + 2 < end) return close + 2;
        content = true;
        index = close + 1;
        continue;
      }
      if (content && value[index - 1] !== ' ') return index;
      index += 1;
      continue;
    }
    if (value[index] === delimiter) {
      if (!content || value[index - 1] === ' ') continue;
      if (delimiter === '_' && WORD_CHAR.test(value[index + 1] ?? '')) continue;
      return index;
    }
    content = true;
  }
  scan.unclosed.set(delimiter, end);
  return -1;
}

function plainText(tokens: readonly MarkdownInline[]): string {
  return tokens.map((token) => token.value).join('');
}

function formatted(type: 'strong' | 'emphasis' | 'strike', inner: string, depth: number): MarkdownInline {
  const children = parseInline(inner, depth + 1);
  return children.length === 1 && children[0]!.type === 'text'
    ? { type, value: inner }
    : { type, value: plainText(children), children };
}

/**
 * Hand-written single-pass inline scanner (no backtracking regular expressions over user text):
 * code spans, images, links with formatted labels, `**` / `__` / `~~` / `*` / `_` with nesting,
 * and bare http(s) URLs. Unsafe link targets and image sources stay literal text.
 */
function parseInline(value: string, depth: number): MarkdownInline[] {
  if (depth > MAX_INLINE_DEPTH) return value ? [{ type: 'text', value }] : [];
  const scan: InlineScan = { value, brackets: matchBrackets(value), unclosed: new Map() };
  const tokens: MarkdownInline[] = [];
  let text = '';
  const push = (token: MarkdownInline) => {
    if (text) { tokens.push({ type: 'text', value: text }); text = ''; }
    tokens.push(token);
  };
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    if (char === '`') {
      const close = value.indexOf('`', index + 1);
      if (close > index + 1 && close < lineEnd(value, index)) {
        push({ type: 'code', value: value.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }
    if (char === '[' || (char === '!' && value[index + 1] === '[')) {
      const open = char === '!' ? index + 1 : index;
      const close = scan.brackets.get(open);
      if (close !== undefined && value[close + 1] === '(') {
        LINK_TARGET.lastIndex = close + 1;
        const target = LINK_TARGET.exec(value);
        if (target) {
          const label = value.slice(open + 1, close);
          const end = LINK_TARGET.lastIndex;
          if (char === '!') {
            const src = safeMarkdownImageSrc(target[1]!);
            if (src) {
              push({ type: 'image', value: label, src });
              index = end;
              continue;
            }
          } else if (label && isSafeMarkdownHref(target[1]!)) {
            const children = parseInline(label, depth + 1);
            push(children.length === 1 && children[0]!.type === 'text'
              ? { type: 'link', value: label, href: target[1]! }
              : { type: 'link', value: plainText(children), href: target[1]!, children });
            index = end;
            continue;
          }
          // Unsafe target: the whole construct stays text, never an active link or image.
          text += value.slice(index, end);
          index = end;
          continue;
        }
      }
    }
    if ((char === '*' || char === '_' || char === '~') && value[index + 1] === char) {
      const intraword = char === '_' && WORD_CHAR.test(value[index - 1] ?? '');
      const close = intraword ? -1 : findDoubleCloser(scan, index, char + char);
      if (close > index) {
        push(formatted(char === '~' ? 'strike' : 'strong', value.slice(index + 2, close), depth));
        index = close + 2;
        continue;
      }
      text += char + char;
      index += 2;
      continue;
    }
    if ((char === '*' || char === '_') && value[index + 1] !== undefined && value[index + 1] !== ' '
      && !(char === '_' && WORD_CHAR.test(value[index - 1] ?? ''))) {
      const close = findSingleCloser(scan, index, char);
      if (close > index) {
        push(formatted('emphasis', value.slice(index + 1, close), depth));
        index = close + 1;
        continue;
      }
    }
    if (char === 'h' && (value.startsWith('http://', index) || value.startsWith('https://', index))
      && !WORD_CHAR.test(value[index - 1] ?? '')) {
      BARE_URL.lastIndex = index;
      const url = BARE_URL.exec(value);
      if (url) {
        push({ type: 'link', value: url[0], href: url[0] });
        index = BARE_URL.lastIndex;
        continue;
      }
    }
    text += char;
    index += 1;
  }
  if (text) tokens.push({ type: 'text', value: text });
  return tokens;
}

export function parseMarkdownInline(value: string): MarkdownInline[] {
  const tokens = parseInline(value, 0);
  return tokens.length > 0 ? tokens : [{ type: 'text', value }];
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

function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4;
    else break;
  }
  return width;
}

/** Removes `width` columns of leading indentation (tabs count as 4). */
function dedent(line: string, width: number): string {
  let removed = 0;
  let index = 0;
  while (index < line.length && removed < width) {
    const char = line[index];
    if (char === ' ') removed += 1;
    else if (char === '\t') removed += 4;
    else break;
    index += 1;
  }
  return line.slice(index);
}

/**
 * ADR 0064 G5: a list starting at `start`. Items share the first item's indentation; lines indented
 * at least two columns deeper belong to the previous item and are parsed as its child blocks.
 */
function parseList(lines: readonly string[], start: number, depth: number): { block: MarkdownBlock; next: number } {
  const first = lines[start]!.match(LIST_ITEM)!;
  const base = indentWidth(first[1]!);
  const ordered = /^\d/.test(first[2]!);
  const items: MarkdownListItem[] = [];
  let index = start;
  while (index < lines.length) {
    const item = lines[index]!.match(LIST_ITEM);
    if (!item) break;
    const indent = indentWidth(item[1]!);
    if (indent < base || indent >= base + 2 || /^\d/.test(item[2]!) !== ordered) break;
    index += 1;
    const childLines: string[] = [];
    if (depth < MAX_LIST_DEPTH) {
      while (index < lines.length && lines[index]!.trim() && indentWidth(lines[index]!) >= base + 2) {
        childLines.push(lines[index]!);
        index += 1;
      }
    }
    const task = item[3]!.match(/^\[([ xX])\]\s+(.+)$/);
    const childIndent = Math.min(...childLines.map(indentWidth));
    const children = childLines.length > 0
      ? parseBlocks(childLines.map((line) => dedent(line, childIndent)), depth + 1)
      : [];
    items.push({
      content: parseMarkdownInline(task ? task[2]! : item[3]!),
      ...(task ? { checked: task[1]!.toLowerCase() === 'x' } : {}),
      ...(children.length > 0 ? { children } : {}),
    });
  }
  return { block: { type: 'list', ordered, items }, next: index };
}

function parseBlocks(lines: readonly string[], depth: number): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*(```|~~~)\s*([^\s`]*)?.*$/);
    if (fence) {
      const marker = fence[1]!;
      const language = (fence[2] ?? '').toLowerCase();
      const code: string[] = [];
      let closed = false;
      index += 1;
      while (index < lines.length) {
        if (lines[index]!.trim() === marker) {
          closed = true;
          index += 1;
          break;
        }
        code.push(lines[index]!);
        index += 1;
      }
      blocks.push({ type: 'code', language, value: code.join('\n'), closed });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, content: parseMarkdownInline(heading[2]!) });
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
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', content: parseMarkdownInline(quoted.join('\n')) });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, index, depth);
      blocks.push(block);
      index = next;
      continue;
    }

    if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
      const header = splitTableRow(line).map(parseMarkdownInline);
      const rows: MarkdownInline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        rows.push(splitTableRow(lines[index]!).map(parseMarkdownInline));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim() && !startsBlock(lines, index)) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: parseMarkdownInline(paragraph.join('\n')) });
  }

  return blocks;
}

export function parseMarkdown(value: string): MarkdownBlock[] {
  return parseBlocks(value.replace(/\r\n?/g, '\n').split('\n'), 0);
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
