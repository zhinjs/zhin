/**
 * Minimal line-based unified diff for config previews (#1250). Common leading and trailing
 * lines are matched first; the rest uses a longest-common-subsequence table, falling back to
 * "all removed, all added" when that table would be too large.
 *
 * End of line: a missing newline at the end of either text is shown as GNU diff does
 * (`\ No newline at end of file` after that line). A line whose only change is its ending (CRLF ↔
 * LF) is shown as removed and added with ` (CRLF)` / ` (LF)` after it, since the two would
 * otherwise print the same; when every line changes its ending, one note line after the file
 * header says so instead of listing the whole file.
 */

export interface UnifiedLineDiffOptions {
  readonly from: string;
  readonly to: string;
  /** Unchanged lines shown around each change; default 3. */
  readonly context?: number;
}

interface Line {
  /** Text without its line ending. */
  readonly text: string;
  /** `\r\n`, `\n`, or `''` for a last line without newline. */
  readonly eol: string;
}

type Op = { readonly kind: ' ' | '-' | '+'; readonly line: Line };

/** Above this many table cells the middle part is shown as replaced instead. */
const MAX_LCS_CELLS = 4_000_000;
const NO_NEWLINE = '\\ No newline at end of file';

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    if (newline < 0) {
      lines.push({ text: text.slice(start), eol: '' });
      break;
    }
    const crlf = newline > start && text[newline - 1] === '\r';
    lines.push({ text: text.slice(start, crlf ? newline - 1 : newline), eol: crlf ? '\r\n' : '\n' });
    start = newline + 1;
  }
  return lines;
}

/** One style for the whole text, or undefined when it mixes styles / has no line ending. */
function eolStyle(lines: readonly Line[]): string | undefined {
  const styles = new Set(lines.map(line => line.eol).filter(eol => eol !== ''));
  return styles.size === 1 ? [...styles][0] : undefined;
}

function diffOps(before: readonly Line[], after: readonly Line[], same: (a: Line, b: Line) => boolean): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && same(before[start]!, after[start]!)) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && same(before[endBefore - 1]!, after[endAfter - 1]!)) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const ops: Op[] = after.slice(0, start).map(line => ({ kind: ' ', line }));
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if ((a.length + 1) * (b.length + 1) > MAX_LCS_CELLS) {
    ops.push(...a.map(line => ({ kind: '-' as const, line })), ...b.map(line => ({ kind: '+' as const, line })));
  } else {
    // lcs[i][j]: LCS length of a[i..] and b[j..].
    const width = b.length + 1;
    const lcs = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lcs[i * width + j] = same(a[i]!, b[j]!)
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && same(a[i]!, b[j]!)) {
        ops.push({ kind: ' ', line: b[j]! });
        i += 1;
        j += 1;
      } else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
        ops.push({ kind: '-', line: a[i]! });
        i += 1;
      } else {
        ops.push({ kind: '+', line: b[j]! });
        j += 1;
      }
    }
  }
  ops.push(...after.slice(endAfter).map(line => ({ kind: ' ' as const, line })));
  return ops;
}

function range(start: number, count: number): string {
  // An empty range names the line before it (GNU diff convention).
  if (count === 0) return `${start - 1},0`;
  return count === 1 ? `${start}` : `${start},${count}`;
}

const EOL_NAMES: Readonly<Record<string, string>> = { '\r\n': 'CRLF', '\n': 'LF' };

/** Unified diff of two texts; an empty string when they are the same. */
export function unifiedLineDiff(before: string, after: string, options: UnifiedLineDiffOptions): string {
  if (before === after) return '';
  const context = Math.max(0, options.context ?? 3);
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const oldStyle = eolStyle(oldLines);
  const newStyle = eolStyle(newLines);
  // The whole file changes its line ending: say it once, and compare the lines without it.
  const fileEolChange = oldStyle !== undefined && newStyle !== undefined && oldStyle !== newStyle;
  // A missing final newline always counts, so `\ No newline at end of file` shows up.
  const ending = (line: Line) => line.eol === '' ? '' : fileEolChange ? '\n' : line.eol;
  const ops = diffOps(oldLines, newLines, (a, b) => a.text === b.text && ending(a) === ending(b));

  const out = [`--- ${options.from}`, `+++ ${options.to}`];
  if (fileEolChange) out.push(`# line endings: ${EOL_NAMES[oldStyle!]} -> ${EOL_NAMES[newStyle!]}`);
  const changed = ops.flatMap((op, index) => op.kind === ' ' ? [] : [index]);
  if (changed.length === 0) return fileEolChange ? `${out.join('\n')}\n` : '';

  // Group changes whose context windows touch into one hunk.
  const hunks: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length, index + context + 1);
    const last = hunks.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }

  // Line numbers (1-based) of each op position in the old and new text.
  const oldLine: number[] = [];
  const newLine: number[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  for (const op of ops) {
    oldLine.push(oldCursor);
    newLine.push(newCursor);
    if (op.kind !== '+') oldCursor += 1;
    if (op.kind !== '-') newCursor += 1;
  }

  // A changed line whose text is identical on both sides differs in its ending only: name it.
  const eolOnly = new Set<number>();
  for (let index = 0; index + 1 < ops.length; index += 1) {
    const [a, b] = [ops[index]!, ops[index + 1]!];
    if (a.kind === '-' && b.kind === '+' && a.line.text === b.line.text && a.line.eol !== '' && b.line.eol !== '') {
      eolOnly.add(index).add(index + 1);
    }
  }

  for (const hunk of hunks) {
    const slice = ops.slice(hunk.start, hunk.end);
    const oldCount = slice.filter(op => op.kind !== '+').length;
    const newCount = slice.filter(op => op.kind !== '-').length;
    out.push(`@@ -${range(oldLine[hunk.start]!, oldCount)} +${range(newLine[hunk.start]!, newCount)} @@`);
    slice.forEach((op, offset) => {
      const index = hunk.start + offset;
      out.push(`${op.kind}${op.line.text}${eolOnly.has(index) ? ` (${EOL_NAMES[op.line.eol]})` : ''}`);
      if (op.line.eol === '') out.push(NO_NEWLINE);
    });
  }
  return `${out.join('\n')}\n`;
}
