import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Align with Remote Console file manager (paths relative to project root). */
export const FILE_MANAGER_ALLOWED = Object.freeze([
  'src',
  'plugins',
  'client',
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
  const firstSegment = normalized.split('/')[0] ?? '';
  if (FILE_MANAGER_BLOCKED.has(firstSegment)) return false;
  return FILE_MANAGER_ALLOWED.some(
    (allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`),
  );
}

export async function buildProjectFileTree(projectRoot: string): Promise<FileTreeNode[]> {
  const tree: FileTreeNode[] = [];
  for (const entry of FILE_MANAGER_ALLOWED) {
    if (entry.includes('/')) continue;
    const absPath = path.resolve(projectRoot, entry);
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
  const absPath = resolveAllowedPath(projectRoot, relativePath);
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
  const absPath = resolveAllowedPath(projectRoot, relativePath);
  if (!absPath) throw new Error(`Access denied: ${relativePath}`);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf8');
}

export async function listEnvFiles(
  projectRoot: string,
): Promise<readonly { name: string; exists: boolean }[]> {
  const names = ['.env', '.env.development', '.env.production'] as const;
  const result = await Promise.all(names.map(async (name) => ({
    name,
    exists: await pathExists(path.resolve(projectRoot, name)),
  })));
  return Object.freeze(result);
}

function resolveAllowedPath(projectRoot: string, relativePath: string): string | null {
  if (!isProjectPathAllowed(relativePath)) return null;
  return path.resolve(projectRoot, relativePath);
}

async function buildDirectoryTree(
  projectRoot: string,
  relativePath: string,
  maxDepth: number,
): Promise<FileTreeNode[]> {
  if (maxDepth <= 0) return [];
  const absDir = path.resolve(projectRoot, relativePath);
  const info = await safeStat(absDir);
  if (!info?.isDirectory()) return [];
  const entries = await readdir(absDir, { withFileTypes: true });
  const result: FileTreeNode[] = [];
  for (const entry of entries) {
    if (FILE_MANAGER_BLOCKED.has(entry.name) || entry.name.startsWith('.')) continue;
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: childRelative,
        type: 'directory',
        children: await buildDirectoryTree(projectRoot, childRelative, maxDepth - 1),
      });
    } else if (entry.isFile()) {
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
