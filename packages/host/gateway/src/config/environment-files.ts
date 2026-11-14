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
// Parsing. The process reads `.env` with dotenv's `parse`, so the Console's view of the file must be
// exactly dotenv's: the same assignments, with the same values. `DOTENV_LINE` is dotenv's own line
// pattern (dotenv 17, `lib/main.js` `LINE`) with two extra capture groups (the separator and the
// value) and match indices; `scanEnv` runs it the way `parse` does (`\r\n` / `\r` read as `\n`) and
// maps every match back to the bytes of the file. Anything dotenv does not read as an assignment is
// text (comments, blank and stray lines). The tests compare this scan with `parse` itself.

// No `u` flag: the pattern is kept exactly as dotenv has it.
const DOTENV_LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/dgm;
const REFERENCE = /^\$\{[^}]+\}$/u;

/** One assignment dotenv reads. Offsets are into the original content; `[start, end)` are whole lines. */
interface EnvEntry {
  readonly key: string;
  readonly exported: boolean;
  /** Start of the first line of the assignment and end of its last line (line break included). */
  readonly start: number;
  readonly end: number;
  /** The value as written (`KEY=` part and inline comment excluded), replaced by a new value. */
  readonly valueStart: number;
  readonly valueEnd: number;
  /** The value as written (quotes included). */
  readonly raw: string;
  /** The value as the process reads it. */
  readonly value: string;
}

interface EnvScan {
  readonly entries: readonly EnvEntry[];
  /** Text between assignments: whole lines, in order. */
  readonly texts: readonly { readonly start: number; readonly end: number }[];
}

/** dotenv's value rules, applied to the captured value (see `parse` in dotenv's `lib/main.js`). */
function dotenvValue(captured: string): string {
  let value = captured.trim();
  const maybeQuote = value[0];
  value = value.replace(/^(['"`])([\s\S]*)\1$/mg, '$2');
  if (maybeQuote === '"') value = value.replace(/\\n/gu, '\n').replace(/\\r/gu, '\r');
  return value;
}

function scanEnv(content: string): EnvScan {
  // dotenv reads `\r\n` and `\r` as `\n`; `toOriginal[i]` is the offset in `content` of normalised offset `i`.
  let normalized = '';
  const toOriginal: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    toOriginal.push(index);
    if (content[index] === '\r') {
      normalized += '\n';
      if (content[index + 1] === '\n') index += 1;
    } else normalized += content[index];
  }
  toOriginal.push(content.length);

  const entries: EnvEntry[] = [];
  const texts: { start: number; end: number }[] = [];
  let cursor = 0;
  const pattern = new RegExp(DOTENV_LINE.source, DOTENV_LINE.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const indices = match.indices!;
    const first = match.index + match[0].search(/\S/u);
    const lineStart = normalized.lastIndexOf('\n', first - 1) + 1;
    const separatorEnd = indices[2]![1];
    let valueStart = separatorEnd;
    let valueEnd = separatorEnd;
    if (match[3] !== undefined) {
      const [groupStart, groupEnd] = indices[3]!;
      const leading = /^\s*/u.exec(match[3])![0];
      // A value on a line of its own (`KEY=` then `"value"`): replacing it replaces that line break too.
      valueStart = leading.includes('\n') ? groupStart : groupStart + leading.length;
      valueEnd = groupStart + match[3].trimEnd().length;
      if (valueEnd < valueStart) valueEnd = valueStart;
    }
    const last = Math.max(valueEnd, separatorEnd) - 1;
    const lineBreak = normalized.indexOf('\n', last);
    const lineEnd = lineBreak < 0 ? normalized.length : lineBreak + 1;
    if (lineStart > cursor) texts.push({ start: toOriginal[cursor]!, end: toOriginal[lineStart]! });
    const rawStart = groupValueStart(match[3], indices[3]);
    entries.push(Object.freeze({
      key: match[1]!,
      exported: /^export\s/u.test(normalized.slice(first, indices[1]![0])),
      start: toOriginal[lineStart]!,
      end: toOriginal[lineEnd]!,
      valueStart: toOriginal[valueStart]!,
      valueEnd: toOriginal[valueEnd]!,
      raw: content.slice(toOriginal[rawStart ?? valueStart]!, toOriginal[valueEnd]!),
      value: dotenvValue(match[3] ?? ''),
    }));
    cursor = lineEnd;
  }
  if (cursor < normalized.length) texts.push({ start: toOriginal[cursor]!, end: content.length });
  return { entries, texts };
}

/** Where the captured value starts once its leading whitespace is left out. */
function groupValueStart(captured: string | undefined, span: [number, number] | undefined): number | undefined {
  if (captured === undefined || !span) return undefined;
  return span[0] + /^\s*/u.exec(captured)![0].length;
}

/** What the process reads from `content`: dotenv's own `parse` (the last assignment of a key wins). */
function dotenvValues(content: string): Map<string, string> {
  return new Map(Object.entries(parse(content)));
}

/** The value as the process reads it (dotenv's own rules on that one assignment). */
function effectiveValue(key: string, rawValue: string): string {
  return parse(`${key}=${rawValue}`)[key] ?? '';
}

function maskedVariable(entry: EnvEntry): ConsoleEnvVariable {
  return Object.freeze({
    key: entry.key,
    masked: maskConsoleEnvValue(entry.value),
    hasValue: entry.value.length > 0,
    ...(REFERENCE.test(entry.value) ? { isReference: true as const } : {}),
  });
}

/** A comment that names a key: `# KEY=value`, `## KEY=value`, `#- KEY: value`, `# export KEY=value`. */
const COMMENTED_ASSIGNMENT = /^\s*#[^\w\r\n]*?(?:export\s+)?([\w.-]+)\s*[=:](.*\S.*)$/u;
/** Any other sign of a value in a comment: `=` or `:` followed by text (`# old token is: sk-…`). */
const COMMENTED_VALUE = /[=:](?=\s*\S)/u;

const unquote = (text: string): string => text.trim().replace(/^(["'`])([\s\S]*)\1$/u, '$2');

function textLines(raw: string): ConsoleEnvLine[] {
  return raw.split(/\r\n|\n|\r/u).slice(0, raw.match(/\r\n|\n|\r/u) ? -1 : undefined).map((line): ConsoleEnvLine => {
    if (!line.trim()) return Object.freeze({ kind: 'blank' });
    if (!/^\s*#/u.test(line)) return Object.freeze({ kind: 'other' });
    const commented = COMMENTED_ASSIGNMENT.exec(line);
    if (commented) return Object.freeze({ kind: 'comment', key: commented[1]!, masked: maskConsoleEnvValue(unquote(commented[2]!)) });
    const separator = COMMENTED_VALUE.exec(line);
    if (separator) {
      const head = line.slice(0, separator.index + 1);
      return Object.freeze({ kind: 'comment', text: `${head} ${maskConsoleEnvValue(unquote(line.slice(separator.index + 1))) || ENV_MASK_CHAR.repeat(ENV_MASK_RUN)}` });
    }
    return Object.freeze({ kind: 'comment', text: line });
  });
}

/**
 * Masked view of `content` (`env:get`): exactly the variables dotenv reads, each masked; comments
 * that carry a value are masked too. Never contains a value, its length, or a line's length.
 */
export function maskEnvFileContent(file: string, content: string): ConsoleEnvFileView {
  const { entries, texts } = scanEnv(content);
  const lines: ConsoleEnvLine[] = [];
  const variables = new Map<string, ConsoleEnvVariable>();
  let text = 0;
  for (const entry of entries) {
    while (text < texts.length && texts[text]!.start < entry.start) lines.push(...textLines(content.slice(texts[text]!.start, texts[text++]!.end)));
    lines.push(Object.freeze({ kind: 'entry', key: entry.key, ...(entry.exported ? { export: true as const } : {}) }));
    // A key assigned twice: the last assignment is the one the process reads; keep first position.
    variables.set(entry.key, maskedVariable(entry));
  }
  while (text < texts.length) lines.push(...textLines(content.slice(texts[text]!.start, texts[text++]!.end)));
  const order = [...new Set(entries.map(entry => entry.key))];
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

/**
 * One variable (its effective, i.e. last, assignment) as written in the file: exactly the text
 * dotenv reads as that variable's value, so it never carries another line of the file.
 */
export async function revealEnvVariable(projectRoot: string, filename: string, key: string): Promise<ConsoleEnvRevealResult> {
  if (typeof key !== 'string' || !ENV_KEY_PATTERN.test(key) || key.length > ENV_SAVE_LIMITS.maxKeyLength) {
    throw new EnvChangeError('变量名无效');
  }
  const content = await readDotenvFile(envPath(projectRoot, filename));
  const entry = scanEnv(content).entries.filter(item => item.key === key).at(-1);
  if (!entry) throw new EnvVariableNotFoundError(filename, key);
  return Object.freeze({ file: filename, key, value: entry.raw });
}

export class EnvChangeError extends Error {
  readonly code = 'invalid_env_change';
  constructor(message: string) {
    super(message);
    this.name = 'EnvChangeError';
  }
}

/**
 * Whether a raw value (as written after `KEY=`) is read back by dotenv as one assignment of `KEY`
 * and nothing else: a value spanning lines must be quoted; after a closing quote only spaces or an
 * inline comment (`# …`) may follow, on the same line. dotenv reads `"x"zz` as the unquoted `"x`
 * and the next line as a new assignment, so such a value is refused.
 */
function assignmentProblem(value: string): string | null {
  const written = `K=${value}`;
  const { entries, texts } = scanEnv(written);
  const quoted = /^\s*["'`]/u.test(value);
  if (/[\r\n]/u.test(value) && !/^[ \t]*["'`]/u.test(value)) return '多行值必须用引号包裹';
  const entry = entries[0];
  if (entries.length !== 1 || texts.length !== 0 || entry!.key !== 'K' || entry!.end !== written.length) {
    return quoted ? '引号没有闭合，或闭合引号之后还有注释以外的内容' : '值会被读成多行或多个变量';
  }
  const tail = written.slice(entry!.valueEnd);
  if (/[\r\n]/u.test(tail)) return '闭合引号之后还有换行';
  if (quoted) {
    const quote = value.trimStart()[0]!;
    const raw = entry!.raw;
    if (raw.length < 2 || raw[0] !== quote || raw.at(-1) !== quote || !/^\s*(?:#.*)?$/u.test(tail)) {
      return '引号没有闭合，或闭合引号之后还有注释以外的内容';
    }
  }
  return null;
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

/** `content` with one change applied; every line not naming `change.key` keeps its bytes. */
function applyEnvChange(content: string, change: ConsoleEnvChange): string {
  const entries = scanEnv(content).entries.filter(entry => entry.key === change.key);
  let text = content;
  // From the last assignment backwards, so earlier offsets stay valid.
  for (const entry of [...entries].reverse()) {
    text = 'delete' in change
      ? text.slice(0, entry.start) + text.slice(entry.end)
      : text.slice(0, entry.valueStart) + change.value + text.slice(entry.valueEnd);
  }
  if ('delete' in change || entries.length) return text;
  const eol = text.match(/\r\n|\n|\r/u)?.[0] ?? '\n';
  const separator = text && !/[\r\n]$/u.test(text) ? eol : '';
  return `${text}${separator}${change.key}=${change.value}${eol}`;
}

/**
 * Checks what dotenv reads after the changes: every key not submitted keeps its value (none appears
 * or disappears), every set key reads as its submitted value and every deleted key is gone.
 * Throws {@link EnvChangeError} otherwise (the file is not written).
 */
function assertOnlySubmittedKeysChanged(before: string, after: string, changes: readonly ConsoleEnvChange[]): void {
  const old = dotenvValues(before);
  const next = dotenvValues(after);
  const submitted = new Map(changes.map(change => [change.key, change]));
  const problems: string[] = [];
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const change = submitted.get(key);
    if (!change) {
      if (old.get(key) !== next.get(key) || old.has(key) !== next.has(key)) problems.push(key);
    } else if ('delete' in change ? next.has(key) : next.get(key) !== effectiveValue(key, change.value)) {
      problems.push(key);
    }
  }
  for (const change of changes) {
    if (!('delete' in change) && !next.has(change.key)) problems.push(change.key);
  }
  if (problems.length) {
    throw new EnvChangeError(`保存会改变未提交的变量或读不回提交的值：${[...new Set(problems)].slice(0, 8).join('、')}；文件没有修改`);
  }
}

/**
 * Applies validated changes to `content`; every line not naming a changed key keeps its bytes.
 * Throws {@link EnvChangeError} when dotenv would read anything but the submitted changes.
 */
export function applyEnvChanges(content: string, changes: readonly ConsoleEnvChange[]): string {
  const next = changes.reduce(applyEnvChange, content);
  assertOnlySubmittedKeysChanged(content, next, changes);
  return next;
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
  const { entries, texts } = scanEnv(content);
  for (const entry of entries) if (isConsoleEnvMaskPlaceholder(entry.raw)) keys.add(entry.key);
  for (const text of texts) if (isConsoleEnvMaskPlaceholder(content.slice(text.start, text.end))) keys.add('(非变量行)');
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
