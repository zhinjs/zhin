/**
 * ADR 0010 session-tree columns on existing SQLite DBs.
 * CREATE TABLE IF NOT EXISTS does not add new columns to old tables.
 */

export type AgentDbQueryable = {
  db?: {
    query?<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
    dialect?: { name?: string };
  };
  query?<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
};

type PragmaColumnRow = { name?: string };

/** table → column → SQLite type for ALTER TABLE ADD COLUMN */
export const AGENT_SESSION_TREE_SCHEMA_PATCHES: Record<string, Record<string, string>> = {
  agent_messages: {
    id: 'INTEGER',
    parent_id: 'INTEGER',
    extra: 'TEXT',
  },
  agent_sessions: {
    active_leaf_message_id: 'INTEGER',
  },
  agent_summaries: {
    branch_anchor_message_id: 'INTEGER',
  },
};

export function resolveAgentDbQuery(
  dbFeature: AgentDbQueryable,
): ((sql: string, params?: unknown[]) => Promise<unknown>) | undefined {
  const direct = dbFeature.query;
  if (typeof direct === 'function') {
    return direct.bind(dbFeature);
  }
  const db = dbFeature.db;
  const nested = db?.query;
  if (typeof nested === 'function' && db) {
    return nested.bind(db);
  }
  return undefined;
}

export function resolveAgentDbDialect(dbFeature: AgentDbQueryable): string {
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

export async function upgradeAgentSessionTreeSchema(
  dbFeature: AgentDbQueryable,
): Promise<string[]> {
  const queryFn = resolveAgentDbQuery(dbFeature);
  if (!queryFn) return [];

  const dialect = resolveAgentDbDialect(dbFeature);
  if (dialect && dialect !== 'sqlite') {
    return [];
  }

  const added: string[] = [];
  for (const [table, columns] of Object.entries(AGENT_SESSION_TREE_SCHEMA_PATCHES)) {
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

/** Populate agent_messages.id from SQLite rowid after ADD COLUMN. */
export async function backfillAgentMessageIdsFromRowid(
  dbFeature: AgentDbQueryable,
): Promise<number> {
  const queryFn = resolveAgentDbQuery(dbFeature);
  if (!queryFn) return 0;

  const dialect = resolveAgentDbDialect(dbFeature);
  if (dialect && dialect !== 'sqlite') return 0;

  let columns: Set<string>;
  try {
    columns = await listSqliteTableColumns((sql) => queryFn(sql), 'agent_messages');
  } catch {
    return 0;
  }
  if (!columns.has('id')) return 0;

  const countRows = (await queryFn(
    `SELECT COUNT(*) AS c FROM agent_messages WHERE id IS NULL`,
  )) as Array<{ c: number }>;
  const pending = Number(countRows?.[0]?.c ?? 0);
  if (pending <= 0) return 0;

  await queryFn(`UPDATE agent_messages SET id = rowid WHERE id IS NULL`);
  return pending;
}

export type AgentMessageBackfillRow = {
  id: number;
  session_id: string;
  parent_id: number | null;
  timestamp: number;
};

/** 将同 session 内 parent_id 为 null 的遗留行串成线性链（ADR 0010 迁移） */
export function planLinearParentBackfill(
  rows: AgentMessageBackfillRow[],
): Array<{ id: number; parent_id: number | null }> {
  const bySession = new Map<string, AgentMessageBackfillRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  const updates: Array<{ id: number; parent_id: number | null }> = [];
  for (const list of bySession.values()) {
    const sorted = [...list].sort(
      (a, b) => a.timestamp - b.timestamp || a.id - b.id,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const row = sorted[i]!;
      if (row.parent_id != null) continue;
      const prev = sorted[i - 1]!;
      updates.push({ id: row.id, parent_id: prev.id });
    }
  }
  return updates;
}

export async function backfillAgentMessageParentChains(
  dbFeature: AgentDbQueryable,
): Promise<number> {
  const queryFn = resolveAgentDbQuery(dbFeature);
  if (!queryFn) return 0;

  const dialect = resolveAgentDbDialect(dbFeature);
  if (dialect && dialect !== 'sqlite') return 0;

  let rows: AgentMessageBackfillRow[];
  try {
    rows = (await queryFn(
      `SELECT id, session_id, parent_id, timestamp FROM agent_messages ORDER BY session_id, timestamp, id`,
    )) as AgentMessageBackfillRow[];
  } catch {
    return 0;
  }
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const updates = planLinearParentBackfill(rows);
  for (const { id, parent_id } of updates) {
    await queryFn(`UPDATE agent_messages SET parent_id = ? WHERE id = ?`, [parent_id, id]);
  }
  return updates.length;
}

export async function repairAgentSessionActiveLeaves(
  dbFeature: AgentDbQueryable,
): Promise<number> {
  const queryFn = resolveAgentDbQuery(dbFeature);
  if (!queryFn) return 0;

  const dialect = resolveAgentDbDialect(dbFeature);
  if (dialect && dialect !== 'sqlite') return 0;

  type SessionRow = { session_id: string; active_leaf_message_id: number | null };
  let sessions: SessionRow[];
  try {
    sessions = (await queryFn(
      `SELECT session_id, active_leaf_message_id FROM agent_sessions WHERE status = 'active'`,
    )) as SessionRow[];
  } catch {
    return 0;
  }
  if (!Array.isArray(sessions)) return 0;

  let repaired = 0;
  for (const session of sessions) {
    if (session.active_leaf_message_id != null) continue;
    const maxRows = (await queryFn(
      `SELECT MAX(id) AS max_id FROM agent_messages WHERE session_id = ?`,
      [session.session_id],
    )) as Array<{ max_id: number | null }>;
    const maxId = maxRows?.[0]?.max_id;
    if (maxId == null) continue;
    await queryFn(
      `UPDATE agent_sessions SET active_leaf_message_id = ? WHERE session_id = ?`,
      [maxId, session.session_id],
    );
    repaired += 1;
  }
  return repaired;
}

export async function upgradeAgentSessionTreeData(
  dbFeature: AgentDbQueryable,
): Promise<{
  columns: string[];
  idsBackfilled: number;
  parentLinks: number;
  activeLeaves: number;
}> {
  const columns = await upgradeAgentSessionTreeSchema(dbFeature);
  const idsBackfilled = await backfillAgentMessageIdsFromRowid(dbFeature);
  const parentLinks = await backfillAgentMessageParentChains(dbFeature);
  const activeLeaves = await repairAgentSessionActiveLeaves(dbFeature);
  return { columns, idsBackfilled, parentLinks, activeLeaves };
}
