import { join } from 'node:path';
import { parse } from 'dotenv';
import {
  ENV_FILE_NAMES,
  ENV_MASK_CHAR,
  ENV_MASK_RUN,
  ENV_KEY_PATTERN,
  ENV_SAVE_LIMITS,
  isConsoleEnvMaskPlaceholder,
  maskConsoleEnvValue,
  type ConsoleEnvChange,
  type ConsoleEnvFileView,
  type ConsoleEnvLine,
  type ConsoleEnvRevealResult,
  type ConsoleEnvVariable,
} from '@zhin.js/console-protocol';
import { readDotenvFile, updateDotenvFile, writeDotenvFile } from '@zhin.js/runtime';

const ENV_FILES: ReadonlySet<string> = new Set(ENV_FILE_NAMES);

function envPath(projectRoot: string, filename: string): string {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  return join(projectRoot, filename);
}

/** The file as written. Only for the Host itself (setup, doctor); the Console reads {@link readEnvFileView}. */
export async function readEnvFile(projectRoot: string, filename: string): Promise<string> {
  return readDotenvFile(envPath(projectRoot, filename));
}

/** Locked, atomic replacement that keeps the file mode (`0600` when new); ADR 0057 §4. */
export async function writeEnvFile(projectRoot: string, filename: string, content: string): Promise<void> {
  await writeDotenvFile(envPath(projectRoot, filename), content);
}

// ---------------------------------------------------------------------------------------------
// Parsing: assignments (one per variable, multi-line quoted values included) and the text around
// them, so that serialising the segments reproduces the input byte for byte.

const ASSIGNMENT = /^(\s*(?:export\s+)?)([\w.-]+)(\s*=\s*)(.*)$/u;
const COMMENTED_ASSIGNMENT = /^\s*#\s*(?:export\s+)?([\w.-]+)\s*=(.*)$/u;
const REFERENCE = /^\$\{[^}]+\}$/u;

type Segment =
  | { kind: 'text'; raw: string }
  | { kind: 'entry'; before: string; key: string; equals: string; value: string; eol: string };

/** Whether an unescaped `quote` occurs in `text` from `start` on; returns its index or -1. */
function closingQuote(text: string, quote: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] !== quote) continue;
    let escapes = 0;
    for (let back = index - 1; back >= 0 && text[back] === '\\'; back -= 1) escapes += 1;
    if (escapes % 2 === 0) return index;
  }
  return -1;
}

function openingQuote(value: string): string | null {
  return /^["'`]/u.test(value) ? value[0]! : null;
}

function segments(content: string): Segment[] {
  const parts = content.split(/(\r\n|\n|\r)/u);
  const out: Segment[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index]!;
    let eol = parts[index + 1] ?? '';
    const match = ASSIGNMENT.exec(line);
    if (!match) {
      if (line || eol) out.push({ kind: 'text', raw: line + eol });
      continue;
    }
    let value = match[4]!;
    const quote = openingQuote(value);
    if (quote && closingQuote(value, quote, 1) < 0) {
      while (index + 2 < parts.length) {
        index += 2;
        value += eol + parts[index]!;
        eol = parts[index + 1] ?? '';
        if (closingQuote(parts[index]!, quote, 0) >= 0) break;
      }
    }
    out.push({ kind: 'entry', before: match[1]!, key: match[2]!, equals: match[3]!, value, eol });
  }
  return out;
}

const serialize = (segs: readonly Segment[]): string =>
  segs.map(seg => seg.kind === 'text' ? seg.raw : seg.before + seg.key + seg.equals + seg.value + seg.eol).join('');

/** The value as the process reads it (dotenv's own parser on that one assignment). */
function effectiveValue(key: string, rawValue: string): string {
  return parse(`${key}=${rawValue}`)[key] ?? '';
}

function maskedVariable(key: string, rawValue: string): ConsoleEnvVariable {
  const value = effectiveValue(key, rawValue);
  return Object.freeze({
    key,
    masked: maskConsoleEnvValue(value),
    length: Array.from(value).length,
    hasValue: value.length > 0,
    ...(REFERENCE.test(value) ? { isReference: true as const } : {}),
  });
}

function textLines(raw: string): ConsoleEnvLine[] {
  return raw.split(/\r\n|\n|\r/u).slice(0, raw.match(/\r\n|\n|\r/u) ? -1 : undefined).map((line): ConsoleEnvLine => {
    if (!line.trim()) return Object.freeze({ kind: 'blank' });
    const commented = COMMENTED_ASSIGNMENT.exec(line);
    if (commented) {
      return Object.freeze({ kind: 'comment', key: commented[1]!, masked: maskConsoleEnvValue(effectiveValue(commented[1]!, commented[2]!.trim())) });
    }
    if (/^\s*#/u.test(line)) return Object.freeze({ kind: 'comment', text: line });
    return Object.freeze({ kind: 'other', length: Array.from(line).length });
  });
}

/** Masked view of `content` (`env:get`); never contains a value, only masks, lengths and key names. */
export function maskEnvFileContent(file: string, content: string): ConsoleEnvFileView {
  const lines: ConsoleEnvLine[] = [];
  const variables = new Map<string, ConsoleEnvVariable>();
  for (const seg of segments(content)) {
    if (seg.kind === 'text') { lines.push(...textLines(seg.raw)); continue; }
    lines.push(Object.freeze({ kind: 'entry', key: seg.key, ...(/export\s/u.test(seg.before) ? { export: true as const } : {}) }));
    // A key assigned twice: the last assignment is the one the process reads; keep first position.
    variables.set(seg.key, maskedVariable(seg.key, seg.value));
  }
  const order = [...new Set(lines.filter(line => line.kind === 'entry').map(line => (line as { key: string }).key))];
  const masked = lines.map((line) => {
    switch (line.kind) {
      case 'blank': return '';
      case 'comment': return 'text' in line ? line.text : `# ${line.key}=${line.masked}`;
      case 'entry': return `${line.export ? 'export ' : ''}${line.key}=${variables.get(line.key)!.masked}`;
      case 'other': return ENV_MASK_CHAR.repeat(ENV_MASK_RUN);
    }
  });
  return Object.freeze({
    format: 'masked',
    file,
    variables: Object.freeze(order.map(key => variables.get(key)!)),
    lines: Object.freeze(lines),
    content: masked.length ? `${masked.join('\n')}\n` : '',
  });
}

export async function readEnvFileView(projectRoot: string, filename: string): Promise<ConsoleEnvFileView> {
  return maskEnvFileContent(filename, await readDotenvFile(envPath(projectRoot, filename)));
}

export class EnvVariableNotFoundError extends Error {
  readonly code = 'env_variable_not_found';
  constructor(filename: string, key: string) {
    super(`${filename} 中没有变量 ${key}`);
    this.name = 'EnvVariableNotFoundError';
  }
}

/** One variable (its effective assignment) as written in the file. */
export async function revealEnvVariable(projectRoot: string, filename: string, key: string): Promise<ConsoleEnvRevealResult> {
  if (typeof key !== 'string' || !ENV_KEY_PATTERN.test(key) || key.length > ENV_SAVE_LIMITS.maxKeyLength) {
    throw new EnvChangeError('变量名无效');
  }
  const content = await readDotenvFile(envPath(projectRoot, filename));
  let value: string | undefined;
  for (const seg of segments(content)) if (seg.kind === 'entry' && seg.key === key) value = seg.value;
  if (value === undefined) throw new EnvVariableNotFoundError(filename, key);
  return Object.freeze({ file: filename, key, value });
}

export class EnvChangeError extends Error {
  readonly code = 'invalid_env_change';
  constructor(message: string) {
    super(message);
    this.name = 'EnvChangeError';
  }
}

/**
 * Whether a raw value (as written after `KEY=`) stays one assignment: a value spanning lines must
 * be quoted and end with its closing quote; a quoted value must close exactly at its end.
 */
function assignmentProblem(value: string): string | null {
  const quote = openingQuote(value);
  if (quote) {
    const end = closingQuote(value, quote, 1);
    // Text after the closing quote (an inline comment) must stay on the same line.
    if (end < 0 || /[\r\n]/u.test(value.slice(end + 1))) return '引号没有闭合，或闭合后还有换行';
    return null;
  }
  return /[\r\n]/u.test(value) ? '多行值必须用引号包裹' : null;
}

/** Validated `env:save` changes; throws {@link EnvChangeError} (nothing is written). */
export function validateEnvChanges(changes: unknown): readonly ConsoleEnvChange[] {
  if (!Array.isArray(changes) || changes.length === 0) throw new EnvChangeError('changes 必须是非空数组');
  if (changes.length > ENV_SAVE_LIMITS.maxChanges) throw new EnvChangeError(`一次最多修改 ${ENV_SAVE_LIMITS.maxChanges} 个变量`);
  const seen = new Set<string>();
  return Object.freeze(changes.map((item, index): ConsoleEnvChange => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new EnvChangeError(`changes[${index}] 必须是对象`);
    const { key, value } = item as Record<string, unknown>;
    const remove = (item as Record<string, unknown>).delete === true;
    if (typeof key !== 'string' || !ENV_KEY_PATTERN.test(key) || key.length > ENV_SAVE_LIMITS.maxKeyLength) {
      throw new EnvChangeError(`changes[${index}].key 不是合法变量名`);
    }
    if (seen.has(key)) throw new EnvChangeError(`变量 ${key} 在 changes 中出现了多次`);
    seen.add(key);
    if (remove) {
      if (value !== undefined) throw new EnvChangeError(`changes[${index}] 不能同时删除并设置值`);
      return Object.freeze({ key, delete: true as const });
    }
    if (typeof value !== 'string') throw new EnvChangeError(`changes[${index}].value 必须是字符串`);
    if (value.length > ENV_SAVE_LIMITS.maxValueLength) throw new EnvChangeError(`变量 ${key} 的值过长`);
    if (isConsoleEnvMaskPlaceholder(value)) {
      throw new EnvChangeError(`变量 ${key} 的值是打码占位（●），不能保存；请填写真实值，或不修改这个变量`);
    }
    const problem = assignmentProblem(value);
    if (problem) throw new EnvChangeError(`变量 ${key}：${problem}`);
    return Object.freeze({ key, value });
  }));
}

/** Applies validated changes to `content`; every line not naming a changed key keeps its bytes. */
export function applyEnvChanges(content: string, changes: readonly ConsoleEnvChange[]): string {
  let segs = segments(content);
  for (const change of changes) {
    if ('delete' in change) {
      segs = segs.filter(seg => seg.kind !== 'entry' || seg.key !== change.key);
      continue;
    }
    let found = false;
    for (const seg of segs) {
      if (seg.kind !== 'entry' || seg.key !== change.key) continue;
      seg.value = change.value;
      found = true;
    }
    if (!found) {
      const text = serialize(segs);
      const eol = text.match(/\r\n|\n|\r/u)?.[0] ?? '\n';
      const separator = text && !/[\r\n]$/u.test(text) ? eol : '';
      segs = segments(`${text}${separator}${change.key}=${change.value}${eol}`);
    }
  }
  return serialize(segs);
}

/**
 * `env:save { changes }`: applies the changes to the file as it is on disk, inside the dotenv
 * lock. Keys not named keep their lines byte for byte (they are never rebuilt from a masked view).
 */
export async function updateEnvVariables(projectRoot: string, filename: string, changes: unknown): Promise<{ readonly changed: readonly string[] }> {
  const valid = validateEnvChanges(changes);
  await updateDotenvFile(envPath(projectRoot, filename), current => applyEnvChanges(current, valid));
  return Object.freeze({ changed: Object.freeze(valid.map(change => change.key)) });
}

/** Keys of `content` whose value (or commented value) is a mask placeholder. */
export function maskedPlaceholderKeys(content: string): readonly string[] {
  const keys = new Set<string>();
  for (const seg of segments(content)) {
    if (seg.kind === 'entry' && isConsoleEnvMaskPlaceholder(seg.value)) keys.add(seg.key);
    if (seg.kind === 'text' && isConsoleEnvMaskPlaceholder(seg.raw)) keys.add('(非变量行)');
  }
  return [...keys];
}

/**
 * `env:save { content, mode: 'replace' }`: the whole-file form. Refused when any value is a mask
 * placeholder, so a masked view can never be written back over the real values.
 */
export async function replaceEnvFileContent(projectRoot: string, filename: string, content: string): Promise<void> {
  const masked = maskedPlaceholderKeys(content);
  if (masked.length) {
    throw new EnvChangeError(`内容里有打码占位（●），不能整文件保存：${masked.slice(0, 8).join('、')}。请改用逐键保存`);
  }
  await writeEnvFile(projectRoot, filename, content);
}
