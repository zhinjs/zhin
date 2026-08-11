/**
 * Workspace Bootstrap Files
 *
 * Injectable prompt files inspired by OpenClaw's workspace bootstrap design:
 *
 *   AGENTS.md  — persistent memory / instructions (AI read-write)
 *   SOUL.md    — persona definition (read-only)
 *   TOOLS.md   — tool usage guidelines (read-only)
 *
 * Key design:
 *   1. mtime-based file cache to avoid redundant disk reads
 *   2. Missing files are silently skipped
 *   3. Per-file and total size limits to prevent prompt injection
 *   4. Unified ContextFile format for system prompt injection
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getLogger } from '@zhin.js/core';

const logger = getLogger('Bootstrap');

// ============================================================================
// 常量
// ============================================================================

/** 支持的引导文件名（顺序：SOUL → AGENTS → TOOLS） */
export const BOOTSTRAP_FILENAMES = [
  'SOUL.md',
  'AGENTS.md',
  'TOOLS.md',
] as const;

/** 可缓存 system §11：仅 SOUL + TOOLS（AGENTS 进 Turn envelope） */
export const STABLE_BOOTSTRAP_FILENAMES = [
  'SOUL.md',
  'TOOLS.md',
] as const;

export type BootstrapFileName = typeof BOOTSTRAP_FILENAMES[number];

/** 单文件最大字符数（默认 16KB） */
const DEFAULT_MAX_CHARS = 16 * 1024;

/** 所有引导文件总最大字符数（默认 48KB） */
const DEFAULT_TOTAL_MAX_CHARS = 48 * 1024;

// ============================================================================
// 类型
// ============================================================================

/** 引导文件信息 */
export interface BootstrapFile {
  name: BootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
}

/** 上下文文件（用于注入到 system prompt） */
export interface ContextFile {
  path: string;
  content: string;
}

// ============================================================================
// 文件缓存（基于 mtime）
// ============================================================================

const fileCache = new Map<string, { content: string; mtimeMs: number }>();

/**
 * 读文件，带 mtime 缓存
 */
async function readFileWithCache(filePath: string): Promise<string> {
  try {
    const stats = await fs.promises.stat(filePath);
    const mtimeMs = stats.mtimeMs;
    const cached = fileCache.get(filePath);

    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.content;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    fileCache.set(filePath, { content, mtimeMs });
    return content;
  } catch {
    fileCache.delete(filePath);
    throw new Error(`Failed to read file: ${filePath}`);
  }
}

/**
 * 清除文件缓存（热重载时调用）
 */
export function clearBootstrapCache(): void {
  fileCache.clear();
}

// ============================================================================
// 文件加载
// ============================================================================

/**
 * 获取数据目录
 */
export function getDataDir(workspaceDir?: string): string {
  const cwd = workspaceDir || process.cwd();
  return path.join(cwd, 'data');
}



/**
 * 加载工作区引导文件
 *
 * 搜索顺序：项目根目录 → data/ 目录
 */
export async function loadBootstrapFiles(
  workspaceDir?: string,
): Promise<BootstrapFile[]> {
  const cwd = workspaceDir || process.cwd();
  const dataDir = getDataDir(cwd);

  const result: BootstrapFile[] = [];

  for (const name of BOOTSTRAP_FILENAMES) {
    // 优先项目根目录
    const rootPath = path.join(cwd, name);
    const dataPath = path.join(dataDir, name);

    let found = false;
    for (const filePath of [rootPath, dataPath]) {
      try {
        const content = await readFileWithCache(filePath);
        result.push({ name, path: filePath, content, missing: false });
        found = true;
        break; // 找到就不再搜索
      } catch {
        // 继续尝试下一个路径
      }
    }

    if (!found) {
      result.push({ name, path: rootPath, missing: true });
    }
  }

  return result;
}

/**
 * 将引导文件转为上下文文件列表（用于注入到 system prompt）
 *
 * 自动裁剪超长内容，跳过缺失文件
 */
export function buildContextFiles(
  bootstrapFiles: BootstrapFile[],
  options?: {
    maxChars?: number;
    totalMaxChars?: number;
  },
): ContextFile[] {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const totalMaxChars = options?.totalMaxChars ?? DEFAULT_TOTAL_MAX_CHARS;

  const contextFiles: ContextFile[] = [];
  let totalChars = 0;

  for (const file of bootstrapFiles) {
    if (file.missing || !file.content) continue;

    let content = file.content.trim();
    if (!content) continue;

    // 单文件裁剪
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + '\n...(truncated)';
      logger.warn(`Bootstrap file ${file.name} exceeds ${maxChars} chars, truncated`);
    }

    // 总量限制
    if (totalChars + content.length > totalMaxChars) {
      logger.warn(`Bootstrap total exceeds ${totalMaxChars} chars, skipping ${file.name}`);
      break;
    }

    contextFiles.push({ path: file.name, content });
    totalChars += content.length;
  }

  return contextFiles;
}

/** 仅 SOUL.md + TOOLS.md，供可缓存 system §11 */
export function buildStableContextFiles(
  bootstrapFiles: BootstrapFile[],
  options?: {
    maxChars?: number;
    totalMaxChars?: number;
  },
): ContextFile[] {
  const stable = bootstrapFiles.filter(f =>
    (STABLE_BOOTSTRAP_FILENAMES as readonly string[]).includes(f.name),
  );
  return buildContextFiles(stable, options);
}

// ============================================================================
// 全局上下文文件（默认路径 + config.contextPaths）
// ============================================================================

/** 默认全局上下文路径（不存在则跳过） */
export const DEFAULT_GLOBAL_CONTEXT_PATHS = [
  '~/.config/zhin/AGENTS.md',
  '~/.config/zhin/ZHIN.md',
] as const;

/** 全局上下文单文件 / 总量上限（比项目 bootstrap 更紧，控制 token） */
const GLOBAL_CONTEXT_MAX_CHARS = 8 * 1024;
const GLOBAL_CONTEXT_TOTAL_MAX_CHARS = 16 * 1024;

function expandContextPath(raw: string, cwd: string): string {
  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

/**
 * 加载全局/追加上下文文件：`~` 展开、按解析路径去重、缺失跳过，单文件与总量裁剪。
 */
export async function loadContextFiles(
  paths: readonly string[],
  options?: {
    cwd?: string;
    maxChars?: number;
    totalMaxChars?: number;
  },
): Promise<ContextFile[]> {
  const cwd = options?.cwd || process.cwd();
  const maxChars = options?.maxChars ?? GLOBAL_CONTEXT_MAX_CHARS;
  const totalMaxChars = options?.totalMaxChars ?? GLOBAL_CONTEXT_TOTAL_MAX_CHARS;

  const seen = new Set<string>();
  const files: ContextFile[] = [];
  let totalChars = 0;

  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const filePath = expandContextPath(trimmed, cwd);
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    let content: string;
    try {
      content = (await readFileWithCache(filePath)).trim();
    } catch {
      continue; // 缺失/不可读：静默跳过
    }
    if (!content) continue;

    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + '\n...(truncated)';
      logger.warn(`Context file ${filePath} exceeds ${maxChars} chars, truncated`);
    }
    if (totalChars + content.length > totalMaxChars) {
      logger.warn(`Context files total exceeds ${totalMaxChars} chars, skipping ${filePath}`);
      break;
    }

    files.push({ path: filePath, content });
    totalChars += content.length;
  }

  return files;
}

/** 构建全局上下文段：仅一个标题，多文件时每个文件前一行来源标记，无代码块包装 */
export function buildGlobalContextSection(files: ContextFile[]): string {
  if (files.length === 0) return '';
  const body = files
    .map(f => (files.length > 1 ? `(from ${f.path})\n${f.content}` : f.content))
    .join('\n\n');
  return `# User Context\n\n${body}`;
}

/** 构建可缓存 bootstrap 段（不含 AGENTS.md） */
export function buildStableBootstrapSection(
  bootstrapFiles: BootstrapFile[],
  options?: {
    maxChars?: number;
    totalMaxChars?: number;
  },
): string {
  return buildBootstrapContextSection(buildStableContextFiles(bootstrapFiles, options));
}

/**
 * 加载 SOUL.md 人格定义
 */
export async function loadSoulPersona(workspaceDir?: string): Promise<string | null> {
  const files = await loadBootstrapFiles(workspaceDir);
  const soulFile = files.find(f => f.name === 'SOUL.md' && !f.missing);
  return soulFile?.content?.trim() || null;
}

/**
 * 加载 TOOLS.md 工具使用指引
 */
export async function loadToolsGuide(workspaceDir?: string): Promise<string | null> {
  const files = await loadBootstrapFiles(workspaceDir);
  const toolsFile = files.find(f => f.name === 'TOOLS.md' && !f.missing);
  return toolsFile?.content?.trim() || null;
}

/**
 * 加载 AGENTS.md 持久化记忆
 */
export async function loadAgentsMemory(workspaceDir?: string): Promise<string | null> {
  const files = await loadBootstrapFiles(workspaceDir);
  const agentsFile = files.find(f => f.name === 'AGENTS.md' && !f.missing);
  return agentsFile?.content?.trim() || null;
}

// ============================================================================
// System Prompt 构建帮助函数
// ============================================================================

/**
 * 构建引导文件上下文段（注入到 system prompt 末尾）
 *
 * 格式与 OpenClaw 一致：
 * ```
 * # Workspace
 *
 * The following project context files have been loaded:
 * If SOUL.md is present, embody its persona and tone.
 *
 * ## SOUL.md
 *
 * <content>
 *
 * ## TOOLS.md
 *
 * <content>
 * ```
 */
export function buildBootstrapContextSection(contextFiles: ContextFile[]): string {
  if (contextFiles.length === 0) return '';

  const hasSoul = contextFiles.some(f =>
    f.path.toLowerCase().endsWith('soul.md'),
  );

  const lines: string[] = [
    '# Workspace',
    '',
    'Loaded workspace files (persona / agent notes / tool habits):',
  ];

  if (hasSoul) {
    lines.push('Use SOUL.md for persona and tone.');
  }
  lines.push('');

  for (const file of contextFiles) {
    lines.push(`## ${file.path}`, '', file.content, '');
  }

  return lines.join('\n');
}
