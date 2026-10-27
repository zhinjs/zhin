import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolInputJsonObjectSchema,
  type ToolInputJsonSchema,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import { MAX_EDIT_FILE_SIZE, MAX_READ_FILE_SIZE, isFileStale } from '../security/file-policy.js';
import { findActualStringInFile, preserveQuoteStyleInEdit } from './file-edit-quote-utils.js';
import { walkWorkspaceFiles } from './file-search-scope.js';

/** Output budgets keep one exploratory call from flooding the model context. */
const MAX_READ_LINES = 2_000;
const MAX_LINE_CHARS = 500;
const MAX_LIST_ENTRIES = 500;
const MAX_GLOB_FILES = 100;
const DEFAULT_GREP_MATCHES = 50;
const MAX_GREP_MATCHES = 200;
const MAX_GREP_OUTPUT_BYTES = 24 * 1024;
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
const NARROW_HINT = 'narrow the pattern, path, or include filter to see more';

export interface NativeFileToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

/** Native ToolFeature definitions; no classic Tool, Message, or process cwd dependency. */
export function createNativeFileToolFeatures(): readonly NativeFileToolFeature[] {
  return Object.freeze([
    feature('read_file', defineAgentTool({
      description: `Read a UTF-8 text file inside the authorized workspace with optional line slicing (at most ${MAX_READ_LINES} lines per call).`,
      inputSchema: objectSchema({
        file_path: { type: 'string', description: 'Path relative to the authorized workspace' },
        offset: { type: 'number', description: 'Zero-based first line' },
        limit: { type: 'number', description: 'Maximum lines to return' },
      }, ['file_path']),
      requiresApproval: 'never',
      execute: readFile,
    })),
    feature('write_file', defineAgentTool({
      description: 'Create or replace a UTF-8 file inside the authorized workspace.',
      inputSchema: objectSchema({
        file_path: { type: 'string', description: 'Path relative to the authorized workspace' },
        content: { type: 'string', description: 'Complete file content' },
      }, ['file_path', 'content']),
      requiresApproval: 'on-risk',
      execute: writeFile,
    })),
    feature('edit_file', defineAgentTool({
      description: 'Replace one unique text occurrence in a file inside the authorized workspace.',
      inputSchema: objectSchema({
        file_path: { type: 'string', description: 'Path relative to the authorized workspace' },
        old_string: { type: 'string', description: 'Unique text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
      }, ['file_path', 'old_string', 'new_string']),
      requiresApproval: 'on-risk',
      execute: editFile,
    })),
    feature('list_dir', defineAgentTool({
      description: `List up to ${MAX_LIST_ENTRIES} entries in a directory inside the authorized workspace.`,
      inputSchema: objectSchema({ path: { type: 'string', description: 'Directory path' } }, ['path']),
      requiresApproval: 'never',
      execute: listDir,
    })),
    feature('glob', defineAgentTool({
      description: `Find up to ${MAX_GLOB_FILES} files matching a glob pattern inside the authorized workspace. `
        + 'Skips node_modules, .git, build output and .gitignore matches unless cwd points inside them.',
      inputSchema: objectSchema({
        pattern: { type: 'string', description: 'Glob pattern such as **/*.ts' },
        cwd: { type: 'string', description: 'Search directory inside the workspace' },
      }, ['pattern']),
      requiresApproval: 'never',
      execute: globFiles,
    })),
    feature('grep', defineAgentTool({
      description: 'Search UTF-8 files by a specific regular expression inside the authorized workspace. '
        + 'Skips node_modules, .git, build output and .gitignore matches unless path points inside them. '
        + 'To view a whole file use read_file; to find files use glob or list_dir.',
      inputSchema: objectSchema({
        pattern: { type: 'string', description: 'Regular expression' },
        path: { type: 'string', description: 'File or directory to search' },
        include: { type: 'string', description: 'Optional file glob' },
        ignore_case: { type: 'boolean' },
        limit: { type: 'number', description: `Maximum matching lines (default ${DEFAULT_GREP_MATCHES}, max ${MAX_GREP_MATCHES})` },
      }, ['pattern']),
      requiresApproval: 'never',
      execute: grepFiles,
    })),
  ]);
}

function feature(
  name: string,
  definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>,
): NativeFileToolFeature {
  return Object.freeze({ feature: toolFeatureId, name, definition });
}

async function readFile(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const target = authorizedAbsolutePath(input.file_path, context);
  context.signal.throwIfAborted();
  const stat = await fs.stat(target);
  if (stat.size > MAX_READ_FILE_SIZE) {
    throw new Error(`File exceeds the ${MAX_READ_FILE_SIZE} byte read limit`);
  }
  if (isImageFile(target)) {
    throw new Error('Binary images cannot be read as UTF-8; attach the image to a turn using a vision-capable model');
  }
  const content = await fs.readFile(target, { encoding: 'utf8', signal: context.signal });
  const lines = content.split('\n');
  const offset = nonNegativeInteger(input.offset, 0);
  const limit = Math.min(nonNegativeInteger(input.limit, MAX_READ_LINES), MAX_READ_LINES);
  const end = Math.min(offset + limit, lines.length);
  const numbered = lines.slice(offset, end)
    .map((line, index) => `${offset + index + 1} | ${clipLine(line)}`)
    .join('\n');
  const header = `File: ${target} (${lines.length} lines, showing ${offset + 1}-${end})`;
  const more = end < lines.length
    ? `\n[${lines.length - end} more lines; call read_file again with offset=${end} to continue]`
    : '';
  return `${header}\n${numbered}${more}`;
}

async function writeFile(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const target = authorizedAbsolutePath(input.file_path, context);
  const content = requiredString(input.content, 'content', true);
  context.signal.throwIfAborted();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, { encoding: 'utf8', signal: context.signal });
  return `Wrote ${Buffer.byteLength(content)} bytes to ${target}`;
}

async function editFile(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const target = authorizedAbsolutePath(input.file_path, context);
  const oldString = requiredString(input.old_string, 'old_string', true);
  const newString = requiredString(input.new_string, 'new_string', true);
  context.signal.throwIfAborted();
  const stat = await fs.stat(target);
  if (stat.size > MAX_EDIT_FILE_SIZE) throw new Error(`File exceeds the ${MAX_EDIT_FILE_SIZE} byte edit limit`);
  const content = await fs.readFile(target, { encoding: 'utf8', signal: context.signal });
  const match = findActualStringInFile(content, oldString);
  if (!match) throw new Error('old_string not found in file');
  if (match.count !== 1) throw new Error(`old_string appears ${match.count} times; provide unique context`);
  const replacement = match.wasNormalized
    ? preserveQuoteStyleInEdit(oldString, match.actual, newString)
    : newString;
  const current = await fs.stat(target);
  if (isFileStale(stat.mtimeMs, current.mtimeMs)) throw new Error('File changed during edit; read it again');
  await fs.writeFile(target, content.replace(match.actual, replacement), { encoding: 'utf8', signal: context.signal });
  return `Edited ${target}`;
}

async function listDir(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const target = authorizedAbsolutePath(input.path, context);
  context.signal.throwIfAborted();
  const entries = await fs.readdir(target, { withFileTypes: true });
  if (entries.length === 0) return `Directory ${target} is empty`;
  const listed = entries.sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_LIST_ENTRIES)
    .map((entry) => `${entry.isDirectory() ? '[DIR]  ' : '       '}${entry.name}`)
    .join('\n');
  return entries.length > MAX_LIST_ENTRIES
    ? `${listed}\n[truncated: showing ${MAX_LIST_ENTRIES} of ${entries.length} entries; use glob with a narrower pattern]`
    : listed;
}

async function globFiles(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const root = authorizedAbsolutePath(input.cwd, context);
  const pattern = requiredString(input.pattern, 'pattern');
  const matches: string[] = [];
  const matcher = globMatcher(pattern);
  let truncated = false;
  for await (const file of walkWorkspaceFiles(root, workspaceRootOf(context), context.signal)) {
    const relative = slash(path.relative(root, file));
    if (!matcher.test(relative)) continue;
    if (matches.length >= MAX_GLOB_FILES) {
      truncated = true;
      break;
    }
    matches.push(relative);
  }
  if (matches.length === 0) return `No files matching '${pattern}'`;
  const notice = truncated ? `\n[truncated at ${MAX_GLOB_FILES} files; ${NARROW_HINT}]` : '';
  return `Found ${matches.length} files:\n${matches.join('\n')}${notice}`;
}

async function grepFiles(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const root = authorizedAbsolutePath(input.path, context);
  const pattern = requiredString(input.pattern, 'pattern');
  const expression = new RegExp(pattern, input.ignore_case === true ? 'i' : undefined);
  assertSelectivePattern(pattern, expression);
  const include = typeof input.include === 'string' && input.include.trim()
    ? globMatcher(input.include)
    : undefined;
  const limit = Math.min(Math.max(1, nonNegativeInteger(input.limit, DEFAULT_GREP_MATCHES)), MAX_GREP_MATCHES);
  const stat = await fs.stat(root);
  const files = stat.isDirectory()
    ? walkWorkspaceFiles(root, workspaceRootOf(context), context.signal)
    : singleFile(root);
  const matches: string[] = [];
  let bytes = 0;
  let truncated: string | undefined;
  search: for await (const file of files) {
    context.signal.throwIfAborted();
    if (include && !include.test(path.basename(file))) continue;
    const content = await readSearchableText(file, context.signal);
    if (content === undefined) continue;
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!expression.test(lines[index]!)) continue;
      const match = `${slash(path.relative(root, file) || path.basename(file))}:${index + 1}:${clipLine(lines[index]!)}`;
      if (matches.length >= limit) {
        truncated = `${limit} matches`;
        break search;
      }
      bytes += Buffer.byteLength(match) + 1;
      if (bytes > MAX_GREP_OUTPUT_BYTES) {
        truncated = `${MAX_GREP_OUTPUT_BYTES} bytes`;
        break search;
      }
      matches.push(match);
    }
  }
  if (matches.length === 0) return `No matches for '${pattern}'`;
  return truncated
    ? `${matches.join('\n')}\n[truncated at ${truncated}; ${NARROW_HINT}]`
    : matches.join('\n');
}

/**
 * A pattern that matches the empty string matches every line of every file:
 * it dumps whole trees into context instead of locating anything.
 */
function assertSelectivePattern(pattern: string, expression: RegExp): void {
  if (!expression.test('')) return;
  throw new Error(
    `grep pattern '${pattern}' matches every line, so it cannot locate anything. `
    + 'Use read_file to view a file, glob or list_dir to find files, '
    + 'or give grep a specific text or regular expression to look for.',
  );
}

/** Skip oversized and binary files: they are never useful grep context. */
async function readSearchableText(file: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_GREP_FILE_BYTES) return undefined;
    const buffer = await fs.readFile(file, { signal });
    if (buffer.subarray(0, 8_192).includes(0)) return undefined;
    return buffer.toString('utf8');
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

function clipLine(line: string): string {
  return line.length > MAX_LINE_CHARS
    ? `${line.slice(0, MAX_LINE_CHARS)}… [line truncated, ${line.length} chars]`
    : line;
}

async function* singleFile(file: string): AsyncGenerator<string> {
  yield file;
}

function workspaceRootOf(context: ToolExecutionContext): string {
  const workspaceRoot = context.policy.filesystem?.workspaceRoot;
  if (!workspaceRoot) throw new Error('File input was not authorized by TurnToolRuntime');
  return workspaceRoot;
}

export function authorizedAbsolutePath(value: unknown, context: ToolExecutionContext): string {
  const target = requiredString(value ?? context.policy.filesystem?.workspaceRoot, 'path');
  const workspaceRoot = context.policy.filesystem?.workspaceRoot;
  if (!workspaceRoot || !path.isAbsolute(target)) throw new Error('File input was not authorized by TurnToolRuntime');
  const relative = path.relative(workspaceRoot, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('File input is outside the authorized workspace');
  }
  return target;
}

function requiredString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new TypeError(`${name} is required`);
  return value;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function isImageFile(file: string): boolean {
  return new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'])
    .has(path.extname(file).toLowerCase());
}

function globMatcher(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '*' && pattern[index + 1] === '*') {
      // `**/` also matches zero directories, so `**/package.json` finds the root manifest.
      const spansSeparator = pattern[index + 2] === '/';
      source += spansSeparator ? '(?:.*/)?' : '.*';
      index += spansSeparator ? 2 : 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function slash(value: string): string {
  return value.split(path.sep).join('/');
}

function objectSchema(
  properties: Record<string, ToolInputJsonSchema>,
  required: readonly string[],
): ToolInputJsonObjectSchema {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}
