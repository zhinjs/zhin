/**
 * Dependency names the project declares (#1250 `update-unknown-package-reports-success`):
 * `zhin update <name>` without a version runs the manager's update, which silently does nothing
 * for a name nobody declares. The root package.json counts, and in a pnpm workspace
 * (`pnpm-workspace.yaml#packages`) every member package too (`pnpm update -r` updates them).
 */
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies'] as const;

async function namesIn(manifestFile: string, into: Set<string>): Promise<void> {
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>; } catch { return; }
  for (const field of DEPENDENCY_FIELDS) {
    const entries = manifest[field];
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) for (const name of Object.keys(entries)) into.add(name);
  }
}

/** `{a,b}` alternatives expanded into separate globs. */
function expandBraces(glob: string): string[] {
  const match = /\{([^}]+)\}/u.exec(glob);
  if (!match) return [glob];
  return match[1]!.split(',').flatMap(alternative =>
    expandBraces(glob.slice(0, match.index) + alternative.trim() + glob.slice(match.index + match[0].length)));
}

/** `plugins/*` → `['plugins', '*']` (no `!`, `./` or trailing `/`). */
function globSegments(glob: string): string[] {
  return glob.replace(/^!/u, '').replace(/^\.\//u, '').replace(/\/+$/u, '').split('/').filter(segment => segment !== '' && segment !== '.');
}

/** One path segment pattern (`*`, `plugin-?`, `api`) as a regex over a directory name. */
function segmentToRegExp(segment: string): RegExp {
  let source = '';
  for (const char of segment) {
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

/** Whether `relative` (`/`-separated) matches the glob `segments` (`**` is zero or more directories). */
export function matchesWorkspaceGlob(segments: readonly string[], relative: string): boolean {
  const parts = relative.split('/').filter(Boolean);
  const match = (si: number, pi: number): boolean => {
    if (si === segments.length) return pi === parts.length;
    if (segments[si] === '**') {
      for (let next = pi; next <= parts.length; next += 1) if (match(si + 1, next)) return true;
      return false;
    }
    return pi < parts.length && segmentToRegExp(segments[si]!).test(parts[pi]!) && match(si + 1, pi + 1);
  };
  return match(0, 0);
}

/** Directories pnpm never treats as members (and the walk never enters). */
function skipped(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.');
}

async function subdirectories(root: string, relative: string): Promise<string[]> {
  try {
    const entries = await readdir(join(root, ...relative.split('/').filter(Boolean)), { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && !skipped(entry.name)).map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Relative directories matching one include glob, expanded segment by segment: a literal segment
 * enters only that directory, `*` / `?` only matching children, and `**` every directory below
 * that point (pnpm has no depth limit there). Nothing outside the glob's prefix is read.
 */
async function expandGlob(root: string, segments: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  const visit = async (si: number, relative: string): Promise<void> => {
    if (si === segments.length) { if (relative) found.push(relative); return; }
    const segment = segments[si]!;
    const child = (name: string): string => (relative ? `${relative}/${name}` : name);
    if (segment === '**') {
      await visit(si + 1, relative);
      for (const name of await subdirectories(root, relative)) await visit(si, child(name));
      return;
    }
    if (!/[*?]/u.test(segment)) {
      if (!skipped(segment)) await visit(si + 1, child(segment));
      return;
    }
    const pattern = segmentToRegExp(segment);
    for (const name of await subdirectories(root, relative)) if (pattern.test(name)) await visit(si + 1, child(name));
  };
  await visit(0, '');
  return found;
}

async function workspaceGlobs(root: string): Promise<string[]> {
  try {
    const parsed = parseYaml(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')) as { packages?: unknown } | null;
    return Array.isArray(parsed?.packages)
      ? parsed.packages.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map(entry => entry.trim())
      : [];
  } catch {
    return [];
  }
}

/** Relative directories (`/`-separated, sorted) of the workspace's member packages that hold a package.json. */
export async function workspaceMemberDirs(root: string): Promise<string[]> {
  const globs = await workspaceGlobs(root);
  const include = globs.filter(glob => !glob.startsWith('!')).flatMap(expandBraces).map(globSegments);
  const exclude = globs.filter(glob => glob.startsWith('!')).flatMap(glob => expandBraces(glob.slice(1))).map(globSegments);
  const members = new Set<string>();
  for (const segments of include) {
    for (const relative of await expandGlob(root, segments)) {
      if (exclude.some(pattern => matchesWorkspaceGlob(pattern, relative))) continue;
      try { await access(join(root, ...relative.split('/'), 'package.json')); members.add(relative); } catch { /* not a package */ }
    }
  }
  return [...members].sort();
}

/** Names declared by the root package.json and, in a pnpm workspace, by its member packages. */
export async function declaredDependencyNames(root: string): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  await namesIn(join(root, 'package.json'), names);
  for (const relative of await workspaceMemberDirs(root)) await namesIn(join(root, ...relative.split('/'), 'package.json'), names);
  return names;
}
