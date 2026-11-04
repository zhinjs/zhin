/**
 * 受控自我进化：审批详情里的逐文件 diff（ADR 0040 §2 / §8a F3，#1142）。
 *
 * - Console 详情（`plugin.root.self-change-detail`，仅 `ops:approve`）：每个文件一段 unified diff，
 *   基线是回滚快照（已开始生效时）或生产目录现有文件；全部 diff 总字节 ≤ {@link MAX_CHANGE_PREVIEW_BYTES}，
 *   超出按行截断并标 `truncated`。diff 正文行与 IM 摘录同口径脱敏（{@link redactSecretAssignments}）。
 * - IM 审批卡：从同一份 diff 取有界摘录（≤ {@link MAX_IM_DIFF_EXCERPT_LINES} 行且 ≤ {@link MAX_IM_DIFF_EXCERPT_BYTES}
 *   字节），写进卡片参数，启动 `restore()` 重建卡片时同样可得。摘录会发到审批私聊 / 审批群：键名按审计密钥口径
 *   命中的 `key = value` / `key: value` 赋值把值换成 `[redacted]`（入队时再经 `redactDecisionPayload` 打码令牌形状）。
 * - 不引入第三方 diff 依赖：去掉公共首尾后对中段做 LCS；中段过大时退化为整段删除 + 整段新增（仍是正确的 diff）。
 * - 只读：不写生产目录，现有文件读取沿用预览的大小上限且不跟随符号链接；暂存区已瘦身时不编造正文。
 */
import * as path from 'node:path';
import { isSecretLikeKey } from '../decision-events.js';
import { MAX_CHANGE_PREVIEW_BYTES, readCurrentFile, type SelfChangeFileDiff } from './preview.js';
import type { SelfChangeRecord, SelfChangeSnapshot, SelfChangeStore } from './store.js';

/** IM 卡片 diff 摘录的行数上限。 */
export const MAX_IM_DIFF_EXCERPT_LINES = 40;
/** IM 卡片 diff 摘录的字节上限（UTF-8）。 */
export const MAX_IM_DIFF_EXCERPT_BYTES = 2 * 1024;
/** IM 摘录里单行最多保留的字符数。 */
const MAX_EXCERPT_LINE_CHARS = 200;
/** 每个改动块前后保留的上下文行数。 */
const DIFF_CONTEXT_LINES = 3;
/** LCS 表格上限（中段行数乘积）；超过即退化为整段替换。 */
const MAX_LCS_CELLS = 4_000_000;
/** IM 卡片最多列出的 skipped 检查数（Console 详情不设上限）。 */
export const MAX_CARD_SKIPPED_CHECKS = 20;
/** 内容只差行尾（CRLF / LF）或文件末尾换行时的提示行。 */
const LINE_ENDING_ONLY_MARKER = '\\ line endings or the trailing newline changed';
const EMPTY_FILE_CREATED_MARKER = '\\ empty file created';
const EMPTY_FILE_DELETED_MARKER = '\\ empty file deleted';
/** 已开始生效的状态：此时回滚快照必然已写入，读不到就不能拿（可能已改动的）磁盘当基线。 */
const SNAPSHOT_REQUIRED_STATUSES: ReadonlySet<string> = new Set(['applying', 'verifying', 'failed']);
/** 往回找键名时最多看的字符数（键名再长也不展开，保证线性）。 */
const MAX_SECRET_KEY_CHARS = 64;
const QUOTES: ReadonlySet<string> = new Set(['"', "'", '`']);
const KEY_CHAR = /[\w$.-]/u;
const KEY_START = /[A-Za-z_$]/u;
/** 不带引号的值到这些字符为止（空白不算：`password: my secret` 整段都是值）。 */
const VALUE_STOP: ReadonlySet<string> = new Set([',', ';', ')', ']', '}']);

export type SelfChangeDiffBaseline = 'disk' | 'snapshot';

export type SelfChangeFileDiffUnavailableReason =
  /** 变更已瘦身，暂存正文已删除。 */
  | 'slimmed'
  /** 暂存正文读不到。 */
  | 'staged_unreadable'
  /** 基线文件超过大小上限、是符号链接或不可读；或回滚快照存在但读不出来。 */
  | 'baseline_unreadable'
  /** 总预算已用完，本文件未展示。 */
  | 'budget_exhausted';

export interface SelfChangeFileDetailDiff {
  readonly path: string;
  readonly kind: 'create' | 'modify' | 'delete';
  /** unified diff 文本；空串表示与基线相同；`null` 表示不可得（见 `unavailableReason`）。 */
  readonly diff: string | null;
  /** diff 被预算截断或不可得。 */
  readonly truncated: boolean;
  readonly unavailableReason: SelfChangeFileDiffUnavailableReason | null;
}

export interface SelfChangeDetailDiff {
  /** 暂存正文是否仍在（瘦身后为 false，此时所有 `diff` 为 null）。 */
  readonly bodiesAvailable: boolean;
  /** diff 的「改动前」取自哪里。 */
  readonly baseline: SelfChangeDiffBaseline;
  readonly files: readonly SelfChangeFileDetailDiff[];
  /** 全部 diff 文本的 UTF-8 字节数。 */
  readonly bytes: number;
  /** 任一文件被截断或不可得。 */
  readonly truncated: boolean;
}

export interface BuildSelfChangeDetailDiffInput {
  readonly store: Pick<SelfChangeStore, 'readStagedFile' | 'readSnapshot'>;
  readonly record: SelfChangeRecord;
  readonly projectRoot: string;
  /** 全部 diff 的总字节预算；默认 {@link MAX_CHANGE_PREVIEW_BYTES}。 */
  readonly maxBytes?: number;
}

export interface SelfChangeDiffExcerpt {
  readonly lines: readonly string[];
  /** 摘录没有覆盖全部改动（超出上限、某文件被截断或不可得）。 */
  readonly truncated: boolean;
}

export interface SelfChangeDiffExcerptLimits {
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

/** 为一个变更的每个文件生成 unified diff（总字节有界）。 */
export async function buildSelfChangeDetailDiff(input: BuildSelfChangeDetailDiffInput): Promise<SelfChangeDetailDiff> {
  const record = input.record;
  const maxBytes = input.maxBytes ?? MAX_CHANGE_PREVIEW_BYTES;
  if (record.slimmed) {
    const previewKinds = previewFileKinds(record.plan);
    return Object.freeze({
      bodiesAvailable: false,
      baseline: 'disk',
      files: Object.freeze(record.files.map(entry => unavailableFile(entry.path, kindFromPreview(entry.path, entry.op, previewKinds), 'slimmed'))),
      bytes: 0,
      truncated: record.files.length > 0,
    });
  }
  const projectRoot = path.resolve(input.projectRoot);
  let snapshot: SelfChangeSnapshot | null;
  try {
    snapshot = await input.store.readSnapshot(record.id);
  } catch {
    return unreadableSnapshotDiff(record);
  }
  // `readSnapshot` also returns null for a corrupt manifest. Once applying started a snapshot was written before
  // any production file changed, so a missing one means unreadable: fail closed rather than diff the disk.
  if (!snapshot && SNAPSHOT_REQUIRED_STATUSES.has(record.status)) return unreadableSnapshotDiff(record);
  const baseline: SelfChangeDiffBaseline = snapshot ? 'snapshot' : 'disk';
  const snapshotContents = new Map(snapshot?.files.map(file => [file.path, file.content]) ?? []);
  const files: SelfChangeFileDetailDiff[] = [];
  let remaining = maxBytes;
  let totalBytes = 0;
  for (const entry of record.files) {
    const before = snapshot
      ? baselineFromSnapshot(snapshotContents, entry.path)
      : await baselineFromDisk(projectRoot, entry.path);
    const kind = entry.op === 'delete' ? 'delete' : before.exists ? 'modify' : 'create';
    if (before.exists && before.content === null) {
      files.push(unavailableFile(entry.path, kind, 'baseline_unreadable'));
      continue;
    }
    let after: string | null = null;
    if (entry.op === 'write') {
      after = await input.store.readStagedFile(record.id, entry.path);
      if (after === null) {
        files.push(unavailableFile(entry.path, kind, 'staged_unreadable'));
        continue;
      }
    }
    if (remaining <= 0) {
      files.push(unavailableFile(entry.path, kind, 'budget_exhausted'));
      continue;
    }
    // Same secret-assignment masking as the IM excerpt: the Console detail must not be the unredacted copy.
    const fullDiff = redactDiffBody(unifiedDiff(entry.path, before.exists ? before.content : null, after));
    const clipped = clipToBytes(fullDiff, remaining);
    if (clipped.truncated && clipped.text === '') {
      remaining = 0;
      files.push(unavailableFile(entry.path, kind, 'budget_exhausted'));
      continue;
    }
    const clippedBytes = utf8Bytes(clipped.text);
    // A cut file uses up the budget: later files are listed as not shown rather than partially shown.
    remaining = clipped.truncated ? 0 : remaining - clippedBytes;
    totalBytes += clippedBytes;
    files.push(Object.freeze({
      path: entry.path,
      kind,
      diff: clipped.text,
      truncated: clipped.truncated,
      unavailableReason: null,
    }));
  }
  return Object.freeze({
    bodiesAvailable: true,
    baseline,
    files: Object.freeze(files),
    bytes: totalBytes,
    truncated: files.some(file => file.truncated),
  });
}

/**
 * unified diff：`before === null` 表示新建，`after === null` 表示删除。内容相同返回空串。
 * 行尾按 `\n` / `\r\n` 切分，不输出 "No newline at end of file" 标记。
 */
export function unifiedDiff(target: string, before: string | null, after: string | null): string {
  const oldLines = splitLines(before ?? '');
  const newLines = splitLines(after ?? '');
  const operations = diffLines(oldLines, newLines);
  const hunks = formatHunks(operations);
  const header = [
    before === null ? '--- /dev/null' : `--- a/${target}`,
    after === null ? '+++ /dev/null' : `+++ b/${target}`,
  ];
  if (hunks.length > 0) return [...header, ...hunks].join('\n');
  if (before === after) return '';
  // No line differs but the file still changes: an empty file created / deleted, or only the line endings /
  // trailing newline differ. Still a change the approver must see.
  if (before === null) return [...header, EMPTY_FILE_CREATED_MARKER].join('\n');
  if (after === null) return [...header, EMPTY_FILE_DELETED_MARKER].join('\n');
  return [...header, LINE_ENDING_ONLY_MARKER].join('\n');
}

/**
 * 从详情 diff 取 IM 卡片摘录：每个文件以 `# <kind> <path>` 开头，随后是改动块（不含 `---` / `+++` 文件头）。
 * 键名像密钥的赋值把值换成 `[redacted]`。
 */
export function selfChangeDiffExcerpt(detail: SelfChangeDetailDiff, limits: SelfChangeDiffExcerptLimits = {}): SelfChangeDiffExcerpt {
  const maxLines = limits.maxLines ?? MAX_IM_DIFF_EXCERPT_LINES;
  const maxBytes = limits.maxBytes ?? MAX_IM_DIFF_EXCERPT_BYTES;
  const lines: string[] = [];
  let bytes = 0;
  let truncated = detail.truncated;
  const push = (raw: string): boolean => {
    // Clip before redacting so a huge (minified) line costs nothing extra; an unterminated quoted value is
    // still redacted up to the end of the clipped line.
    const line = redactSecretAssignments(clipLine(raw));
    const clipped = clipLine(line);
    const lineBytes = utf8Bytes(clipped) + (lines.length > 0 ? 1 : 0);
    if (lines.length >= maxLines || bytes + lineBytes > maxBytes) return false;
    lines.push(clipped);
    bytes += lineBytes;
    return true;
  };
  outer: for (const file of detail.files) {
    if (!push(`# ${file.kind} ${file.path}`)) {
      truncated = true;
      break;
    }
    if (file.diff === null) {
      if (!push(`  （${unavailableLabel(file.unavailableReason)}）`)) {
        truncated = true;
        break;
      }
      continue;
    }
    if (file.diff === '') {
      if (!push('  （与改动前相同）')) {
        truncated = true;
        break;
      }
      continue;
    }
    // Every non-empty diff starts with exactly two file header lines; everything after them is content.
    for (const line of file.diff.split('\n').slice(2)) {
      if (!push(line)) {
        truncated = true;
        break outer;
      }
    }
  }
  return Object.freeze({ lines: Object.freeze(lines), truncated });
}

/** 试跑结果里 `skipped` 的检查：`<check> <path>`，去重；`limit` 缺省不设上限。 */
export function skippedTrialChecks(trial: unknown, limit: number = Number.POSITIVE_INFINITY): readonly string[] {
  const checks = (trial as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(checks)) return Object.freeze([]);
  const names = new Set<string>();
  for (const check of checks as readonly { check?: unknown; path?: unknown; status?: unknown }[]) {
    if (check?.status !== 'skipped') continue;
    const name = typeof check.check === 'string' && check.check ? check.check : 'unknown';
    const target = typeof check.path === 'string' && check.path ? ` ${check.path}` : '';
    names.add(`${name}${target}`);
  }
  return Object.freeze([...names].slice(0, limit));
}

/** 把键名像密钥的 `key = value` / `key: value` 赋值的值换成 `[redacted]`（审计密钥键表 + 常见后缀）。 */
export function redactSecretAssignments(line: string): string {
  // Hand-written scan (no backtracking regex): one pass over the separators, bounded look-back for the key.
  let output = '';
  let copied = 0;
  for (let index = 0; index < line.length; index += 1) {
    const separator = line[index];
    if (separator !== ':' && separator !== '=') continue;
    const key = readKeyBefore(line, index);
    if (!key || !isSecretAssignmentKey(key)) continue;
    const valueStart = skipBlanks(line, index + 1);
    const valueEnd = readValueEnd(line, valueStart);
    if (valueEnd <= valueStart) continue;
    const value = line.slice(valueStart, valueEnd);
    if (!value.includes('[redacted]')) {
      const quote = QUOTES.has(value[0]!) ? value[0]! : '';
      const closing = quote && value.length > 1 && value.endsWith(quote) ? quote : '';
      output += `${line.slice(copied, valueStart)}${quote}[redacted]${closing}`;
      copied = valueEnd;
    }
    index = valueEnd - 1;
  }
  return output + line.slice(copied);
}

// ── 内部 ─────────────────────────────────────────────────────────────────────

interface Baseline {
  readonly exists: boolean;
  /** 存在但读不到（过大 / 符号链接 / 不可读）时为 null。 */
  readonly content: string | null;
}

type DiffOperation = Readonly<{ kind: ' ' | '-' | '+'; text: string }>;

function unavailableFile(
  target: string,
  kind: SelfChangeFileDetailDiff['kind'],
  reason: SelfChangeFileDiffUnavailableReason,
): SelfChangeFileDetailDiff {
  return Object.freeze({ path: target, kind, diff: null, truncated: true, unavailableReason: reason });
}

function clipLine(line: string): string {
  return line.length > MAX_EXCERPT_LINE_CHARS ? `${line.slice(0, MAX_EXCERPT_LINE_CHARS - 1)}…` : line;
}

/** Key name right before a `:` / `=` (optionally quoted), or null. */
function readKeyBefore(line: string, separatorIndex: number): string | null {
  let end = separatorIndex;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
  if (end > 0 && QUOTES.has(line[end - 1]!)) end -= 1;
  let start = end;
  while (start > 0 && end - start < MAX_SECRET_KEY_CHARS && KEY_CHAR.test(line[start - 1]!)) start -= 1;
  if (start === end || !KEY_START.test(line[start]!)) return null;
  return line.slice(start, end);
}

function skipBlanks(line: string, from: number): number {
  let index = from;
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index += 1;
  return index;
}

/** End (exclusive) of a value: a quoted string through its closing quote (or the line end), else up to a stop char. */
function readValueEnd(line: string, start: number): number {
  if (start >= line.length) return start;
  const first = line[start]!;
  if (QUOTES.has(first)) {
    // Skip escaped characters (`\"`) so an escaped quote never ends the value early.
    for (let index = start + 1; index < line.length; index += 1) {
      if (line[index] === '\\') index += 1;
      else if (line[index] === first) return index + 1;
    }
    return line.length;
  }
  let end = start;
  while (end < line.length && !VALUE_STOP.has(line[end]!)) end += 1;
  // Keep trailing blanks before a stop char (or the line end) outside the redacted value.
  while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
  return end;
}

/** Redacts every content line of a unified diff; the two `---` / `+++` file header lines stay as they are. */
function redactDiffBody(diff: string): string {
  if (!diff) return diff;
  const lines = diff.split('\n');
  for (let index = 2; index < lines.length; index += 1) lines[index] = redactSecretAssignments(lines[index]!);
  return lines.join('\n');
}

function isSecretAssignmentKey(key: string): boolean {
  const name = key.split('.').pop() ?? key;
  return isSecretLikeKey(name);
}

function unreadableSnapshotDiff(record: SelfChangeRecord): SelfChangeDetailDiff {
  const previewKinds = previewFileKinds(record.plan);
  return Object.freeze({
    bodiesAvailable: true,
    baseline: 'snapshot',
    files: Object.freeze(record.files.map(entry => unavailableFile(entry.path, kindFromPreview(entry.path, entry.op, previewKinds), 'baseline_unreadable'))),
    bytes: 0,
    truncated: record.files.length > 0,
  });
}

/** 预览里记下的每个文件的 create / modify / delete（瘦身后正文没了，靠它还原类型）。 */
function previewFileKinds(plan: unknown): ReadonlyMap<string, SelfChangeFileDetailDiff['kind']> {
  const files = (plan as { files?: unknown } | null | undefined)?.files;
  const kinds = new Map<string, SelfChangeFileDetailDiff['kind']>();
  if (!Array.isArray(files)) return kinds;
  for (const file of files as readonly Partial<SelfChangeFileDiff>[]) {
    if (typeof file?.path !== 'string') continue;
    if (file.kind === 'create' || file.kind === 'modify' || file.kind === 'delete') kinds.set(file.path, file.kind);
  }
  return kinds;
}

function kindFromPreview(
  target: string,
  op: 'write' | 'delete',
  previewKinds: ReadonlyMap<string, SelfChangeFileDetailDiff['kind']>,
): SelfChangeFileDetailDiff['kind'] {
  if (op === 'delete') return 'delete';
  return previewKinds.get(target) ?? 'modify';
}

function baselineFromSnapshot(contents: ReadonlyMap<string, string | null>, target: string): Baseline {
  if (!contents.has(target)) return { exists: false, content: null };
  const content = contents.get(target) ?? null;
  return content === null ? { exists: false, content: null } : { exists: true, content };
}

async function baselineFromDisk(projectRoot: string, target: string): Promise<Baseline> {
  const current = await readCurrentFile(projectRoot, target);
  if (!current) return { exists: false, content: null };
  return { exists: true, content: current.content };
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/u);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function diffLines(oldLines: readonly string[], newLines: readonly string[]): DiffOperation[] {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const head = oldLines.slice(0, prefix).map(text => ({ kind: ' ' as const, text }));
  const tail = oldLines.slice(oldLines.length - suffix).map(text => ({ kind: ' ' as const, text }));
  return [...head, ...diffMiddle(oldMiddle, newMiddle), ...tail];
}

function diffMiddle(oldLines: readonly string[], newLines: readonly string[]): DiffOperation[] {
  const removed = oldLines.map(text => ({ kind: '-' as const, text }));
  const added = newLines.map(text => ({ kind: '+' as const, text }));
  if (oldLines.length === 0 || newLines.length === 0) return [...removed, ...added];
  if (oldLines.length * newLines.length > MAX_LCS_CELLS) return [...removed, ...added];
  const width = newLines.length + 1;
  // table[i * width + j]：oldLines[i..] 与 newLines[j..] 的最长公共子序列长度。
  const table = new Uint32Array((oldLines.length + 1) * width);
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const cell = i * width + j;
      if (oldLines[i] === newLines[j]) {
        table[cell] = table[cell + width + 1]! + 1;
      } else {
        table[cell] = Math.max(table[cell + width]!, table[cell + 1]!);
      }
    }
  }
  const operations: DiffOperation[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      operations.push({ kind: ' ', text: oldLines[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      operations.push({ kind: '-', text: oldLines[i]! });
      i += 1;
    } else {
      operations.push({ kind: '+', text: newLines[j]! });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    operations.push({ kind: '-', text: oldLines[i]! });
    i += 1;
  }
  while (j < newLines.length) {
    operations.push({ kind: '+', text: newLines[j]! });
    j += 1;
  }
  return operations;
}

/** 把操作序列切成带上下文的 `@@ -a,b +c,d @@` 改动块。 */
function formatHunks(operations: readonly DiffOperation[]): string[] {
  const changed: number[] = [];
  operations.forEach((operation, index) => {
    if (operation.kind !== ' ') changed.push(index);
  });
  if (changed.length === 0) return [];
  // 每个位置之前已经过的旧 / 新行数。
  const oldBefore = new Array<number>(operations.length + 1).fill(0);
  const newBefore = new Array<number>(operations.length + 1).fill(0);
  operations.forEach((operation, index) => {
    oldBefore[index + 1] = oldBefore[index]! + (operation.kind === '+' ? 0 : 1);
    newBefore[index + 1] = newBefore[index]! + (operation.kind === '-' ? 0 : 1);
  });
  const lines: string[] = [];
  let cursor = 0;
  while (cursor < changed.length) {
    const first = changed[cursor]!;
    let last = first;
    let next = cursor + 1;
    while (next < changed.length && changed[next]! - last <= DIFF_CONTEXT_LINES * 2 + 1) {
      last = changed[next]!;
      next += 1;
    }
    const start = Math.max(0, first - DIFF_CONTEXT_LINES);
    const end = Math.min(operations.length, last + DIFF_CONTEXT_LINES + 1);
    const oldCount = oldBefore[end]! - oldBefore[start]!;
    const newCount = newBefore[end]! - newBefore[start]!;
    const oldStart = oldCount === 0 ? oldBefore[start]! : oldBefore[start]! + 1;
    const newStart = newCount === 0 ? newBefore[start]! : newBefore[start]! + 1;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let index = start; index < end; index += 1) {
      const operation = operations[index]!;
      lines.push(`${operation.kind}${operation.text}`);
    }
    cursor = next;
  }
  return lines;
}

/** 按整行截到 `maxBytes` 以内（UTF-8）。 */
function clipToBytes(text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  if (utf8Bytes(text) <= maxBytes) return { text, truncated: false };
  const kept: string[] = [];
  let bytes = 0;
  for (const line of text.split('\n')) {
    const lineBytes = utf8Bytes(line) + (kept.length > 0 ? 1 : 0);
    if (bytes + lineBytes > maxBytes) break;
    kept.push(line);
    bytes += lineBytes;
  }
  return { text: kept.join('\n'), truncated: true };
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function unavailableLabel(reason: SelfChangeFileDiffUnavailableReason | null): string {
  switch (reason) {
    case 'slimmed':
      return '正文已清理';
    case 'staged_unreadable':
      return '暂存正文不可读';
    case 'baseline_unreadable':
      return '原文件过大或不可读';
    case 'budget_exhausted':
      return '超出展示预算';
    default:
      return '不可用';
  }
}
