import { describe, expect, it, vi } from 'vitest';
import {
  SIDE_EVENT_SCHEMA_PATCHES,
  listSqliteTableColumns,
  upgradeSideEventSchema,
} from '../src/setup/upgrade-side-event-schema.js';

describe('upgradeSideEventSchema', () => {
  it('listSqliteTableColumns reads PRAGMA table_info', async () => {
    const query = vi.fn().mockResolvedValue([
      { name: 'adapter' },
      { name: 'channel_id' },
    ]);
    const cols = await listSqliteTableColumns(query, 'unified_inbox_notice');
    expect(query).toHaveBeenCalledWith('PRAGMA table_info("unified_inbox_notice")');
    expect(cols).toEqual(new Set(['adapter', 'channel_id']));
  });

  it('adds missing side-event columns on sqlite', async () => {
    const tables: Record<string, string[]> = {
      unified_inbox_notice: [
        'id', 'adapter', 'endpoint_id', 'platform_notice_id', 'type', 'sub_type',
        'channel_id', 'channel_type', 'operator_id', 'operator_name', 'payload', 'created_at',
      ],
      console_bot_notices: [
        'id', 'adapter', 'endpoint_id', 'notice_type', 'channel_type', 'channel_id',
        'payload', 'created_at', 'consumed',
      ],
    };
    const executed: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executed.push(sql);
      const alter = sql.match(/^ALTER TABLE "(\w+)" ADD COLUMN "(\w+)" /);
      if (alter) {
        const [, table, column] = alter;
        tables[table] = [...(tables[table] ?? []), column];
        return [];
      }
      const pragma = sql.match(/^PRAGMA table_info\("(\w+)"\)$/);
      if (pragma) {
        return (tables[pragma[1]] ?? []).map((name) => ({ name }));
      }
      return [];
    });

    const added = await upgradeSideEventSchema({
      db: { query, dialect: { name: 'sqlite' } },
    });

    expect(added).toEqual([
      'unified_inbox_notice.scene_type',
      'unified_inbox_notice.scene_id',
      'unified_inbox_notice.actor_id',
      'unified_inbox_notice.actor_name',
      'console_bot_notices.platform_notice_id',
      'console_bot_notices.type',
      'console_bot_notices.scene_type',
      'console_bot_notices.scene_id',
      'console_bot_notices.sub_type',
      'console_bot_notices.actor_id',
      'console_bot_notices.actor_name',
      'console_bot_notices.target_id',
      'console_bot_notices.target_name',
    ]);
    expect(executed).toContain('ALTER TABLE "unified_inbox_notice" ADD COLUMN "scene_type" TEXT');
    expect(executed).toContain('ALTER TABLE "console_bot_notices" ADD COLUMN "platform_notice_id" TEXT');
    expect(executed.some((sql) => sql.includes('UPDATE "unified_inbox_notice" SET scene_id = channel_id'))).toBe(true);
    expect(executed.some((sql) => sql.includes('UPDATE "console_bot_notices" SET type = notice_type'))).toBe(true);
  });

  it('skips when columns already exist', async () => {
    const allCols = Object.fromEntries(
      Object.entries(SIDE_EVENT_SCHEMA_PATCHES).map(([table, cols]) => [
        table,
        [...Object.keys(cols), 'id'],
      ]),
    );
    const query = vi.fn(async (sql: string) => {
      const pragma = sql.match(/^PRAGMA table_info\("(\w+)"\)$/);
      if (pragma) {
        return (allCols[pragma[1]] ?? []).map((name) => ({ name }));
      }
      return [];
    });

    const added = await upgradeSideEventSchema({
      db: { query, dialect: { name: 'sqlite' } },
    });
    expect(added).toEqual([]);
    expect(query.mock.calls.filter((c) => String(c[0]).startsWith('ALTER TABLE'))).toHaveLength(0);
  });

  it('skips non-sqlite dialects', async () => {
    const query = vi.fn();
    const added = await upgradeSideEventSchema({
      db: { query, dialect: { name: 'postgres' } },
    });
    expect(added).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
