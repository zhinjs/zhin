/**
 * Minimal line-based unified diff for config previews (#1250). Common leading and trailing
 * lines are matched first; the rest uses a longest-common-subsequence table, falling back to
 * "all removed, all added" when that table would be too large.
 */

export interface UnifiedLineDiffOptions {
  readonly from: string;
  readonly to: string;
  /** Unchanged lines shown around each change; default 3. */
  readonly context?: number;
}

type Op = { readonly kind: ' ' | '-' | '+'; readonly line: string };

/** Above this many table cells the middle part is shown as replaced instead. */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  const normalized = text.replaceAll('\r\n', '\n');
  if (normalized === '') return [];
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function diffOps(before: readonly string[], after: readonly string[]): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const ops: Op[] = before.slice(0, start).map(line => ({ kind: ' ', line }));
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
        lcs[i * width + j] = a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        ops.push({ kind: ' ', line: a[i]! });
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
  ops.push(...before.slice(endBefore).map(line => ({ kind: ' ' as const, line })));
  return ops;
}

function range(start: number, count: number): string {
  // An empty range names the line before it (GNU diff convention).
  if (count === 0) return `${start - 1},0`;
  return count === 1 ? `${start}` : `${start},${count}`;
}

/** Unified diff of two texts; an empty string when they have the same lines. */
export function unifiedLineDiff(before: string, after: string, options: UnifiedLineDiffOptions): string {
  const context = Math.max(0, options.context ?? 3);
  const ops = diffOps(splitLines(before), splitLines(after));
  const changed = ops.flatMap((op, index) => op.kind === ' ' ? [] : [index]);
  if (changed.length === 0) return '';

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

  const out = [`--- ${options.from}`, `+++ ${options.to}`];
  for (const hunk of hunks) {
    const slice = ops.slice(hunk.start, hunk.end);
    const oldCount = slice.filter(op => op.kind !== '+').length;
    const newCount = slice.filter(op => op.kind !== '-').length;
    out.push(`@@ -${range(oldLine[hunk.start]!, oldCount)} +${range(newLine[hunk.start]!, newCount)} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
  }
  return `${out.join('\n')}\n`;
}
