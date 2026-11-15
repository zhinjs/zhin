/**
 * Member packages of a pnpm workspace (#1250 `migrate-skips-workspace-packages`): `zhin migrate`
 * upgrades their Zhin dependencies with the root, and doctor names which of them pulls in a second
 * copy of a Zhin package. The member list comes from `pnpm-workspace.yaml#packages` globs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const WORKSPACE_FILE = 'pnpm-workspace.yaml';
// Directory levels searched below the root (plugins/<x> is 2, packages/<x>/<y> is 3).
const MAX_DEPTH = 5;

/** `packages:` globs of `root/pnpm-workspace.yaml`; empty when there is none or it cannot be read. */
export function workspacePackageGlobs(root: string): string[] {
  try {
    const parsed = parse(fs.readFileSync(path.join(root, WORKSPACE_FILE), 'utf8')) as { packages?: unknown } | null;
    return Array.isArray(parsed?.packages)
      ? parsed.packages.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map(entry => entry.trim())
      : [];
  } catch {
    return [];
  }
}

/** A pnpm workspace glob (`plugins/*`, `packages/**`, `apps/web`, `!**\/test/**`) as a regex over `/`-separated paths. */
export function workspaceGlobToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/^!/u, '').replace(/^\.\//u, '').replace(/\/+$/u, '');
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === '*' && pattern[index + 1] === '*') {
      // `**/` matches zero or more directories; a trailing `**` any depth.
      if (pattern[index + 2] === '/') { source += '(?:[^/]+/)*'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

/**
 * Directories (absolute, sorted) of the workspace's member packages: matched by a `packages` glob,
 * not by a `!` exclusion, holding a `package.json`; the root itself and `node_modules` are skipped.
 */
export function listWorkspacePackageDirs(root: string): string[] {
  const globs = workspacePackageGlobs(root);
  const include = globs.filter(glob => !glob.startsWith('!')).map(workspaceGlobToRegExp);
  const exclude = globs.filter(glob => glob.startsWith('!')).map(workspaceGlobToRegExp);
  if (include.length === 0) return [];
  const found: string[] = [];
  const walk = (relative: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (include.some(regex => regex.test(child)) && !exclude.some(regex => regex.test(child))
        && fs.existsSync(path.join(root, child, 'package.json'))) {
        found.push(path.join(root, ...child.split('/')));
      }
      walk(child, depth + 1);
    }
  };
  walk('', 1);
  return found.sort();
}

/** `plugins/foo` for a member directory (always `/`-separated). */
export function workspaceRelative(root: string, dir: string): string {
  return path.relative(root, dir).split(path.sep).join('/');
}
