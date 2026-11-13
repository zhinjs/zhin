import { createDatabaseHost } from '@zhin.js/core/runtime';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '@zhin.js/host-http';

/**
 * Console SQL against real servers (full-validation): the single-statement protocol holds even
 * for text the Console lexer would split differently, reads are bounded, MySQL MODIFY keeps the
 * column definition it does not change.
 */
const live = process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1';

type Host = ReturnType<typeof createDatabaseHost>;
type Raw = { transaction<T>(callback: (trx: { queryStatement(sql: string, options?: { maxRows?: number }): Promise<unknown>; query(sql: string): Promise<unknown> }) => Promise<T>, options?: { readOnly?: boolean }): Promise<T>; query(sql: string): Promise<unknown> };

const rpc = async (host: Host, message: Record<string, unknown>) => {
  const request = { requestId: 1, ...message };
  return pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { database: host.console } as never))!;
};

describe.skipIf(!live)('Console SQL on PostgreSQL (live)', () => {
  const host = createDatabaseHost({
    dialect: 'pg',
    host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
    user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
  } as never);
  const raw = host.db as unknown as Raw;

  beforeAll(async () => {
    await host.start();
    await raw.query('DROP TABLE IF EXISTS zhin_console_victim');
    await raw.query('CREATE TABLE zhin_console_victim (a int)');
    await raw.query('INSERT INTO zhin_console_victim VALUES (1), (2)');
  });
  afterAll(async () => {
    await raw.query('DROP TABLE IF EXISTS zhin_console_victim').catch(() => undefined);
    await host.stop();
  });

  it('refuses a second statement at the server, whatever the Console lexer saw', async () => {
    // Bypasses the lexer: the extended protocol alone refuses the hidden statements.
    await expect(raw.transaction(trx => trx.queryStatement("SELECT E'\\''; COMMIT; DELETE FROM zhin_console_victim; --'")))
      .rejects.toThrow(/multiple commands/);
    await expect(raw.transaction(trx => trx.queryStatement('SELECT 1; DELETE FROM zhin_console_victim')))
      .rejects.toThrow(/multiple commands/);
    for (const sql of [
      "SELECT E'\\''; COMMIT; DELETE FROM zhin_console_victim; --'",
      "SELECT 1 /* /* */ ' */; COMMIT; INSERT INTO zhin_console_victim VALUES (99); --'",
      "SELECT $a1$ ' $a1$; COMMIT; DELETE FROM zhin_console_victim; --'",
    ]) {
      expect((await rpc(host, { type: 'db:query', sql })).error, sql).toBeTruthy();
      expect((await rpc(host, { type: 'db:execute', sql, dryRun: true })).error, sql).toBeTruthy();
    }
    expect((await rpc(host, { type: 'db:query', sql: 'SELECT a FROM zhin_console_victim ORDER BY a' })).data).toMatchObject({ rows: [{ a: 1 }, { a: 2 }] });
  });

  it('rolls a dry run back and keeps statement_timeout', async () => {
    const dry = await rpc(host, { type: 'db:execute', sql: 'DELETE FROM zhin_console_victim', dryRun: true });
    expect(dry.data).toMatchObject({ dryRun: true, statements: [{ affected: 2 }] });
    expect((await rpc(host, { type: 'db:query', sql: 'SELECT count(*)::int AS n FROM zhin_console_victim' })).data).toMatchObject({ rows: [{ n: 2 }] });
    await expect(host.console!.query!('SELECT pg_sleep(5)', { timeoutMs: 200 })).rejects.toThrow(/statement timeout/);
    expect((await rpc(host, { type: 'db:query', sql: `SELECT "set_config"('statement_timeout', '0', true)` })).data).toEqual({ code: 'refused_statement' });
  });

  it('reads a large result through a cursor, only the rows it keeps', async () => {
    const started = Date.now();
    const result = await host.console!.query!('SELECT g, repeat(\'x\', 200) AS pad FROM generate_series(1, 3000000) g');
    expect(result).toMatchObject({ rowCount: 1000, truncated: true });
    expect(result.rows[999]).toMatchObject({ g: 1000 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await host.console!.query!('EXPLAIN SELECT 1')).toMatchObject({ truncated: false });
    expect(await host.console!.query!('SHOW statement_timeout')).toMatchObject({ rowCount: 1 });
  });
});

describe.skipIf(!live)('Console SQL on MySQL (live)', () => {
  const host = createDatabaseHost({
    dialect: 'mysql',
    host: process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306),
    user: process.env.ZHIN_TEST_MYSQL_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_MYSQL_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test',
    // Even when the project enables it, Console SQL never runs several statements.
    multipleStatements: true,
  } as never);
  const raw = host.db as unknown as Raw;

  beforeAll(async () => {
    await host.start();
    await raw.query('DROP TABLE IF EXISTS zhin_console_victim');
    await raw.query('DROP TABLE IF EXISTS zhin_console_modify');
    await raw.query('CREATE TABLE zhin_console_victim (a int)');
    await raw.query('INSERT INTO zhin_console_victim VALUES (1), (2)');
    await raw.query(`CREATE TABLE zhin_console_modify (
      id int PRIMARY KEY,
      updated timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      path varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT 'C:\\\\dir' COMMENT 'win path'
    )`);
  });
  afterAll(async () => {
    await raw.query('DROP TABLE IF EXISTS zhin_console_victim').catch(() => undefined);
    await raw.query('DROP TABLE IF EXISTS zhin_console_modify').catch(() => undefined);
    await host.stop();
  });

  it('refuses a second statement through prepared statements', async () => {
    await expect(raw.transaction(trx => trx.queryStatement('SELECT 1; DELETE FROM zhin_console_victim'))).rejects.toThrow();
    expect((await rpc(host, { type: 'db:query', sql: 'SELECT a FROM zhin_console_victim ORDER BY a' })).data).toMatchObject({ rows: [{ a: 1 }, { a: 2 }] });
  });

  it('streams a large result and keeps only the capped rows', async () => {
    const result = await host.console!.query!('SELECT 1 AS x FROM information_schema.columns a CROSS JOIN information_schema.columns b LIMIT 20000');
    expect(result).toMatchObject({ rowCount: 1000, truncated: true });
  });

  it('changes one attribute with MODIFY and keeps the rest of the column', async () => {
    const plan = await host.console!.applySchema!({ kind: 'alter-column', table: 'zhin_console_modify', column: 'updated', nullable: true });
    expect(plan.statements[0]).toContain('DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await host.console!.applySchema!({ kind: 'alter-column', table: 'zhin_console_modify', column: 'path', nullable: false });
    const rows = await raw.query(`SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, EXTRA AS extra, COLUMN_COMMENT AS comment, COLLATION_NAME AS coll
      FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'zhin_console_modify' ORDER BY ORDINAL_POSITION`) as Record<string, unknown>[];
    const byName = Object.fromEntries(rows.map(row => [row.name, row]));
    expect(byName.updated).toMatchObject({ nullable: 'YES', def: 'CURRENT_TIMESTAMP' });
    expect(String(byName.updated!.extra)).toMatch(/on update CURRENT_TIMESTAMP/i);
    expect(byName.path).toMatchObject({ nullable: 'NO', def: 'C:\\dir', comment: 'win path', coll: 'utf8mb4_bin' });
  });
});
