/**
 * `zhin chat-roles export|import` (ADR 0060 §4.5): people, chat identities, chat role grants and
 * Console links as JSON, through the running instance's Console RPC (`chat-principals.export` /
 * `chat-principals.import`, both need a global `iam.manage` binding; over the local gateway socket
 * the CLI acts as the local owner). The CLI never opens the project database and never imports
 * the IM layers.
 *
 * Import merges into what is stored: it adds and raises, never lowers or removes, and never moves
 * an identity that already belongs to another person.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import {
  CHAT_PRINCIPALS_RPC, type ConsoleChatRolesExport, type ConsoleChatRolesImportResult,
} from '@zhin.js/console-protocol';
import { logger } from '../utils/logger.js';
import { output } from '../utils/output.js';
import { hostPost, loadHostHttpConfig, type HostFetchResult, type HostHttpConfig } from '../utils/host-http.js';

/** Where `export` writes without a file argument (also where the instance puts its pre-migration backup). */
export function defaultChatRolesExportPath(root: string, now = new Date()): string {
  return path.join(root, '.zhin', 'backups', `chat-roles-${now.toISOString().replace(/[:.]/gu, '-')}.json`);
}

async function consoleRpc<T>(http: HostHttpConfig, type: string, data: Record<string, unknown> = {}): Promise<HostFetchResult<T>> {
  return hostPost<T>(http, '/console/request', { type, data, requestId: `cli-${Date.now()}` });
}

function isExport(value: unknown): value is ConsoleChatRolesExport {
  const data = value as Partial<ConsoleChatRolesExport> | undefined;
  return !!data && data.format === 'zhin.chat-roles' && data.version === 1
    && Array.isArray(data.principals) && Array.isArray(data.identities) && Array.isArray(data.roles) && Array.isArray(data.consoleLinks);
}

export async function exportChatRoles(http: HostHttpConfig, file: string): Promise<{ ok: true; file: string; data: ConsoleChatRolesExport } | { ok: false; error: string }> {
  const result = await consoleRpc<ConsoleChatRolesExport>(http, CHAT_PRINCIPALS_RPC.EXPORT);
  if (!result.ok) return { ok: false, error: result.error ?? `HTTP ${result.status}` };
  if (!isExport(result.data)) return { ok: false, error: '实例返回的不是 zhin.chat-roles 导出数据' };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(result.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, file, data: result.data };
}

export async function importChatRoles(http: HostHttpConfig, file: string): Promise<{ ok: true; result: ConsoleChatRolesImportResult } | { ok: false; error: string }> {
  let data: unknown;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    return { ok: false, error: `无法读取 ${file}：${(error as Error).message}` };
  }
  if (!isExport(data)) return { ok: false, error: `${file} 不是 zhin chat-roles export 的导出文件（format: zhin.chat-roles, version: 1）` };
  const result = await consoleRpc<ConsoleChatRolesImportResult>(http, CHAT_PRINCIPALS_RPC.IMPORT, { data });
  if (!result.ok || !result.data) return { ok: false, error: result.error ?? `HTTP ${result.status}` };
  return { ok: true, result: result.data };
}

/** Result lines of `zhin chat-roles export` (stdout; diagnostics go to stderr through `logger`). */
export function chatRolesExportLines(data: ConsoleChatRolesExport, file: string): readonly string[] {
  return [`✓ 已导出 ${data.principals.length} 个人、${data.roles.length} 条角色授予到 ${file}`];
}

/** Result lines of `zhin chat-roles import`, including the entries the instance skipped. */
export function chatRolesImportLines(result: ConsoleChatRolesImportResult): readonly string[] {
  const { principals, identities, roles, consoleLinks, skipped } = result;
  return [`✓ 已导入：新人 ${principals}、身份 ${identities}、角色 ${roles}、Console 链接 ${consoleLinks}`,
    ...skipped.map(line => `跳过：${line}`)];
}

async function requireHost(): Promise<HostHttpConfig> {
  const http = await loadHostHttpConfig();
  if (!http) {
    logger.error('未找到 zhin 配置文件，无法确定 Host API 地址');
    process.exit(1);
  }
  return http;
}

const exportCommand = new Command('export')
  .description('导出人、聊天身份、角色授予与 Console 链接为 JSON（需要实例正在运行）')
  .argument('[file]', '输出文件（默认 .zhin/backups/chat-roles-<时间>.json）')
  .action(async (file: string | undefined) => {
    const target = path.resolve(file ?? defaultChatRolesExportPath(process.cwd()));
    const result = await exportChatRoles(await requireHost(), target);
    if (!result.ok) { logger.error(result.error); process.exit(1); }
    output.line(...chatRolesExportLines(result.data, result.file));
  });

const importCommand = new Command('import')
  .description('导入 zhin chat-roles export 的文件：只新增或提升，不降级、不删除（需要实例正在运行与全局 iam.manage）')
  .argument('<file>', '导出文件')
  .action(async (file: string) => {
    const result = await importChatRoles(await requireHost(), path.resolve(file));
    if (!result.ok) { logger.error(result.error); process.exit(1); }
    output.line(...chatRolesImportLines(result.result));
  });

export const chatRolesCommand = new Command('chat-roles')
  .description('聊天角色的导出与导入（ADR 0060；授予与撤销请用 Console「聊天角色」页或聊天命令）')
  .addCommand(exportCommand)
  .addCommand(importCommand);
