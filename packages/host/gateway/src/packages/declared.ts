/**
 * Dependency names the project declares (#1250 `update-unknown-package-reports-success`):
 * `zhin update <name>` without a version runs the manager's update, which silently does nothing
 * for a name nobody declares. The root package.json counts, and in a pnpm workspace
 * (`pnpm-workspace.yaml#packages`) every member package too (`pnpm update -r` updates them).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies'] as const;
// Directory levels searched below the root (plugins/<x> is 2, packages/<x>/<y> is 3).
const MAX_DEPTH = 5;

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

/** A pnpm workspace glob (`plugins/*`, `packages/**`, `apps/web`) as a regex over `/`-separated paths. */
function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/^!/u, '').replace(/^\.\//u, '').replace(/\/+$/u, '');
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { source += '(?:[^/]+/)*'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
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

/** Names declared by the root package.json and, in a pnpm workspace, by its member packages. */
export async function declaredDependencyNames(root: string): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  await namesIn(join(root, 'package.json'), names);
  const globs = await workspaceGlobs(root);
  const include = globs.filter(glob => !glob.startsWith('!')).flatMap(expandBraces).map(globToRegExp);
  const exclude = globs.filter(glob => glob.startsWith('!')).flatMap(glob => expandBraces(glob.slice(1))).map(globToRegExp);
  if (include.length === 0) return names;
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = await readdir(join(root, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (include.some(regex => regex.test(child)) && !exclude.some(regex => regex.test(child))) {
        await namesIn(join(root, ...child.split('/'), 'package.json'), names);
      }
      await walk(child, depth + 1);
    }
  };
  await walk('', 1);
  return names;
}
