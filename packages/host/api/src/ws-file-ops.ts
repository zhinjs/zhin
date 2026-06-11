/**
 * WebSocket 文件操作模块
 * 从 websocket.ts 提取的文件系统操作
 */

import fs from "node:fs";
import path from "node:path";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

const FILE_MANAGER_BLOCKED = new Set([
  "node_modules",
  ".git",
  ".env.local",
  "data",
]);

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

export function isPathAllowed(relativePath: string): boolean {
  if (!relativePath) return true;
  const normalized = relativePath.replace(/\\/g, "/");
  return FILE_MANAGER_ALLOWED.some(
    (pattern) => normalized === pattern || normalized.startsWith(pattern + "/"),
  );
}

export function getConfigFilePath(): string {
  const cwd = process.cwd();
  for (const name of ["zhin.config.yml", "zhin.config.yaml", "zhin.config.json"]) {
    const full = path.join(cwd, name);
    if (fs.existsSync(full)) return full;
  }
  return path.join(cwd, "zhin.config.yml");
}

export function buildFileTree(cwd: string, relativePath: string, allowed: string[]): FileTreeNode[] {
  const tree: FileTreeNode[] = [];

  for (const entry of allowed) {
    if (relativePath && !entry.startsWith(relativePath + "/")) continue;
    const entryRelative = relativePath ? entry.slice(relativePath.length + 1) : entry;
    if (entryRelative.includes("/")) continue;

    const absPath = path.resolve(cwd, entry);
    if (!fs.existsSync(absPath)) continue;

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      tree.push({
        name: entryRelative,
        path: entry,
        type: "directory",
        children: buildDirectoryTree(cwd, entry, 3),
      });
    } else if (stat.isFile()) {
      tree.push({ name: entryRelative, path: entry, type: "file" });
    }
  }

  return tree.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function buildDirectoryTree(cwd: string, relativePath: string, maxDepth: number): FileTreeNode[] {
  if (maxDepth <= 0) return [];
  const absDir = path.resolve(cwd, relativePath);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const result: FileTreeNode[] = [];

  for (const entry of entries) {
    if (FILE_MANAGER_BLOCKED.has(entry.name) || entry.name.startsWith(".")) continue;
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: childRelative,
        type: "directory",
        children: buildDirectoryTree(cwd, childRelative, maxDepth - 1),
      });
    } else if (entry.isFile()) {
      result.push({ name: entry.name, path: childRelative, type: "file" });
    }
  }

  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
