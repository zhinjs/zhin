import path from "node:path";
import type { ProjectFs } from "./context.js";

/** 与 Remote Console 文件管理器一致（相对项目根） */
export const FILE_MANAGER_ALLOWED = [
  "src",
  "plugins",
  "client",
  "package.json",
  "tsconfig.json",
  "zhin.config.yml",
  ".env",
  ".env.development",
  ".env.production",
  "README.md",
];

export const FILE_MANAGER_BLOCKED = new Set([
  "node_modules",
  ".git",
  ".env.local",
  "data",
  "lib",
  "dist",
  "coverage",
]);

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

export function isProjectPathAllowed(relativePath: string): boolean {
  if (relativePath.includes("..") || path.isAbsolute(relativePath)) return false;
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const firstSegment = normalized.split("/")[0];
  if (FILE_MANAGER_BLOCKED.has(firstSegment)) return false;
  return FILE_MANAGER_ALLOWED.some(
    (p) => normalized === p || normalized.startsWith(p + "/"),
  );
}

export function resolveProjectFilePath(projectFs: ProjectFs, relativePath: string): string | null {
  if (!isProjectPathAllowed(relativePath)) return null;
  return path.resolve(projectFs.cwd(), relativePath);
}

export function buildProjectFileTree(projectFs: ProjectFs): FileTreeNode[] {
  const cwd = projectFs.cwd();
  return buildFileTree(cwd, "", FILE_MANAGER_ALLOWED, projectFs);
}

export function readProjectFile(
  projectFs: ProjectFs,
  relativePath: string,
): { content: string; size: number } {
  const absPath = resolveProjectFilePath(projectFs, relativePath);
  if (!absPath) throw new Error(`Access denied: ${relativePath}`);
  if (!projectFs.exists(absPath)) throw new Error(`File not found: ${relativePath}`);
  const stat = projectFs.stat(absPath);
  if (!stat?.isFile) throw new Error(`Not a file: ${relativePath}`);
  if (stat.size > 1024 * 1024) {
    throw new Error(`File too large: ${(stat.size / 1024).toFixed(0)}KB (max 1MB)`);
  }
  return { content: projectFs.readText(absPath), size: stat.size };
}

export function saveProjectFile(
  projectFs: ProjectFs,
  relativePath: string,
  content: string,
): void {
  const absPath = resolveProjectFilePath(projectFs, relativePath);
  if (!absPath) throw new Error(`Access denied: ${relativePath}`);
  projectFs.mkdirp(path.dirname(absPath));
  projectFs.writeText(absPath, content);
}

function buildFileTree(
  cwd: string,
  relativePath: string,
  allowed: string[],
  projectFs: ProjectFs,
): FileTreeNode[] {
  const tree: FileTreeNode[] = [];

  for (const entry of allowed) {
    if (relativePath && !entry.startsWith(relativePath + "/")) continue;
    const entryRelative = relativePath ? entry.slice(relativePath.length + 1) : entry;
    if (entryRelative.includes("/")) continue;

    const absPath = path.resolve(cwd, entry);
    if (!projectFs.exists(absPath)) continue;

    const stat = projectFs.stat(absPath);
    if (!stat) continue;
    if (stat.isDirectory) {
      tree.push({
        name: entryRelative,
        path: entry,
        type: "directory",
        children: buildDirectoryTree(cwd, entry, 3, projectFs),
      });
    } else if (stat.isFile) {
      tree.push({ name: entryRelative, path: entry, type: "file" });
    }
  }

  return tree.sort(compareTreeNodes);
}

function buildDirectoryTree(
  cwd: string,
  relativePath: string,
  maxDepth: number,
  projectFs: ProjectFs,
): FileTreeNode[] {
  if (maxDepth <= 0) return [];
  const absDir = path.resolve(cwd, relativePath);
  const dirStat = projectFs.stat(absDir);
  if (!dirStat?.isDirectory) return [];

  const result: FileTreeNode[] = [];
  for (const entry of projectFs.readDir(absDir)) {
    if (FILE_MANAGER_BLOCKED.has(entry.name) || entry.name.startsWith(".")) continue;
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      result.push({
        name: entry.name,
        path: childRelative,
        type: "directory",
        children: buildDirectoryTree(cwd, childRelative, maxDepth - 1, projectFs),
      });
    } else if (entry.isFile) {
      result.push({ name: entry.name, path: childRelative, type: "file" });
    }
  }

  return result.sort(compareTreeNodes);
}

function compareTreeNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}
