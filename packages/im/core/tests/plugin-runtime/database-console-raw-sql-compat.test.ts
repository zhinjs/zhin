import { createDatabaseHost, rawSqlCompatibilityProblem } from '../../src/plugin-runtime/im/host/database-host-installer.js';

describe('raw SQL needs the server to read text like the Console lexer', () => {
  const probe = (value: unknown, isolated = true) => ({ query: vi.fn(async () => [value]), isolatedReads: () => isolated });

  it('checks PostgreSQL standard_conforming_strings', async () => {
    expect(await rawSqlCompatibilityProblem('pg', probe({ value: 'on' }))).toBeUndefined();
    expect(await rawSqlCompatibilityProblem('pg', probe({ value: 'off' }))).toMatch(/standard_conforming_strings = on.*'off'/);
  });

  it('checks MySQL sql_mode for NO_BACKSLASH_ESCAPES and ANSI_QUOTES', async () => {
    expect(await rawSqlCompatibilityProblem('mysql', probe({ mode: 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES' }))).toBeUndefined();
    expect(await rawSqlCompatibilityProblem('mysql', probe({ mode: 'STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES' }))).toMatch(/NO_BACKSLASH_ESCAPES/);
    expect(await rawSqlCompatibilityProblem('mysql', probe({ mode: 'ANSI_QUOTES' }))).toMatch(/ANSI_QUOTES/);
  });

  it('needs a file database for SQLite', async () => {
    expect(await rawSqlCompatibilityProblem('sqlite', probe({}, true))).toBeUndefined();
    expect(await rawSqlCompatibilityProblem('sqlite', probe({}, false))).toMatch(/in-memory/);
  });

  it('turns raw SQL off (capabilities and RPCs) when the server reads text differently, re-checked on every run', async () => {
    let mode = 'NO_BACKSLASH_ESCAPES';
    const sent: string[] = [];
    // The check runs on the restricted account's connection, where raw SQL would run (ADR 0059 §4).
    const restricted = {
      start: async () => undefined,
      stop: async () => undefined,
      query: async (sql: string) => {
        sent.push(sql);
        if (/@@SESSION\.sql_mode/.test(sql)) return [{ mode }];
        if (/CURRENT_USER\(\) AS account/.test(sql)) return [{ account: 'zhin_console_x@%', db: 'bot' }];
        if (/USER_PRIVILEGES/.test(sql)) return [{ privilege: 'USAGE', grantable: 'NO' }];
        if (/TABLE_PRIVILEGES/.test(sql)) return [{ n: 0 }];
        if (/CURRENT_ROLE/.test(sql)) return [{ role: 'NONE' }];
        return [];
      },
      transaction: vi.fn(async () => { throw new Error('must not run'); }),
    };
    const host = createDatabaseHost({ dialect: 'mysql', user: 'zhin', console: { user: 'zhin_console_x', password: 'p' } } as never, { openConsoleConnection: () => restricted });
    const raw = host.db as unknown as { start(): Promise<void>; query(sql: string): Promise<unknown>; transaction: unknown };
    raw.start = async () => undefined;
    raw.query = async (sql: string) => (/CURRENT_USER/.test(sql) ? [{ account: 'zhin@%' }] : []);
    raw.transaction = vi.fn(async () => { throw new Error('main connection must not run Console SQL'); });
    await host.start();
    expect(host.console!.info().capabilities).toMatchObject({ sql: false, schema: true, sqlIsolation: 'restricted-credential', sqlReason: expect.stringContaining('NO_BACKSLASH_ESCAPES'), reason: expect.stringContaining('NO_BACKSLASH_ESCAPES') });
    await expect(host.console!.query!("select '\\\\', 1 into outfile '/tmp/x' #'")).rejects.toMatchObject({ code: 'unsupported' });
    await expect(host.console!.execute!('delete from t')).rejects.toMatchObject({ code: 'unsupported' });
    expect(restricted.transaction).not.toHaveBeenCalled();
    mode = 'STRICT_TRANS_TABLES';
    await expect(host.console!.execute!('delete from t', { dryRun: true })).rejects.toThrow('must not run');
    expect(raw.transaction).not.toHaveBeenCalled();
    expect(host.console!.info().capabilities).toMatchObject({ sql: true });
    expect(sent.filter(sql => /sql_mode/.test(sql)).length).toBeGreaterThanOrEqual(3);
  });
});
