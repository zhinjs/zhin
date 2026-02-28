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

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@zhin.js/logger';

const logger = new Logger(null, 'Bootstrap');

// ============================================================================
// 常量
// ============================================================================

/** 支持的引导文件名（顺序：SOUL → AGENTS → TOOLS） */
export const BOOTSTRAP_FILENAMES = [
  'SOUL.md',
  'AGENTS.md',
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
function getDataDir(workspaceDir?: string): string {
  const cwd = workspaceDir || process.cwd();
  return path.join(cwd, 'data');
}

/**
 * 获取文件制长期记忆目录（data/memory），不存在则创建
 */
export function getMemoryDir(workspaceDir?: string): string {
  const dir = path.join(getDataDir(workspaceDir), 'memory');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * 读取文件制长期记忆 + 当日笔记，拼成注入 system prompt 的字符串（与 miniclawd 一致）
 * 同步读取，供 buildRichSystemPrompt 等同步调用
 */
export function getFileMemoryContext(workspaceDir?: string): string {
  const memoryDir = getMemoryDir(workspaceDir);
  const parts: string[] = [];

  const memoryFile = path.join(memoryDir, 'MEMORY.md');
  if (fs.existsSync(memoryFile)) {
    try {
      const longTerm = fs.readFileSync(memoryFile, 'utf-8').trim();
      if (longTerm) parts.push('## Long-term Memory\n' + longTerm);
    } catch {
      // ignore read errors
    }
  }

  const todayFile = path.join(memoryDir, `${todayDate()}.md`);
  if (fs.existsSync(todayFile)) {
    try {
      const today = fs.readFileSync(todayFile, 'utf-8').trim();
      if (today) parts.push("## Today's Notes\n" + today);
    } catch {
      // ignore read errors
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
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
 * # Project Context
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
    '# Project Context',
    '',
    'The following project context files have been loaded:',
  ];

  if (hasSoul) {
    lines.push(
      'If SOUL.md is present, embody its persona and tone. Avoid generic responses.',
    );
  }
  lines.push('');

  for (const file of contextFiles) {
    lines.push(`## ${file.path}`, '', file.content, '');
  }

  return lines.join('\n');
}
