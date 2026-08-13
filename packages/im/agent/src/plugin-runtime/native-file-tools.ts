import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import { MAX_EDIT_FILE_SIZE, MAX_READ_FILE_SIZE, isFileStale } from '../security/file-policy.js';
import { findActualStringInFile, preserveQuoteStyleInEdit } from '../builtin/file-edit-quote-utils.js';

export interface NativeFileToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

/** Native ToolFeature definitions; no classic Tool, Message, or process cwd dependency. */
export function createNativeFileToolFeatures(): readonly NativeFileToolFeature[] {
  return Object.freeze([
    feature('read_file', defineAgentTool({
      description: 'Read a UTF-8 text file inside the authorized workspace with optional line slicing.',
      inputSchema: objectSchema({
        file_path: { type: 'string', description: 'Path relative to the authorized workspace' },
        offset: { type: 'number', description: 'Zero-based first line' },
        limit: { type: 'number', description: 'Maximum lines to return' },
      }, ['file_path']),
      approval: 'never',
      execute: readFile,
    })),
    feature('write_file', defineAgentTool({
      description: 'Create or replace a UTF-8 file inside the authorized workspace.',
      inputSchema: objectSchema({
        file_path: { type: 'string', description: 'Path relative to the authorized workspace' },
        content: { type: 'string', description: 'Complete file content' },
      }, ['file_path', 'content']),
      approval: 'on-risk',
      execute: writeFile,
    })),
    feature('edit_file', defineAgentTool({
      description: 'Replace one unique text occurrence in a file inside the authorized workspace.',
      inputSchema: objectSchema({
        file_path: { type: 'string', description: 'Path relative to the authorized workspace' },
        old_string: { type: 'string', description: 'Unique text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
      }, ['file_path', 'old_string', 'new_string']),
      approval: 'on-risk',
      execute: editFile,
    })),
    feature('list_dir', defineAgentTool({
      description: 'List entries in a directory inside the authorized workspace.',
      inputSchema: objectSchema({ path: { type: 'string', description: 'Directory path' } }, ['path']),
      approval: 'never',
      execute: listDir,
    })),
    feature('glob', defineAgentTool({
      description: 'Find up to 100 files matching a glob pattern inside the authorized workspace.',
      inputSchema: objectSchema({
        pattern: { type: 'string', description: 'Glob pattern such as **/*.ts' },
        cwd: { type: 'string', description: 'Search directory inside the workspace' },
      }, ['pattern']),
      approval: 'never',
      execute: globFiles,
    })),
    feature('grep', defineAgentTool({
      description: 'Search UTF-8 files by regular expression inside the authorized workspace.',
      inputSchema: objectSchema({
        pattern: { type: 'string', description: 'Regular expression' },
        path: { type: 'string', description: 'File or directory to search' },
        include: { type: 'string', description: 'Optional file glob' },
        ignore_case: { type: 'boolean' },
        limit: { type: 'number', description: 'Maximum matching lines' },
      }, ['pattern']),
      approval: 'never',
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
  if (isImageFile(target)) throw new Error('Use analyze_media for image files');
  const content = await fs.readFile(target, { encoding: 'utf8', signal: context.signal });
  const lines = content.split('\n');
  const offset = nonNegativeInteger(input.offset, 0);
  const limit = nonNegativeInteger(input.limit, lines.length);
  const sliced = lines.slice(offset, offset + limit);
  const numbered = sliced.map((line, index) => `${offset + index + 1} | ${line}`).join('\n');
  return `File: ${target} (${lines.length} lines, showing ${offset + 1}-${Math.min(offset + limit, lines.length)})\n${numbered}`;
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
  return entries.length === 0
    ? `Directory ${target} is empty`
    : entries.sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => `${entry.isDirectory() ? '[DIR]  ' : '       '}${entry.name}`)
      .join('\n');
}

async function globFiles(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const root = authorizedAbsolutePath(input.cwd, context);
  const pattern = requiredString(input.pattern, 'pattern');
  const matches: string[] = [];
  const matcher = globMatcher(pattern);
  for await (const file of walkFiles(root, context.signal)) {
    const relative = slash(path.relative(root, file));
    if (matcher.test(relative)) matches.push(relative);
    if (matches.length >= 100) break;
  }
  return matches.length === 0
    ? `No files matching '${pattern}'`
    : `Found ${matches.length} files:\n${matches.join('\n')}`;
}

async function grepFiles(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
  const root = authorizedAbsolutePath(input.path, context);
  const pattern = requiredString(input.pattern, 'pattern');
  const expression = new RegExp(pattern, input.ignore_case === true ? 'i' : undefined);
  const include = typeof input.include === 'string' && input.include.trim()
    ? globMatcher(input.include)
    : undefined;
  const limit = Math.max(1, nonNegativeInteger(input.limit, 50));
  const stat = await fs.stat(root);
  const files = stat.isDirectory() ? walkFiles(root, context.signal) : singleFile(root);
  const matches: string[] = [];
  for await (const file of files) {
    context.signal.throwIfAborted();
    if (include && !include.test(path.basename(file))) continue;
    let content: string;
    try {
      content = await fs.readFile(file, { encoding: 'utf8', signal: context.signal });
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      expression.lastIndex = 0;
      if (expression.test(lines[index]!)) matches.push(`${slash(path.relative(root, file) || path.basename(file))}:${index + 1}:${lines[index]}`);
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }
  return matches.length === 0 ? `No matches for '${pattern}'` : matches.join('\n');
}

async function* walkFiles(root: string, signal: AbortSignal): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    signal.throwIfAborted();
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(target, signal);
    else if (entry.isFile()) yield target;
  }
}

async function* singleFile(file: string): AsyncGenerator<string> {
  yield file;
}

function authorizedAbsolutePath(value: unknown, context: ToolExecutionContext): string {
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
      source += '.*';
      index += 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function slash(value: string): string {
  return value.split(path.sep).join('/');
}

function objectSchema(properties: Record<string, unknown>, required: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}
