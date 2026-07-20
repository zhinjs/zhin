/**
 * 三层文件记忆：全局（部署） / 平台 / 会话（session_key）
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHostRootPlugin, senderRolesFromMessage, type Message, getLogger } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/ai';
import { getMemoryDir } from './bootstrap.js';
import { resolveToolRequesterRole } from './security/owner-approve-always-store.js';
const logger = getLogger('MemoryLayers');

export interface MemoryLayerBudgets {
  session: number;
  platform: number;
  global: number;
  daily: number;
}

export const DEFAULT_MEMORY_BUDGETS: MemoryLayerBudgets = {
  session: 8000,
  platform: 4000,
  global: 4000,
  daily: 2000,
};

export interface MemoryPromptOptions {
  enabled: boolean;
  budgets: MemoryLayerBudgets;
}

export interface MemoryLayersInput {
  workspaceDir?: string;
  platform?: string;
  sessionKey?: string;
  budgets?: Partial<MemoryLayerBudgets>;
  enabled?: boolean;
}

export interface MemoryLayerSlice {
  key: 'daily' | 'global' | 'platform' | 'session';
  title: string;
  content: string;
  chars: number;
}

export interface LoadedMemoryLayers {
  sessionKey?: string;
  platform?: string;
  slices: MemoryLayerSlice[];
}

/** 将 session_key 转为安全目录名（hash 前缀 + 可读后缀） */
export function safeSessionKey(sessionKey: string): string {
  const trimmed = sessionKey.trim();
  if (!trimmed) return 'empty';
  const hash = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 12);
  const slug = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return `${hash}_${slug || 'key'}`;
}

export function getMemoryRoot(workspaceDir?: string): string {
  return getMemoryDir(workspaceDir);
}

export function getGlobalMemoryDir(workspaceDir?: string): string {
  return path.join(getMemoryRoot(workspaceDir), 'global');
}

export function getPlatformMemoryDir(platform: string, workspaceDir?: string): string {
  const safePlatform = platform.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'unknown';
  return path.join(getMemoryRoot(workspaceDir), 'platforms', safePlatform);
}

export function getSessionMemoryDir(sessionKey: string, workspaceDir?: string): string {
  return path.join(getMemoryRoot(workspaceDir), 'sessions', safeSessionKey(sessionKey));
}

function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function readTrimmedFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

const migratedWorkspaces = new Set<string>();

/** 测试用：重置迁移标记 */
export function resetMemoryMigrationForTests(): void {
  migratedWorkspaces.clear();
}

/** 将旧版 data/memory/MEMORY.md 迁移到 global/MEMORY.md（每个工作区一次） */
export function migrateLegacyMemoryFiles(workspaceDir?: string): void {
  const cwd = path.resolve(workspaceDir || process.cwd());
  if (migratedWorkspaces.has(cwd)) return;
  migratedWorkspaces.add(cwd);

  const memoryDir = getMemoryRoot(workspaceDir);
  const legacyFile = path.join(memoryDir, 'MEMORY.md');
  const globalDir = getGlobalMemoryDir(workspaceDir);
  const globalFile = path.join(globalDir, 'MEMORY.md');

  if (!fs.existsSync(legacyFile) || fs.existsSync(globalFile)) return;

  try {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.copyFileSync(legacyFile, globalFile);
    logger.info(`Migrated legacy ${legacyFile} → ${globalFile}`);
  } catch (err) {
    logger.warn('Legacy memory migration failed:', err);
  }

  const legacyDaily = path.join(memoryDir, `${todayDate()}.md`);
  const globalDaily = path.join(globalDir, `${todayDate()}.md`);
  if (fs.existsSync(legacyDaily) && !fs.existsSync(globalDaily)) {
    try {
      fs.copyFileSync(legacyDaily, globalDaily);
      logger.info(`Migrated legacy daily notes → ${globalDaily}`);
    } catch {
      // ignore
    }
  }
}

export function loadMemoryLayers(input: MemoryLayersInput = {}): LoadedMemoryLayers {
  const { workspaceDir, platform, sessionKey } = input;
  migrateLegacyMemoryFiles(workspaceDir);

  const slices: MemoryLayerSlice[] = [];

  const globalDir = getGlobalMemoryDir(workspaceDir);
  const globalLong = readTrimmedFile(path.join(globalDir, 'MEMORY.md'));
  if (globalLong) {
    slices.push({
      key: 'global',
      title: 'Global',
      content: `### Long-term\n${globalLong}`,
      chars: globalLong.length,
    });
  }

  const daily = readTrimmedFile(path.join(globalDir, `${todayDate()}.md`));
  if (daily) {
    slices.push({
      key: 'daily',
      title: "Today's Notes",
      content: daily,
      chars: daily.length,
    });
  }

  if (platform?.trim()) {
    const platDir = getPlatformMemoryDir(platform, workspaceDir);
    const rules = readTrimmedFile(path.join(platDir, 'RULES.md'));
    const adapter = readTrimmedFile(path.join(platDir, 'ADAPTER.md'));
    const platParts: string[] = [];
    if (rules) platParts.push(`### Rules\n${rules}`);
    if (adapter) platParts.push(`### Adapter\n${adapter}`);
    if (platParts.length > 0) {
      const body = platParts.join('\n\n');
      slices.push({
        key: 'platform',
        title: `Platform ${platform}`,
        content: body,
        chars: body.length,
      });
    }
  }

  if (sessionKey?.trim()) {
    const sessionFile = path.join(getSessionMemoryDir(sessionKey, workspaceDir), 'MEMORY.md');
    const sessionBody = readTrimmedFile(sessionFile);
    if (sessionBody) {
      slices.push({
        key: 'session',
        title: `Session (${sessionKey})`,
        content: sessionBody,
        chars: sessionBody.length,
      });
    }
  }

  // 兼容：仍读取根目录旧版（只读，未迁移时）
  if (!globalLong) {
    const legacy = readTrimmedFile(path.join(getMemoryRoot(workspaceDir), 'MEMORY.md'));
    if (legacy) {
      slices.push({
        key: 'global',
        title: 'Global (legacy path)',
        content: `### Long-term\n${legacy}`,
        chars: legacy.length,
      });
    }
  }

  return { sessionKey, platform, slices };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 20) return text.slice(0, maxChars);
  return text.slice(0, maxChars - 20) + '\n...(truncated)';
}

/** 按预算拼装；超预算时先裁 daily → global → platform → session */
export function buildMemoryPrompt(
  layers: LoadedMemoryLayers,
  budgets: MemoryLayerBudgets = DEFAULT_MEMORY_BUDGETS,
): string {
  const byKey = new Map(layers.slices.map(s => [s.key, s]));

  const applyBudget = (key: MemoryLayerSlice['key'], budget: number): string => {
    const slice = byKey.get(key);
    if (!slice) return '';
    return truncateText(slice.content, budget);
  };

  let daily = applyBudget('daily', budgets.daily);
  let globalBody = applyBudget('global', budgets.global);
  let platformBody = applyBudget('platform', budgets.platform);
  let sessionBody = applyBudget('session', budgets.session);

  const total = daily.length + globalBody.length + platformBody.length + sessionBody.length;
  const totalBudget =
    budgets.daily + budgets.global + budgets.platform + budgets.session;

  if (total > totalBudget) {
    const trimOrder: MemoryLayerSlice['key'][] = ['daily', 'global', 'platform', 'session'];
    let overflow = total - totalBudget;
    const bodies: Record<MemoryLayerSlice['key'], { text: string; budget: number }> = {
      daily: { text: daily, budget: budgets.daily },
      global: { text: globalBody, budget: budgets.global },
      platform: { text: platformBody, budget: budgets.platform },
      session: { text: sessionBody, budget: budgets.session },
    };
    for (const key of trimOrder) {
      if (overflow <= 0) break;
      const entry = bodies[key];
      if (!entry.text) continue;
      const extra = Math.max(0, entry.text.length - entry.budget);
      const cut = Math.min(overflow, extra || entry.text.length);
      entry.text = truncateText(entry.text, Math.max(0, entry.text.length - cut));
      overflow -= cut;
    }
    daily = bodies.daily.text;
    globalBody = bodies.global.text;
    platformBody = bodies.platform.text;
    sessionBody = bodies.session.text;
  }

  const sections: string[] = [];
  if (sessionBody) sections.push(`## Session (${layers.sessionKey ?? 'unknown'})\n${sessionBody}`);
  if (platformBody) sections.push(`## ${byKey.get('platform')?.title ?? 'Platform'}\n${platformBody}`);
  if (globalBody) sections.push(`## Global\n${globalBody}`);
  if (daily) sections.push(`## ${byKey.get('daily')?.title ?? "Today's Notes"}\n${daily}`);

  return sections.join('\n\n');
}

export function resolveMemoryPromptOptions(): MemoryPromptOptions {
  const host = getHostRootPlugin();
  if (host) {
    const configService = host.inject?.('config') as
      | { getPrimary?: () => { ai?: AIConfig } }
      | undefined;
    const ai = configService?.getPrimary?.()?.ai;
    const mem = ai?.memory;
    return {
      enabled: mem?.enabled !== false,
      budgets: { ...DEFAULT_MEMORY_BUDGETS, ...mem?.budgets },
    };
  }
  return { enabled: true, budgets: DEFAULT_MEMORY_BUDGETS };
}

export function getFileMemoryContext(
  workspaceDir?: string,
  platform?: string,
  sessionKey?: string,
): string {
  const opts = resolveMemoryPromptOptions();
  if (!opts.enabled) return '';

  const layers = loadMemoryLayers({
    workspaceDir,
    platform,
    sessionKey,
    budgets: opts.budgets,
    enabled: opts.enabled,
  });
  if (layers.slices.length === 0) return '';
  return buildMemoryPrompt(layers, opts.budgets);
}

export type MemoryWriteScope = 'session' | 'platform' | 'global' | 'none';

function memoryRelativeFromPath(filePath: string): string | null {
  const expanded = filePath.replace(/^~(?=$|[\\/])/, process.env.HOME || '');
  const normalized = path.resolve(expanded).split(path.sep).join('/');
  const marker = '/data/memory/';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) {
    return normalized.slice(idx + marker.length);
  }
  const rel = expanded.replace(/\\/g, '/');
  if (rel.startsWith('data/memory/')) {
    return rel.slice('data/memory/'.length);
  }
  return null;
}

function classifyMemoryRelative(rel: string): MemoryWriteScope {
  if (rel.startsWith('sessions/')) return 'session';
  if (rel.startsWith('platforms/')) return 'platform';
  if (rel.startsWith('global/')) return 'global';
  if (rel === 'MEMORY.md' || /^\d{4}-\d{2}-\d{2}\.md$/.test(rel)) return 'global';
  return 'none';
}

export function classifyMemoryWritePath(
  filePath: string,
  _workspaceDir?: string,
): MemoryWriteScope {
  const rel = memoryRelativeFromPath(filePath);
  if (!rel) return 'none';
  return classifyMemoryRelative(rel);
}

export interface MemoryWriteDecision {
  allowed: boolean;
  scope: MemoryWriteScope;
  reason?: string;
}

export function checkMemoryWritePath(
  filePath: string,
  context?: Message<any>,
  workspaceDir?: string,
): MemoryWriteDecision {
  const scope = classifyMemoryWritePath(filePath, workspaceDir);
  if (scope === 'none') {
    return { allowed: true, scope };
  }

  if (scope === 'session') {
    return { allowed: true, scope };
  }

  let role: string = 'unknown';
  const host = getHostRootPlugin();
  if (host && context) {
    role = resolveToolRequesterRole(host, context);
  } else if (context && senderRolesFromMessage(context).includes('master')) {
    role = 'master';
  }
  if (role === 'master') {
    return { allowed: true, scope };
  }

  const layerLabel = scope === 'global' ? '全局' : '平台';
  return {
    allowed: false,
    scope,
    reason: `${layerLabel}记忆仅 Endpoint Owner（master）可写入；请将会话相关笔记写入 data/memory/sessions/<session>/MEMORY.md。`,
  };
}

/** @deprecated 使用 checkMemoryWritePath */
export function assertMemoryWritePath(
  filePath: string,
  context?: Message<any>,
  workspaceDir?: string,
): MemoryWriteDecision {
  return checkMemoryWritePath(filePath, context, workspaceDir);
}

export function formatMemoryPathsHint(platform?: string, sessionKey?: string): string {
  const today = todayDate();
  const lines = [
    'data/memory/global/MEMORY.md',
    `data/memory/global/${today}.md`,
  ];
  if (platform?.trim()) {
    const p = platform.replace(/[^a-zA-Z0-9._-]+/g, '_');
    lines.push(`data/memory/platforms/${p}/RULES.md`);
    lines.push(`data/memory/platforms/${p}/ADAPTER.md`);
  }
  if (sessionKey?.trim()) {
    const dir = `data/memory/sessions/${safeSessionKey(sessionKey)}`;
    lines.push(`${dir}/MEMORY.md`);
  }
  return lines.join(', ');
}
