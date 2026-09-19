/**
 * 发现模块共用的工具函数
 *
 * 被 builtin-tools 与 discovery/tools、skills、agents 共同依赖，
 * 独立出来以避免循环导入。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 将 unknown 错误转为字符串 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 机器人项目根（`ZHIN_PROJECT_ROOT` 或 cwd） */
export function workspaceRoot(): string {
  const env = process.env.ZHIN_PROJECT_ROOT?.trim();
  return env ? path.resolve(env) : process.cwd();
}

/** 获取 data/ 目录路径，自动创建 */
export function getDataDir(): string {
  const dir = path.join(workspaceRoot(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 展开路径中的 ~ 为实际 home 目录 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function findGitRoot(start = process.cwd()): string | null {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `.agents/skills` 从 cwd 向上遍历至 git root（ADR 0010） */
export function collectAgentsSkillsDirs(start = process.cwd()): string[] {
  const dirs: string[] = [];
  const gitRoot = findGitRoot(start);
  let dir = start;
  for (;;) {
    dirs.push(path.join(dir, '.agents', 'skills'));
    if (gitRoot && dir === gitRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** Workspace / ~/.zhin / .agents/skills 根目录（与 activate_skill 扫描顺序一致的前缀） */
export function buildStandardSkillDirs(): string[] {
  const list = [
    path.join(workspaceRoot(), 'skills'),
    path.join(os.homedir(), '.zhin', 'skills'),
    ...collectAgentsSkillsDirs(workspaceRoot()),
  ];
  return [...new Set(list)];
}

/**
 * 技能发现与 activate_skill 查找共用：标准目录 + 已加载插件包 skills/
 */
/** zhin-package 安装目录下的 skills 路径 */
export function collectZhinPackageSkillRoots(): string[] {
  const roots: string[] = [];
  const bases = [
    path.join(os.homedir(), '.zhin', 'packages'),
    path.join(workspaceRoot(), '.zhin', 'packages'),
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const skills = path.join(dir, 'skills');
      const repoSkills = path.join(dir, 'repo', 'skills');
      if (fs.existsSync(skills)) roots.push(skills);
      if (fs.existsSync(repoSkills)) roots.push(repoSkills);
    }
  }
  return roots;
}

export function getSkillSearchDirectories(): string[] {
  const list = [...buildStandardSkillDirs()];
  for (const d of collectZhinPackageSkillRoots()) {
    if (!list.includes(d)) list.push(d);
  }
  return list;
}

export function mergeSkillDirsWithResolver(resolver?: () => string[]): string[] {
  const list = [...buildStandardSkillDirs()];
  for (const d of resolver?.() ?? []) {
    if (d && !list.includes(d)) list.push(d);
  }
  return list;
}

/** 将 Node 文件错误转为 miniclawd 风格的结构化短句，便于模型区分并重试 */
export function nodeErrToFileMessage(err: unknown, filePath: string, kind: 'read' | 'write' | 'edit' | 'list'): string {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === 'ENOENT') {
    if (kind === 'list') return `Error: Directory not found: ${filePath}`;
    return `Error: File not found: ${filePath}`;
  }
  if (e?.code === 'EACCES') return `Error: Permission denied: ${filePath}`;
  const action = kind === 'read' ? 'reading file' : kind === 'write' ? 'writing file' : kind === 'edit' ? 'editing file' : 'listing directory';
  return `Error ${action}: ${e?.message ?? String(err)}`;
}
