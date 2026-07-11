/**
 * Side Event 字段迁移：旧 SQLite 表 channel_* / notice_type → scene_* / platform_notice_id。
 * CREATE TABLE IF NOT EXISTS 不会为已有表补列。
 */
import { onDatabaseAfterStart } from '@zhin.js/core';

type DbQueryable = {
  db?: {
    query?<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
    dialect?: { name?: string };
  };
  query?<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
};

type PragmaColumnRow = { name?: string };

/** table → column → SQLite type for ALTER TABLE ADD COLUMN */
export const SIDE_EVENT_SCHEMA_PATCHES: Record<string, Record<string, string>> = {
  unified_inbox_notice: {
    scene_type: 'TEXT',
    scene_id: 'TEXT',
    actor_id: 'TEXT',
    actor_name: 'TEXT',
  },
  unified_inbox_request: {
    scene_type: 'TEXT',
    scene_id: 'TEXT',
  },
  console_bot_notices: {
    platform_notice_id: 'TEXT',
    type: 'TEXT',
    scene_type: 'TEXT',
    scene_id: 'TEXT',
    sub_type: 'TEXT',
    actor_id: 'TEXT',
    actor_name: 'TEXT',
    target_id: 'TEXT',
    target_name: 'TEXT',
  },
  console_bot_requests: {
    scene_type: 'TEXT',
    scene_id: 'TEXT',
    sub_type: 'TEXT',
  },
};

type BackfillRule = {
  table: string;
  sql: string;
  requires: string[];
};

const SIDE_EVENT_BACKFILL_RULES: BackfillRule[] = [
  {
    table: 'unified_inbox_notice',
    sql: `UPDATE "unified_inbox_notice" SET scene_id = channel_id
      WHERE (scene_id IS NULL OR scene_id = '') AND channel_id IS NOT NULL AND channel_id != ''`,
    requires: ['channel_id', 'scene_id'],
  },
  {
    table: 'unified_inbox_notice',
    sql: `UPDATE "unified_inbox_notice" SET scene_type = channel_type
      WHERE (scene_type IS NULL OR scene_type = '') AND channel_type IS NOT NULL AND channel_type != ''`,
    requires: ['channel_type', 'scene_type'],
  },
  {
    table: 'unified_inbox_notice',
    sql: `UPDATE "unified_inbox_notice" SET actor_id = operator_id
      WHERE (actor_id IS NULL OR actor_id = '') AND operator_id IS NOT NULL AND operator_id != ''`,
    requires: ['operator_id', 'actor_id'],
  },
  {
    table: 'unified_inbox_notice',
    sql: `UPDATE "unified_inbox_notice" SET actor_name = operator_name
      WHERE (actor_name IS NULL OR actor_name = '') AND operator_name IS NOT NULL AND operator_name != ''`,
    requires: ['operator_name', 'actor_name'],
  },
  {
    table: 'unified_inbox_request',
    sql: `UPDATE "unified_inbox_request" SET scene_id = channel_id
      WHERE (scene_id IS NULL OR scene_id = '') AND channel_id IS NOT NULL AND channel_id != ''`,
    requires: ['channel_id', 'scene_id'],
  },
  {
    table: 'unified_inbox_request',
    sql: `UPDATE "unified_inbox_request" SET scene_type = channel_type
      WHERE (scene_type IS NULL OR scene_type = '') AND channel_type IS NOT NULL AND channel_type != ''`,
    requires: ['channel_type', 'scene_type'],
  },
  {
    table: 'console_bot_notices',
    sql: `UPDATE "console_bot_notices" SET type = notice_type
      WHERE (type IS NULL OR type = '') AND notice_type IS NOT NULL AND notice_type != ''`,
    requires: ['notice_type', 'type'],
  },
  {
    table: 'console_bot_notices',
    sql: `UPDATE "console_bot_notices" SET scene_id = channel_id
      WHERE (scene_id IS NULL OR scene_id = '') AND channel_id IS NOT NULL AND channel_id != ''`,
    requires: ['channel_id', 'scene_id'],
  },
  {
    table: 'console_bot_notices',
    sql: `UPDATE "console_bot_notices" SET scene_type = channel_type
      WHERE (scene_type IS NULL OR scene_type = '') AND channel_type IS NOT NULL AND channel_type != ''`,
    requires: ['channel_type', 'scene_type'],
  },
  {
    table: 'console_bot_requests',
    sql: `UPDATE "console_bot_requests" SET scene_id = channel_id
      WHERE (scene_id IS NULL OR scene_id = '') AND channel_id IS NOT NULL AND channel_id != ''`,
    requires: ['channel_id', 'scene_id'],
  },
  {
    table: 'console_bot_requests',
    sql: `UPDATE "console_bot_requests" SET scene_type = channel_type
      WHERE (scene_type IS NULL OR scene_type = '') AND channel_type IS NOT NULL AND channel_type != ''`,
    requires: ['channel_type', 'scene_type'],
  },
];

function resolveDbQuery(
  dbFeature: DbQueryable,
): ((sql: string, params?: unknown[]) => Promise<unknown>) | undefined {
  const direct = dbFeature.query;
  if (typeof direct === 'function') return direct.bind(dbFeature);
  const db = dbFeature.db;
  const nested = db?.query;
  if (typeof nested === 'function' && db) return nested.bind(db);
  return undefined;
}

function resolveDbDialect(dbFeature: DbQueryable): string {
  return dbFeature.db?.dialect?.name ?? '';
}

export async function listSqliteTableColumns(
  query: (sql: string) => Promise<unknown>,
  tableName: string,
): Promise<Set<string>> {
  const rows = (await query(`PRAGMA table_info("${tableName}")`)) as PragmaColumnRow[];
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows.map((r) => String(r.name ?? '')).filter(Boolean));
}

export async function upgradeSideEventSchema(dbFeature: DbQueryable): Promise<string[]> {
  const queryFn = resolveDbQuery(dbFeature);
  if (!queryFn) return [];

  const dialect = resolveDbDialect(dbFeature);
  if (dialect && dialect !== 'sqlite') return [];

  const added: string[] = [];
  for (const [table, columns] of Object.entries(SIDE_EVENT_SCHEMA_PATCHES)) {
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
      existing.add(column);
    }
  }

  const tableColumns = new Map<string, Set<string>>();
  for (const table of Object.keys(SIDE_EVENT_SCHEMA_PATCHES)) {
    try {
      tableColumns.set(table, await listSqliteTableColumns((sql) => queryFn(sql), table));
    } catch {
      // skip backfill for missing tables
    }
  }

  for (const rule of SIDE_EVENT_BACKFILL_RULES) {
    const cols = tableColumns.get(rule.table);
    if (!cols || cols.size === 0) continue;
    if (!rule.requires.every((c) => cols.has(c))) continue;
    try {
      await queryFn(rule.sql);
    } catch {
      // best-effort backfill
    }
  }

  return added;
}

let migrationHookRegistered = false;

/** 在 db.start() 后、ORM 写入前注册（可重复调用，仅注册一次） */
export function registerSideEventSchemaMigrationHook(
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
): void {
  if (migrationHookRegistered) return;
  migrationHookRegistered = true;

  onDatabaseAfterStart(async (db) => {
    try {
      const added = await upgradeSideEventSchema({ db } as DbQueryable);
      if (added.length > 0) {
        logger.info(`Database: side-event schema migrated (${added.join(', ')})`);
      }
    } catch (e) {
      logger.error('Database: side-event schema migration failed:', e);
    }
  });
}
