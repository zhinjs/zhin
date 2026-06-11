import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_SESSION_TREE_SCHEMA_PATCHES,
  listSqliteTableColumns,
  resolveAgentDbQuery,
  upgradeAgentSessionTreeSchema,
} from '../src/init/upgrade-agent-db-schema.js';

describe('upgradeAgentSessionTreeSchema', () => {
  it('listSqliteTableColumns reads PRAGMA table_info', async () => {
    const query = vi.fn().mockResolvedValue([
      { name: 'session_id' },
      { name: 'role' },
    ]);
    const cols = await listSqliteTableColumns(query, 'agent_messages');
    expect(query).toHaveBeenCalledWith('PRAGMA table_info("agent_messages")');
    expect(cols).toEqual(new Set(['session_id', 'role']));
  });

  it('adds missing session-tree columns on sqlite', async () => {
    const tables: Record<string, string[]> = {
      agent_messages: ['session_id', 'role', 'payload', 'timestamp'],
      agent_sessions: ['session_id', 'session_key', 'status'],
      agent_summaries: ['session_id', 'summary'],
    };
    const executed: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executed.push(sql);
      const pragma = sql.match(/^PRAGMA table_info\("(\w+)"\)$/);
      if (pragma) {
        return (tables[pragma[1]] ?? []).map((name) => ({ name }));
      }
      return [];
    });

    const added = await upgradeAgentSessionTreeSchema({
      db: { query, dialect: { name: 'sqlite' } },
    });

    expect(added).toEqual([
      'agent_messages.id',
      'agent_messages.parent_id',
      'agent_messages.extra',
      'agent_sessions.active_leaf_message_id',
      'agent_summaries.branch_anchor_message_id',
    ]);
    expect(executed).toContain(
      'ALTER TABLE "agent_messages" ADD COLUMN "parent_id" INTEGER',
      'ALTER TABLE "agent_messages" ADD COLUMN "extra" TEXT',
    );
  });

  it('skips when columns already exist', async () => {
    const allCols = Object.fromEntries(
      Object.entries(AGENT_SESSION_TREE_SCHEMA_PATCHES).map(([table, cols]) => [
        table,
        [...Object.keys(cols), 'session_id'],
      ]),
    );
    const query = vi.fn(async (sql: string) => {
      const pragma = sql.match(/^PRAGMA table_info\("(\w+)"\)$/);
      if (pragma) {
        return (allCols[pragma[1]] ?? []).map((name) => ({ name }));
      }
      return [];
    });

    const added = await upgradeAgentSessionTreeSchema({
      db: { query, dialect: { name: 'sqlite' } },
    });
    expect(added).toEqual([]);
    expect(query.mock.calls.filter(([s]) => s.startsWith('ALTER'))).toHaveLength(0);
  });
});

describe('resolveAgentDbQuery', () => {
  it('binds nested db.query so class methods keep this', async () => {
    const query = vi.fn(async function (this: { isStarted: boolean }, sql: string) {
      if (!this.isStarted) throw new Error('lost this');
      return sql;
    });
    const db = { isStarted: true, query, dialect: { name: 'sqlite' } };
    const bound = resolveAgentDbQuery({ db });
    expect(bound).toBeTypeOf('function');
    await expect(bound!('SELECT 1')).resolves.toBe('SELECT 1');
  });
});
