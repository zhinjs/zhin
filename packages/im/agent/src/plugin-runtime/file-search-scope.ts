import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Directories that are never source an agent should scan implicitly: dependency
 * trees, VCS internals, agent/runtime state, and conventional build outputs whose
 * name is unambiguous. Ambiguous names such as `lib` or `build` are excluded only
 * when a `.gitignore` says so.
 */
export const DEFAULT_EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.opencode',
  '.zhin',
  'dist',
  'coverage',
  '.turbo',
  '.next',
  '.nuxt',
  '.cache',
]);

interface IgnoreRule {
  readonly regex: RegExp;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
}

interface IgnoreScope {
  readonly base: string;
  readonly rules: readonly IgnoreRule[];
}


/**
 * Depth-first, name-sorted file walk below `root`. Default-excluded directories
 * and `.gitignore` matches are skipped only *below* the root, so pointing a tool
 * directly at e.g. `node_modules/pkg` is an explicit opt-in that still works.
 */
export async function* walkWorkspaceFiles(
  root: string,
  workspaceRoot: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  yield* walk(root, await inheritedIgnoreScopes(root, workspaceRoot), signal);
}

async function* walk(directory: string, inherited: readonly IgnoreScope[], signal: AbortSignal): AsyncGenerator<string> {
  signal.throwIfAborted();
  const local = await readIgnoreScope(directory);
  const scopes = local ? [...inherited, local] : inherited;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    signal.throwIfAborted();
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUDED_DIRS.has(entry.name) || isIgnored(scopes, target, true)) continue;
      yield* walk(target, scopes, signal);
    } else if (entry.isFile() && !isIgnored(scopes, target, false)) {
      yield target;
    }
  }
}

/** Collect `.gitignore` files from ancestors inside the workspace so a sub-path search honours them. */
async function inheritedIgnoreScopes(root: string, workspaceRoot: string): Promise<readonly IgnoreScope[]> {
  const scopes: IgnoreScope[] = [];
  let current = root;
  while (current !== workspaceRoot && isInside(workspaceRoot, current)) {
    current = path.dirname(current);
    const scope = await readIgnoreScope(current);
    if (scope) scopes.unshift(scope);
  }
  return scopes;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readIgnoreScope(directory: string): Promise<IgnoreScope | undefined> {
  let content: string;
  try {
    content = await fs.readFile(path.join(directory, '.gitignore'), 'utf8');
  } catch {
    return undefined;
  }
  const rules = content.split(/\r?\n/).map(parseIgnoreRule).filter((rule): rule is IgnoreRule => rule != null);
  return rules.length > 0 ? { base: directory, rules } : undefined;
}

/** Parse the commonly used subset of gitignore syntax: `!`, leading/trailing `/`, `*`, `**`, `?`. */
export function parseIgnoreRule(line: string): IgnoreRule | undefined {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith('#')) return undefined;
  const negated = pattern.startsWith('!');
  if (negated) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith('/');
  pattern = pattern.replace(/\/+$/, '');
  const anchored = pattern.includes('/');
  pattern = pattern.replace(/^\//, '');
  if (!pattern) return undefined;
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '*' && pattern[index + 1] === '*') {
      source += pattern[index + 2] === '/' ? '(?:.*/)?' : '.*';
      index += pattern[index + 2] === '/' ? 2 : 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+.]/g, '\\$&');
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  return { regex: new RegExp(`${prefix}${source}$`), negated, directoryOnly };
}

function isIgnored(scopes: readonly IgnoreScope[], target: string, isDirectory: boolean): boolean {
  let ignored = false;
  for (const scope of scopes) {
    const relative = path.relative(scope.base, target).split(path.sep).join('/');
    if (!relative || relative.startsWith('..')) continue;
    for (const rule of scope.rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.regex.test(relative)) ignored = !rule.negated;
    }
  }
  return ignored;
}
