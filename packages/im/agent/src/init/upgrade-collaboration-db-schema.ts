/**
 * collaboration_cells 列迁移（CREATE TABLE IF NOT EXISTS 不会给旧表加列）。
 */
import { onDatabaseAfterStart } from '@zhin.js/core';
import {
  listSqliteTableColumns,
  resolveAgentDbDialect,
  resolveAgentDbQuery,
  type AgentDbQueryable,
} from './upgrade-agent-db-schema.js';

export const COLLABORATION_SCHEMA_PATCHES: Record<string, Record<string, string>> = {
  collaboration_cell_members: {
    adapter: 'TEXT',
  },
};

/** Database / DatabaseFeature → AgentDbQueryable */
export function asAgentDbQueryable(db: unknown): AgentDbQueryable {
  if (!db || typeof db !== 'object') return db as AgentDbQueryable;
  const record = db as Record<string, unknown>;
  if (typeof record.query === 'function') {
    return { db: db as AgentDbQueryable['db'] };
  }
  if (record.db && typeof (record.db as { query?: unknown }).query === 'function') {
    return { db: record.db as AgentDbQueryable['db'] };
  }
  return db as AgentDbQueryable;
}

export async function upgradeCollaborationDbSchema(
  dbFeature: AgentDbQueryable,
): Promise<string[]> {
  const queryFn = resolveAgentDbQuery(dbFeature);
  if (!queryFn) return [];

  const dialect = resolveAgentDbDialect(dbFeature);
  if (dialect && dialect !== 'sqlite') {
    return [];
  }

  const added: string[] = [];
  for (const [table, columns] of Object.entries(COLLABORATION_SCHEMA_PATCHES)) {
    let existing: Set<string>;
    try {
      existing = await listSqliteTableColumns((sql) => queryFn(sql), table);
    } catch {
      continue;
    }
    if (existing.size === 0) continue;

    for (const [column, sqlType] of Object.entries(columns)) {
      if (existing.has(column)) continue;
      await queryFn(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sqlType}`);
      added.push(`${table}.${column}`);
    }
  }
  return added;
}

let collaborationMigrationHookRegistered = false;

/** db.start() 后、ORM 读写 collaboration_cells 前执行（可重复调用，仅注册一次） */
export function registerCollaborationRoundStateMigrationHook(
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
): void {
  if (collaborationMigrationHookRegistered) return;
  collaborationMigrationHookRegistered = true;

  onDatabaseAfterStart(async (db) => {
    try {
      const added = await upgradeCollaborationDbSchema(asAgentDbQueryable(db));
      if (added.length > 0) {
        logger.info(`Database: migrated collaboration columns: ${added.join(', ')}`);
      }
    } catch (e) {
      logger.error('Database: collaboration_cells round_state migration failed:', e);
    }
  });
}
