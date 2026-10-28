/**
 * Host self-configuration paths (#1030 P0).
 *
 * Writing these reconfigures the host itself: its config, its dependencies (and so the code it
 * runs), its instructions. Two classes, both matched against the **canonical** (symlink-resolved,
 * `..`-collapsed, case-folded) path:
 *
 *  - `deny` (list A): never writable by the agent, no approval card. `node_modules/**` at any
 *    depth, package-manager lockfiles under the project root, host-declared files such as the
 *    plugin lifecycle store, and everything `file-policy.ts#checkFileAccess` already refuses
 *    (`.env*`, `.zhin/**`, root `data/**`, `config.json`, `.npmrc`, keys…) — so a shell write to
 *    those is denied the same way a file tool is.
 *  - `self` (list B): dangerous `self` hard-gate operation — a fresh human approval every time,
 *    never granted by bypass, the auto reviewer, owner exemption or a remembered approval.
 *    Anchored to the **project root**, not to any path segment, so `plugins/x/package.json` is
 *    an ordinary workspace file.
 *
 * Not managed in P0: `pnpm-workspace.yaml`, `tsconfig*.json`.
 *
 * The project root and host-declared extras are injected by the host through
 * {@link hostProtectedPathsToken} (the agent package cannot read `basic/cli`). When nothing was
 * injected the matcher fails **closed**: it cannot anchor, so list B degrades to "this name at any
 * depth" instead of gating nothing.
 */
import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { ROOT_CONFIG_FILE_NAMES, createToken } from '@zhin.js/plugin-runtime';
import { checkFileAccess } from './file-policy.js';
import { classifyBashFileOperation } from './file-role-policy.js';

export type HostPathClass = 'deny' | 'self';

/** Lockfiles: pinned dependency state (list A). */
export const LOCKFILE_NAMES: readonly string[] = Object.freeze([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json',
]);

/**
 * List B files directly under the project root.
 *  - root config candidates (`ROOT_CONFIG_FILE_NAMES`), `package.json`, `schema.json`, `AGENTS.md`;
 *  - `.pnpmfile.cjs` / `.pnpmfile.js`: runs arbitrary code on the next `pnpm install`;
 *  - `assistant.profile.yml|yaml`: standing routines that run unattended.
 * The root plugin entry (`package.json#zhin.entry`) is host-declared, see {@link HostProtectedPathsInput}.
 */
export const DEFAULT_SELF_FILES: readonly string[] = Object.freeze([
  ...ROOT_CONFIG_FILE_NAMES, 'package.json', 'schema.json', 'AGENTS.md',
  '.pnpmfile.cjs', '.pnpmfile.js', 'assistant.profile.yml', 'assistant.profile.yaml',
]);

/**
 * List B directories under the project root (everything below them):
 *  - `skills`, `.agents/skills`: the skill / instruction convention dirs the agent loads
 *    (`discovery/utils.ts#buildStandardSkillDirs`; `~/.zhin/skills` is outside the project);
 *  - `.git`: hooks run code on the next git command.
 */
export const DEFAULT_SELF_DIRS: readonly string[] = Object.freeze(['skills', '.agents/skills', '.git']);

export interface HostProtectedPathsInput {
  /** Project root (the directory holding the root config and `package.json`). */
  readonly projectRoot: string;
  /** Extra list-B files, relative to the root or absolute (e.g. the root plugin entry `zhin.entry`). */
  readonly selfFiles?: readonly string[];
  /** Extra list-B directories, relative to the root or absolute. */
  readonly selfDirs?: readonly string[];
  /** Extra list-A files, absolute (e.g. the file `ZHIN_PLUGIN_LIFECYCLE_FILE` points at). */
  readonly denyFiles?: readonly string[];
}

/** Resolved, case-folded, canonical form of {@link HostProtectedPathsInput}. */
export interface HostProtectedPaths {
  /** Canonical root first, lexical root second (when they differ). Case-folded, posix separators. */
  readonly roots: readonly string[];
  /** Root-relative (case-folded, posix) list-B files. */
  readonly selfFiles: ReadonlySet<string>;
  /** Root-relative list-B directories. */
  readonly selfDirs: readonly string[];
  /** Absolute list-A files. */
  readonly denyFiles: ReadonlySet<string>;
}

function fold(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

/**
 * Drop trailing `/` characters (keeping a lone `/`). Linear scan instead of
 * `/\/+$/` — that regex backtracks polynomially on inputs with many `/` (ReDoS).
 */
function stripTrailingSlash(value: string): string {
  if (value.length <= 1) return value;
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return value.slice(0, end);
}

function canonicalizeSync(target: string): string {
  const missing: string[] = [];
  let cursor = path.resolve(target);
  for (;;) {
    try {
      return path.join(realpathSync(cursor), ...missing.reverse());
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.join(cursor, ...missing.reverse());
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function canonicalize(target: string): Promise<string> {
  const missing: string[] = [];
  let cursor = path.resolve(target);
  for (;;) {
    try {
      return path.join(await realpath(cursor), ...missing.reverse());
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.join(cursor, ...missing.reverse());
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function relativeTo(rootFolded: string, folded: string): string | undefined {
  if (folded === rootFolded) return '';
  const prefix = rootFolded === '/' ? '/' : `${rootFolded}/`;
  return folded.startsWith(prefix) ? folded.slice(prefix.length) : undefined;
}

/** Builds the matcher input; resolves the project root through symlinks. */
export async function createHostProtectedPaths(input: HostProtectedPathsInput): Promise<HostProtectedPaths> {
  const lexicalRoot = path.resolve(input.projectRoot);
  const canonicalRoot = await canonicalize(lexicalRoot);
  const roots = [...new Set([fold(canonicalRoot), fold(lexicalRoot)].map(stripTrailingSlash))];
  const relativeToRoot = (entry: string): string => {
    const abs = path.isAbsolute(entry) ? entry : path.join(lexicalRoot, entry);
    const folded = stripTrailingSlash(fold(path.normalize(abs)));
    for (const root of roots) {
      const rel = relativeTo(root, folded);
      if (rel) return rel;
    }
    return stripTrailingSlash(fold(path.normalize(entry))).replace(/^\.\//u, '');
  };
  const deny = new Set<string>();
  for (const file of input.denyFiles ?? []) {
    deny.add(stripTrailingSlash(fold(path.resolve(file))));
    deny.add(stripTrailingSlash(fold(await canonicalize(file))));
  }
  return Object.freeze({
    roots: Object.freeze(roots),
    selfFiles: new Set([...DEFAULT_SELF_FILES, ...(input.selfFiles ?? [])].map(relativeToRoot)),
    selfDirs: Object.freeze([...DEFAULT_SELF_DIRS, ...(input.selfDirs ?? [])].map(relativeToRoot)),
    denyFiles: deny,
  });
}

/**
 * Generation-scoped host injection: `installAgentHost` provides the value on the generation's
 * resource scope, so it is disposed and rebuilt with the generation. Absent (tests, embedders) the
 * matcher fails closed, see the module comment.
 */
export const hostProtectedPathsToken = createToken<HostProtectedPaths>('zhin.agent.host-protected-paths');

/**
 * Classifies one path. `paths` is `undefined` when the host injected nothing (fail-closed fallback).
 * `base` resolves relative paths (default: the project root, or the cwd without one). Symlinks are resolved here too, so a link inside the workspace that
 * points at a protected file is classified as that file.
 */
export function classifyHostPath(
  filePath: string,
  paths: HostProtectedPaths | undefined,
  base?: string,
): HostPathClass | undefined {
  const raw = filePath.trim();
  if (!raw) return undefined;
  const unified = raw.replace(/\\/g, '/');
  const windowsAbsolute = /^[a-z]:\//iu.test(unified);
  const anchor = base?.trim() || (paths ? paths.roots[0]! : process.cwd());
  const lexical = path.isAbsolute(unified) || windowsAbsolute
    ? path.normalize(unified)
    : path.resolve(anchor, unified);
  const canonical = canonicalizeSync(lexical);
  const policyRoot = paths ? paths.roots[0] : undefined;
  for (const form of [lexical, canonical, fold(lexical), fold(canonical)]) {
    if (!checkFileAccess(form, policyRoot).allowed) return 'deny';
  }
  const candidates = new Set([fold(lexical), fold(canonical)].map(stripTrailingSlash));
  let result: HostPathClass | undefined;
  for (const candidate of candidates) {
    const cls = classifyFolded(candidate, paths);
    if (cls === 'deny') return 'deny';
    result ??= cls;
  }
  return result;
}

function classifyFolded(folded: string, paths: HostProtectedPaths | undefined): HostPathClass | undefined {
  const segments = folded.split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  if (segments.includes('node_modules')) return 'deny';
  if (paths?.denyFiles.has(folded)) return 'deny';
  if (!paths) {
    // Fail closed: nothing to anchor to, so the same names match at any depth.
    if (LOCKFILE_NAMES.includes(name)) return 'deny';
    if (segments.includes('.git')) return 'self';
    return DEFAULT_SELF_FILES.some(file => file.toLowerCase() === name) ? 'self' : undefined;
  }
  for (const root of paths.roots) {
    const rel = relativeTo(root, folded);
    if (rel === undefined || rel === '') continue;
    if (LOCKFILE_NAMES.includes(rel)) return 'deny';
    if (paths.selfFiles.has(rel)) return 'self';
    if (paths.selfDirs.some(dir => rel === dir || rel.startsWith(`${dir}/`))) return 'self';
  }
  return undefined;
}

/** What a tool call would write, and how that is classified. */
export interface HostWriteImpact {
  readonly level: HostPathClass;
  readonly target: string;
}

/** Native file tools that create, change or delete the file named by `file_path`. */
const FILE_WRITE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'apply_patch']);

function stringArg(input: Readonly<Record<string, unknown>>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/**
 * Package-manager commands that change installed dependencies (lockfile, `node_modules`,
 * `package.json`). They are `self` — a person can approve an install — never silently allowed.
 */
const DEPENDENCY_CHANGE = /(?:^|[;&|]\s*)(?:pnpm|npm|yarn|bun)\s+(?:-\S+\s+)*(?:add|install|i|remove|rm|uninstall|un|update|up|upgrade|link|unlink|patch-commit|dlx)\b/iu;

/** Commands that write files but which `classifyBashFileOperation` does not classify as writes. */
const FILE_MUTATING_VERB = /(?:^|[;&|(]\s*|\bsudo\s+|\bxargs\s+)(?:rm|rmdir|unlink|mv|cp|ln|touch|truncate|dd|rsync|install|chmod|chown|patch)\b/iu;

/** Strip leading `=`/`:` and trailing `,`/`:` without a regex (avoids ReDoS on long comma runs). */
function stripShellPunctuation(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && (word[start] === '=' || word[start] === ':')) start += 1;
  while (end > start && (word[end - 1] === ',' || word[end - 1] === ':')) end -= 1;
  return word.slice(start, end);
}

const SHELL_WORD_BREAK = new Set([' ', '\t', '\n', '\r', ';', '&', '|', '<', '>', '(', ')', '`', '$', "'", '"']);

/** Words of a shell command that could name a file (quotes and redirections stripped). */
function commandWords(command: string): string[] {
  const words: string[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const cleaned = stripShellPunctuation(buf);
    if (cleaned) words.push(cleaned);
    buf = '';
  };
  for (const ch of command) {
    if (SHELL_WORD_BREAK.has(ch)) flush();
    else buf += ch;
  }
  flush();
  return words;
}

function strongest(
  candidates: Iterable<string>,
  paths: HostProtectedPaths | undefined,
  base: string | undefined,
): HostWriteImpact | undefined {
  let self: HostWriteImpact | undefined;
  for (const target of candidates) {
    const level = classifyHostPath(target, paths, base);
    if (level === 'deny') return { level, target };
    if (level === 'self') self ??= { level, target };
  }
  return self;
}

/**
 * The protected path this tool call would write, if any. File tools are judged by their
 * (already canonicalized) target path; a shell command that writes and names such a path counts
 * too. `deny` beats `self` when a command names both.
 */
export function hostWriteImpact(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  paths: HostProtectedPaths | undefined,
): HostWriteImpact | undefined {
  const localName = toolName.split(/[.:/]/u).pop() ?? toolName;
  if (FILE_WRITE_TOOLS.has(localName)) {
    const target = stringArg(input, 'file_path', 'path', 'filePath');
    return target ? strongest([target], paths, undefined) : undefined;
  }
  if (localName !== 'bash') return undefined;
  const command = stringArg(input, 'command');
  if (!command) return undefined;
  const cwd = stringArg(input, 'cwd');
  const base = cwd && path.isAbsolute(cwd) ? cwd : undefined;
  const named: string[] = [];
  // Redirections and tee write whatever they name, whatever the command classifies as.
  for (const match of command.matchAll(/(?:\d?>>?|\btee\s+(?:-a\s+)?)\s*["']?([^\s;&|"']+)/gu)) named.push(match[1]!);
  // Judge each command of a pipeline / list on its own: `cat pnpm-lock.yaml | head` only reads.
  for (const segment of command.split(/&&|\|\||[;&|\n]/u)) {
    const operation = classifyBashFileOperation(segment);
    if ((operation !== null && operation !== 'read') || FILE_MUTATING_VERB.test(segment)) {
      named.push(...commandWords(segment));
    }
  }
  const hit = strongest(named, paths, base);
  if (hit?.level === 'deny') return hit;
  if (DEPENDENCY_CHANGE.test(command)) return { level: 'self', target: 'package.json' };
  return hit;
}

/** The protected path (any class) a tool call would write, for audit payloads. */
export function hostConfigWriteTarget(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  paths: HostProtectedPaths | undefined,
): string | undefined {
  return hostWriteImpact(toolName, input, paths)?.target;
}
