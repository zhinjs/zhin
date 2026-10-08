import { access, lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Align with Remote Console file manager (paths relative to project root). */
export const FILE_MANAGER_ALLOWED = Object.freeze([
  'src',
  'plugins',
  'client',
  // Plugin Runtime convention directories (file-based discovery)
  'commands',
  'adapters',
  'components',
  'middlewares',
  'tools',
  'mcp',
  'pages',
  'skills',
  'agents',
  'package.json',
  'tsconfig.json',
  'zhin.config.yml',
  'config.yml',
  'config.yaml',
  'config.json',
  '.env',
  '.env.development',
  '.env.production',
  'README.md',
]);

export const FILE_MANAGER_BLOCKED = Object.freeze(new Set([
  'node_modules',
  '.git',
  '.env.local',
  'data',
  'lib',
  'dist',
  'coverage',
]));

export type FileTreeNode = {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly children?: readonly FileTreeNode[];
};

export function isProjectPathAllowed(relativePath: string): boolean {
  if (relativePath.includes('..') || path.isAbsolute(relativePath)) return false;
  const normalized = relativePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (normalized.split('/').some((segment) => FILE_MANAGER_BLOCKED.has(segment))) return false;
  return FILE_MANAGER_ALLOWED.some(
    (allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`),
  );
}

export async function buildProjectFileTree(projectRoot: string): Promise<FileTreeNode[]> {
  const tree: FileTreeNode[] = [];
  for (const entry of FILE_MANAGER_ALLOWED) {
    if (entry.includes('/')) continue;
    const absPath = await resolveAllowedPath(projectRoot, entry);
    if (!absPath) continue;
    if (!(await pathExists(absPath))) continue;
    const info = await safeStat(absPath);
    if (!info) continue;
    if (info.isDirectory()) {
      tree.push({
        name: entry,
        path: entry,
        type: 'directory',
        children: await buildDirectoryTree(projectRoot, entry, 3),
      });
    } else if (info.isFile()) {
      tree.push({ name: entry, path: entry, type: 'file' });
    }
  }
  return tree.sort(compareTreeNodes);
}

export async function readProjectFile(
  projectRoot: string,
  relativePath: string,
): Promise<{ content: string; size: number }> {
  const absPath = await resolveAllowedPath(projectRoot, relativePath);
  if (!absPath) throw new Error(`Access denied: ${relativePath}`);
  if (!(await pathExists(absPath))) throw new Error(`File not found: ${relativePath}`);
  const info = await safeStat(absPath);
  if (!info?.isFile()) throw new Error(`Not a file: ${relativePath}`);
  if (info.size > 1024 * 1024) {
    throw new Error(`File too large: ${(info.size / 1024).toFixed(0)}KB (max 1MB)`);
  }
  const content = await readFile(absPath, 'utf8');
  return { content, size: info.size };
}

export async function saveProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absPath = await resolveAllowedPath(projectRoot, relativePath);
  if (!absPath) throw new Error(`Access denied: ${relativePath}`);
  await mkdir(path.dirname(absPath), { recursive: true });
  const checkedPath = await resolveAllowedPath(projectRoot, relativePath);
  if (!checkedPath) throw new Error(`Access denied: ${relativePath}`);
  await writeFile(checkedPath, content, 'utf8');
}

export async function listEnvFiles(
  projectRoot: string,
): Promise<readonly { name: string; exists: boolean }[]> {
  const names = ['.env', '.env.development', '.env.production'] as const;
  const result = await Promise.all(names.map(async (name) => {
    const resolved = await resolveAllowedPath(projectRoot, name);
    return { name, exists: resolved !== null && await pathExists(resolved) };
  }));
  return Object.freeze(result);
}

/** Resolve existing links, or the nearest existing parent for a new file. */
async function resolveAllowedPath(projectRoot: string, relativePath: string): Promise<string | null> {
  if (!isProjectPathAllowed(relativePath)) return null;
  try {
    const root = await realpath(projectRoot);
    let candidate = path.resolve(root, relativePath);
    const missing: string[] = [];
    for (;;) {
      try {
        // A dangling link must fail closed rather than be treated as a missing directory.
        await lstat(candidate);
        const resolved = path.resolve(await realpath(candidate), ...missing);
        const relative = path.relative(root, resolved);
        return isProjectPathAllowed(relative) ? resolved : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
        // lstat succeeds for dangling symlinks even though realpath fails.
        try { await lstat(candidate); return null; } catch (missingError) {
          if ((missingError as NodeJS.ErrnoException).code !== 'ENOENT') return null;
        }
        const parent = path.dirname(candidate);
        if (candidate === root || parent === candidate) return null;
        missing.unshift(path.basename(candidate));
        candidate = parent;
      }
    }
  } catch {
    return null;
  }
}

async function buildDirectoryTree(
  projectRoot: string,
  relativePath: string,
  maxDepth: number,
): Promise<FileTreeNode[]> {
  if (maxDepth <= 0) return [];
  const absDir = await resolveAllowedPath(projectRoot, relativePath);
  if (!absDir) return [];
  const info = await safeStat(absDir);
  if (!info?.isDirectory()) return [];
  const entries = await readdir(absDir, { withFileTypes: true });
  const result: FileTreeNode[] = [];
  for (const entry of entries) {
    if (FILE_MANAGER_BLOCKED.has(entry.name) || entry.name.startsWith('.')) continue;
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const childPath = await resolveAllowedPath(projectRoot, childRelative);
    if (!childPath) continue;
    const childInfo = await safeStat(childPath);
    if (childInfo?.isDirectory()) {
      result.push({
        name: entry.name,
        path: childRelative,
        type: 'directory',
        children: await buildDirectoryTree(projectRoot, childRelative, maxDepth - 1),
      });
    } else if (childInfo?.isFile()) {
      result.push({ name: entry.name, path: childRelative, type: 'file' });
    }
  }
  return result.sort(compareTreeNodes);
}

function compareTreeNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}
