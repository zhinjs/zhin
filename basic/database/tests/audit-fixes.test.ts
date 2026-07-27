/**
 * 第二轮审计修复的回归测试
 * - parseCondition：Date 等带原型对象按标量等值处理；未知操作符抛错
 * - migration：无显式 down 时先 dry-run 校验再执行；formatDefault 转义单引号
 */
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import { Sqlite } from '../src/dialects/sqlite.js';
import { MigrationRunner, defineMigration } from '../src/migration.js';

const require = createRequire(import.meta.url);
let sqliteAvailable = false;
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.close();
  sqliteAvailable = true;
} catch {
  // Node 内置 SQLite 需要 Node.js 22.5+
}

interface TestSchema {
  events: { id: number; created_at: Date; name: string };
}

describe.skipIf(!sqliteAvailable)('audit fixes: parseCondition', () => {
  let db: Sqlite<TestSchema>;

  beforeEach(() => {
    db = new Sqlite<TestSchema>({ filename: ':memory:' });
  });

  it('Date 值应生成等值条件而非静默丢弃', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const { query: sql, params } = db.buildQuery({
      type: 'select',
      tableName: 'events',
      conditions: { created_at: date },
    } as any);
    expect(sql).toContain('WHERE');
    expect(sql).toMatch(/"created_at" = \?/);
    expect(params).toEqual([date]);
  });

  it('普通对象操作符仍正常工作', () => {
    const { query: sql, params } = db.buildQuery({
      type: 'select',
      tableName: 'events',
      conditions: { id: { $gt: 5 } },
    } as any);
    expect(sql).toMatch(/"id" > \?/);
    expect(params).toEqual([5]);
  });

  it('未知操作符应抛错而非静默忽略', () => {
    expect(() =>
      db.buildQuery({
        type: 'select',
        tableName: 'events',
        conditions: { id: { $bogus: 1 } },
      } as any),
    ).toThrow(/unknown operator/);
  });
});

describe.skipIf(!sqliteAvailable)('audit fixes: migration', () => {
  let db: Sqlite<any>;
  let runner: MigrationRunner;

  beforeEach(async () => {
    db = new Sqlite<any>({ filename: ':memory:' });
    await db.start();
    runner = new MigrationRunner(db as any);
  });

  it('无显式 down 且不可反向时，应先校验再执行（数据库不被修改）', async () => {
    await db.query('CREATE TABLE "keep_me" ("id" INTEGER PRIMARY KEY)');

    runner.add(
      defineMigration({
        name: '001_drop_keep_me',
        up: async (ctx) => {
          await ctx.dropTable('keep_me'); // dropTable 无法自动反向
        },
      }),
    );

    await expect(runner.migrate()).rejects.toThrow(/Cannot auto-reverse/);

    // dry-run 校验在执行之前，表不应被删除
    const rows = (await db.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='keep_me'`,
    )) as any[];
    expect(rows).toHaveLength(1);
  });

  it('可自动反向的迁移仍正常执行并记录', async () => {
    runner.add(
      defineMigration({
        name: '002_create_table',
        up: async (ctx) => {
          await ctx.createTable('things', {
            id: { type: 'integer', primary: true },
          });
        },
      }),
    );
    const migrated = await runner.migrate();
    expect(migrated).toEqual(['002_create_table']);
    const rows = (await db.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='things'`,
    )) as any[];
    expect(rows).toHaveLength(1);
  });

  it('字符串默认值中的单引号应被转义', async () => {
    runner.add(
      defineMigration({
        name: '003_default_escape',
        up: async (ctx) => {
          await ctx.createTable('quotes', {
            id: { type: 'integer', primary: true },
            label: { type: 'text', default: "o'clock" },
          });
        },
      }),
    );
    await runner.migrate();
    await db.query('INSERT INTO "quotes" ("id") VALUES (?)', [1]);
    const rows = (await db.query('SELECT "label" FROM "quotes" WHERE "id" = ?', [1])) as any[];
    expect(rows[0].label).toBe("o'clock");
  });
});
