import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PostgreSQLDialect } from '../src/dialects/pg.js';
import { MySQLDialect } from '../src/dialects/mysql.js';
import { Sqlite, SQLiteDialect, SqliteQueryTimeoutError } from '../src/dialects/sqlite.js';

describe('Transaction.queryStatement: one statement per protocol', () => {
  it('sends PostgreSQL statements through the extended protocol (pooled and single connection)', async () => {
    const sent: unknown[] = [];
    const client = {
      query: async (query: unknown) => { sent.push(query); return { rows: [{ a: 1 }, { a: 2 }, { a: 3 }], fields: [] }; },
      release: () => undefined,
    };
    const pooled = new PostgreSQLDialect<any>({ pool: {} });
    (pooled as any).pool = { connect: async () => client };
    const trx = await pooled.beginTransaction({ readOnly: true });
    const rows = await trx.queryStatement!('SELECT a FROM t', { maxRows: 2 }) as unknown as { truncated: boolean };
    await trx.rollback();
    expect(sent).toContainEqual({ text: 'SELECT a FROM t', values: [], queryMode: 'extended' });
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(rows.truncated).toBe(true);

    const single = new PostgreSQLDialect<any>({});
    const direct: unknown[] = [];
    (single as any).connection = { query: async (query: unknown) => { direct.push(query); return { rows: [], fields: [] }; } };
    const singleTrx = await single.beginTransaction();
    await singleTrx.queryStatement!('DELETE FROM t');
    await singleTrx.rollback();
    expect(direct).toContainEqual({ text: 'DELETE FROM t', values: [], queryMode: 'extended' });
  });

  it('runs MySQL statements as prepared statements and streams past the cap', async () => {
    const executed: string[] = [];
    const core = {
      execute(sql: string, values: unknown[]) {
        executed.push(sql);
        expect(values).toEqual([]);
        const command = new EventEmitter();
        queueMicrotask(() => {
          command.emit('fields', [{ name: 'x' }]);
          for (let x = 1; x <= 10; x += 1) command.emit('result', { x });
          command.emit('end');
        });
        return command;
      },
    };
    const connection = {
      connection: core,
      query: async () => [[], []],
      execute: async () => { throw new Error('the capped path streams'); },
      beginTransaction: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
    };
    const dialect = new MySQLDialect<any>({ pool: {}, multipleStatements: true } as any);
    (dialect as any).pool = { getConnection: async () => connection };
    const trx = await dialect.beginTransaction({ readOnly: true });
    const rows = await trx.queryStatement!('SELECT x FROM t', { maxRows: 3 }) as unknown as { truncated: boolean };
    expect(rows).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
    expect(rows.truncated).toBe(true);
    expect(executed).toEqual(['SELECT x FROM t']);
    await trx.rollback();
  });

  it('iterates SQLite rows only up to the cap and passes through Database.transaction', async () => {
    const db = new Sqlite<any>({ filename: ':memory:' });
    await db.start();
    try {
      const rows = await db.transaction(trx => trx.queryStatement('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT x FROM n', { maxRows: 4 }), { readOnly: true }) as unknown as { truncated: boolean };
      expect(rows).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }]);
      expect(rows.truncated).toBe(true);
      // prepare() compiles the first statement only.
      await db.query('CREATE TABLE t (a INTEGER)');
      await db.transaction(trx => trx.queryStatement('SELECT 1; INSERT INTO t VALUES (1)'));
      expect(await db.query('SELECT count(*) AS n FROM t')).toEqual([{ n: 0 }]);
    } finally { await db.stop(); }
  });
});

describe('SQLite isolated reads', () => {
  it('reads on a read-only connection in a worker, capped, and stops at the time budget', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-isolated-read-'));
    const dialect = new SQLiteDialect<any>({ filename: join(directory, 'x.db') });
    await dialect.connect();
    try {
      await dialect.query('CREATE TABLE t (a INTEGER, doc TEXT)');
      dialect.registerTableSchema('t', { a: { type: 'integer' }, doc: { type: 'json' } });
      await dialect.query('INSERT INTO t VALUES (1, \'{"k":1}\'), (2, \'{"k":2}\'), (3, NULL)');
      expect(dialect.supportsIsolatedReads()).toBe(true);
      expect(await dialect.queryReadOnlyIsolated('SELECT a, doc FROM t ORDER BY a', { maxRows: 2, timeoutMs: 5000 }))
        .toEqual({ columns: ['a', 'doc'], rows: [{ a: 1, doc: { k: 1 } }, { a: 2, doc: { k: 2 } }], truncated: true });
      await expect(dialect.queryReadOnlyIsolated('DELETE FROM t', { maxRows: 2, timeoutMs: 5000 })).rejects.toThrow(/readonly|read-only/i);

      let ticks = 0;
      const interval = setInterval(() => { ticks += 1; }, 10);
      const started = Date.now();
      const slow = dialect.queryReadOnlyIsolated('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 20000000) SELECT count(*) AS n FROM c', { maxRows: 10, timeoutMs: 200 });
      await expect(slow).rejects.toBeInstanceOf(SqliteQueryTimeoutError);
      clearInterval(interval);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(ticks).toBeGreaterThan(5);
      // The stopped worker may still be inside its step: the next read is refused, not queued.
      await expect(dialect.queryReadOnlyIsolated('SELECT 1', { maxRows: 1, timeoutMs: 1000 })).rejects.toThrow(/still running/);
    } finally {
      await dialect.disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('is not available for in-memory databases', async () => {
    const dialect = new SQLiteDialect<any>({ filename: ':memory:' });
    await dialect.connect();
    expect(dialect.supportsIsolatedReads()).toBe(false);
    await dialect.disconnect();
  });
});
