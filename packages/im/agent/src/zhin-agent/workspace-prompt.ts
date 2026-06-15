/**
 * 工作区 prompts/{role}.md + prompts/{role}.{sdk}.md，包内默认 fallback。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_PROMPTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'prompts',
);

export type WorkspacePromptRole = 'orchestrator' | 'deferred-worker' | 'compaction';

const promptFileCache = new Map<string, { content: string; mtimeMs: number }>();

function readPromptFileSync(filePath: string): string | null {
  try {
    const stats = fs.statSync(filePath);
    const cached = promptFileCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.content;
    }
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;
    promptFileCache.set(filePath, { content, mtimeMs: stats.mtimeMs });
    return content;
  } catch {
    promptFileCache.delete(filePath);
    return null;
  }
}

export function clearWorkspacePromptCache(): void {
  promptFileCache.clear();
}

function resolveFirstExisting(
  dirs: string[],
  filename: string,
): string | null {
  for (const dir of dirs) {
    const filePath = path.join(dir, filename);
    const content = readPromptFileSync(filePath);
    if (content) return content;
  }
  return null;
}

/**
 * 解析 role 通用段 + 可选 sdk 差异段（workspace 优先，包内 fallback）。
 */
export function resolveWorkspacePrompt(
  role: WorkspacePromptRole,
  sdk?: string,
  workspaceDir?: string,
): string {
  const cwd = workspaceDir || process.cwd();
  const dirs = [path.join(cwd, 'prompts'), PACKAGE_PROMPTS_DIR];

  const base = resolveFirstExisting(dirs, `${role}.md`) ?? '';
  if (!sdk?.trim()) return base;

  const sdkPart = resolveFirstExisting(dirs, `${role}.${sdk.trim()}.md`);
  if (!sdkPart) return base;
  if (!base) return sdkPart;
  return `${base}\n\n${sdkPart}`;
}
