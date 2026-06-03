import type { AISetupConfig } from './ai.js';
import type { InitOptions } from './types.js';

/** 与 monorepo 中 agent / test-bot 对齐的 MCP SDK 版本 */
export const MCP_SDK_VERSION = '^1.29.0';

/**
 * AI 启用时预装 MCP SDK，避免 memoryMcp / mcpServers 运行时报 optional peer 缺失。
 */
export function getAIDependencies(ai?: AISetupConfig): Record<string, string> {
  if (!ai?.enabled) return {};
  return {
    '@modelcontextprotocol/sdk': MCP_SDK_VERSION,
  };
}

/**
 * AI 会话持久化默认开启时，若用户未选数据库则自动补 SQLite（零配置、与 inbox 一致）。
 * `-y` Stable 路径 intentionally 无数据库，与 examples/minimal-bot 对齐，此处跳过。
 */
export function ensureDatabaseForAI(options: InitOptions): void {
  if (options.yes) return;
  if (!options.ai?.enabled) return;
  if (options.database) return;

  const useDatabase = options.ai.sessions?.useDatabase !== false;
  if (!useDatabase) return;

  options.database = {
    dialect: 'sqlite',
    filename: './data/bot.db',
    mode: 'wal',
  };
}

/**
 * 所选适配器（如 GitHub）需要 database 时自动补 SQLite。
 */
export function ensureDatabaseForAdapters(options: InitOptions): void {
  if (options.yes) return;
  if (options.database) return;
  if (!options.adapters?.requiresDatabase) return;

  options.database = {
    dialect: 'sqlite',
    filename: './data/bot.db',
    mode: 'wal',
  };
}
