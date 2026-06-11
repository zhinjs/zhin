import { describe, it, expect, vi } from 'vitest';
import { upgradeBotIdToEndpointIdColumns } from '../src/init/upgrade-endpoint-id-schema.js';

describe('upgradeBotIdToEndpointIdColumns', () => {
  it('renames bot_id on any user table that still has it', async () => {
    const tables: Record<string, string[]> = {
      unified_inbox_notice: ['id', 'adapter', 'bot_id'],
      agent_sessions: ['session_id', 'bot_id', 'platform'],
      console_bot_notices: ['id', 'adapter', 'endpoint_id'],
    };
    const executed: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executed.push(sql);
      if (sql.includes('sqlite_master')) {
        return Object.keys(tables).map((name) => ({ name }));
      }
      const pragma = sql.match(/^PRAGMA table_info\("(\w+)"\)$/);
      if (pragma) {
        return (tables[pragma[1]] ?? []).map((name) => ({ name }));
      }
      return [];
    });

    const renamed = await upgradeBotIdToEndpointIdColumns({
      db: { query, dialect: { name: 'sqlite' } },
    });

    expect(renamed).toEqual([
      'unified_inbox_notice.bot_id→endpoint_id',
      'agent_sessions.bot_id→endpoint_id',
    ]);
    expect(executed).toContain(
      'ALTER TABLE "agent_sessions" RENAME COLUMN "bot_id" TO "endpoint_id"',
    );
  });

  it('skips non-sqlite dialects', async () => {
    const query = vi.fn();
    const renamed = await upgradeBotIdToEndpointIdColumns({
      db: { query, dialect: { name: 'postgres' } },
    });
    expect(renamed).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
