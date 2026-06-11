/**
 * Bot → Endpoint 破坏性重命名：旧 SQLite 表 bot_id 列升级为 endpoint_id。
 * CREATE TABLE IF NOT EXISTS 不会改已有表结构。
 */

import { onDatabaseAfterStart } from '@zhin.js/core';
import {
  listSqliteTableColumns,
  resolveAgentDbDialect,
  resolveAgentDbQuery,
  type AgentDbQueryable,
} from './upgrade-agent-db-schema.js';

let migrationHookRegistered = false;

async function listSqliteUserTables(
  query: (sql: string) => Promise<unknown>,
): Promise<string[]> {
  const rows = (await query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  )) as Array<{ name?: string }>;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => String(r.name ?? '')).filter(Boolean);
}

export async function upgradeBotIdToEndpointIdColumns(
  dbFeature: AgentDbQueryable,
): Promise<string[]> {
  const queryFn = resolveAgentDbQuery(dbFeature);
  if (!queryFn) return [];

  const dialect = resolveAgentDbDialect(dbFeature);
  if (dialect && dialect !== 'sqlite') {
    return [];
  }

  const tables = await listSqliteUserTables((sql) => queryFn(sql));
  const renamed: string[] = [];

  for (const table of tables) {
    let columns: Set<string>;
    try {
      columns = await listSqliteTableColumns((sql) => queryFn(sql), table);
    } catch {
      continue;
    }
    if (columns.size === 0) continue;
    if (!columns.has('bot_id') || columns.has('endpoint_id')) continue;

    await queryFn(`ALTER TABLE "${table}" RENAME COLUMN "bot_id" TO "endpoint_id"`);
    renamed.push(`${table}.bot_id→endpoint_id`);
  }
  return renamed;
}

/** 在 db.start() 后、任何 ORM 写入前注册（可重复调用，仅注册一次） */
export function registerEndpointIdColumnMigrationHook(
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
): void {
  if (migrationHookRegistered) return;
  migrationHookRegistered = true;

  onDatabaseAfterStart(async (db) => {
    try {
      const renamed = await upgradeBotIdToEndpointIdColumns({ db } as AgentDbQueryable);
      if (renamed.length > 0) {
        logger.info(`Database: renamed bot_id → endpoint_id (${renamed.join(', ')})`);
      }
    } catch (e) {
      logger.error('Database: bot_id → endpoint_id migration failed:', e);
    }
  });
}
