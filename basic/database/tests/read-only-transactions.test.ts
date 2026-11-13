import { describe, it, expect } from 'vitest';
import { PostgreSQLDialect } from '../src/dialects/pg.js';
import { MySQLDialect } from '../src/dialects/mysql.js';

describe('declared read-only transactions', () => {
  it('opens PostgreSQL transactions READ ONLY (pooled and single connection)', async () => {
    const pooled = new PostgreSQLDialect<any>({ pool: {} });
    const sent: string[] = [];
    const client = { query: async (sql: string) => { sent.push(sql); return { rows: [], fields: [] }; }, release: () => undefined };
    (pooled as any).pool = { connect: async () => client };
    await (await pooled.beginTransaction({ readOnly: true })).rollback();
    await (await pooled.beginTransaction({ readOnly: true, isolationLevel: 'REPEATABLE_READ' })).rollback();
    await (await pooled.beginTransaction()).rollback();
    expect(sent).toEqual(['BEGIN READ ONLY', 'ROLLBACK', 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK', 'BEGIN', 'ROLLBACK']);

    const single = new PostgreSQLDialect<any>({});
    const direct: string[] = [];
    (single as any).query = async (sql: string) => { direct.push(sql); return []; };
    await (await single.beginTransaction({ readOnly: true })).commit();
    expect(direct).toEqual(['BEGIN READ ONLY', 'COMMIT']);
  });

  it('keeps the PostgreSQL command and row count of DML on the result array', async () => {
    const dialect = new PostgreSQLDialect<any>({});
    (dialect as any).connection = { query: async () => ({ rows: [], fields: [], command: 'UPDATE', rowCount: 3 }) };
    const result = await dialect.query('UPDATE t SET a = 1') as unknown as { rowCount: number; command: string };
    expect(result).toEqual([]);
    expect(result.rowCount).toBe(3);
    expect(result.command).toBe('UPDATE');
    expect(Object.keys(result)).toEqual([]);
  });

  it('starts MySQL transactions with START TRANSACTION READ ONLY', async () => {
    const dialect = new MySQLDialect<any>({ pool: {} } as any);
    const sent: string[] = [];
    const connection = {
      query: async (sql: string) => { sent.push(sql); return [[], []]; },
      beginTransaction: async () => { sent.push('BEGIN'); },
      rollback: async () => { sent.push('ROLLBACK'); },
      commit: async () => { sent.push('COMMIT'); },
      release: () => undefined,
    };
    (dialect as any).pool = { getConnection: async () => connection };
    await (await dialect.beginTransaction({ readOnly: true })).rollback();
    await (await dialect.beginTransaction()).commit();
    expect(sent).toEqual(['START TRANSACTION READ ONLY', 'ROLLBACK', 'BEGIN', 'COMMIT']);
  });
});
