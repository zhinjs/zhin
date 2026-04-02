/**
 * 发现模块共用的工具函数
 *
 * 被 builtin-tools / discover-skills / discover-agents / discover-tools 共同依赖，
 * 独立出来以避免循环导入。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Plugin } from '@zhin.js/core';

/** 将 unknown 错误转为字符串 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 获取 data/ 目录路径，自动创建 */
export function getDataDir(): string {
  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 展开路径中的 ~ 为实际 home 目录 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Workspace / ~/.zhin / data 下 skills 根目录（与 activate_skill 扫描顺序一致的前缀） */
export function buildStandardSkillDirs(): string[] {
  return [
    path.join(process.cwd(), 'skills'),
    path.join(os.homedir(), '.zhin', 'skills'),
    path.join(getDataDir(), 'skills'),
  ];
}

/**
 * 从根插件树收集：根插件与**直接子插件**包目录下的 `skills/`（其下为 `<name>/SKILL.md`）
 */
export function collectPluginSkillSearchRoots(root: Plugin | null | undefined): string[] {
  if (!root) return [];
  const dirs: string[] = [];
  const push = (d: string) => {
    if (d && !dirs.includes(d)) dirs.push(d);
  };
  const fromPlugin = (p: Plugin) => {
    if (!p?.filePath) return;
    const dir = path.dirname(p.filePath);
    push(path.join(dir, 'skills'));
    // Also check package root when filePath is under src/ or lib/
    const dirName = path.basename(dir);
    if (dirName === 'src' || dirName === 'lib') {
      push(path.join(path.dirname(dir), 'skills'));
    }
  };
  fromPlugin(root);
  for (const child of root.children || []) {
    fromPlugin(child);
  }
  return dirs;
}

/**
 * 技能发现与 activate_skill 查找共用：标准目录 + 已加载插件包 skills/
 */
export function getSkillSearchDirectories(root?: Plugin | null): string[] {
  const list = [...buildStandardSkillDirs()];
  for (const d of collectPluginSkillSearchRoots(root ?? undefined)) {
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
