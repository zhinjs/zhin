import { randomBytes } from 'node:crypto';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { provisionConsoleRole, Registry, type ConsoleRolePlan } from '@zhin.js/database';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '@zhin.js/host-http';

/**
 * ADR 0059 §4 / §5 against real servers (full-validation): the owner's raw Console SQL runs on
 * the restricted account and cannot reach the gateway's data nor leave its grants — with the
 * Console's text checks on, and off (the account alone).
 */
const live = process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1';

type Raw = { start(): Promise<void>; stop(): Promise<void>; query(sql: string, params?: unknown[]): Promise<unknown> };
type Host = ReturnType<typeof createDatabaseHost>;

/** The error code the server (or the refusal) gave, or 'ok'. */
async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'ok';
  } catch (error) {
    const record = error as { code?: unknown; errno?: unknown };
    return String(record.errno ?? record.code ?? (error as Error).message);
  }
}

describe.skipIf(!live)('owner raw SQL on PostgreSQL (live)', () => {
  const main = {
    host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
    user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
  };
  const admin = Registry.create('pg', main as never) as unknown as Raw;
  let plan: ConsoleRolePlan;

  beforeAll(async () => {
    await admin.start();
    await admin.query('DROP TABLE IF EXISTS console_isolation_users, zhin_isolation_rows');
    await admin.query('CREATE TABLE zhin_isolation_rows (id int PRIMARY KEY, body text)');
    await admin.query("INSERT INTO zhin_isolation_rows VALUES (1, 'a')");
    plan = await provisionConsoleRole((sql, params) => admin.query(sql, params), { dialect: 'pg', projectKey: `isolation-${randomBytes(4).toString('hex')}` });
    // An old gateway table still in the project database (the import has not run yet): created
    // after the role, so the default privileges grant on it — the start-up refresh must revoke.
    await admin.query('CREATE TABLE console_isolation_users (id text PRIMARY KEY, password_hash text)');
    await admin.query("INSERT INTO console_isolation_users VALUES ('u1', 'scrypt$secret')");
  });
  afterAll(async () => {
    await admin.query('DROP TABLE IF EXISTS console_isolation_users, zhin_isolation_rows').catch(() => undefined);
    if (plan) {
      await admin.query(`DROP OWNED BY "${plan.user}"`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS "${plan.user}"`).catch(() => undefined);
    }
    await admin.stop();
  });

  describe.each([true, false])('text guard %s', (textGuard) => {
    let host: Host;
    beforeAll(async () => {
      host = createDatabaseHost({ dialect: 'pg', ...main, console: { user: plan.user, password: plan.password } } as never, { textGuard });
      await host.start();
    });
    afterAll(async () => { await host?.stop(); });

    it('reports restricted-credential isolation and works on instance rows', async () => {
      expect(host.console!.info().capabilities).toMatchObject({ sql: true, sqlIsolation: 'restricted-credential' });
      expect((await host.console!.query!('SELECT id FROM zhin_isolation_rows')).rows).toEqual([{ id: 1 }]);
      expect((await host.console!.execute!("UPDATE zhin_isolation_rows SET body = body || 'b' WHERE id = 1")).statements[0]).toMatchObject({ affected: 1 });
    });

    it('cannot read or change gateway data, nor leave its grants', async () => {
      const attempts: Record<string, () => Promise<unknown>> = {
        'read console_isolation_users': () => host.console!.query!('SELECT password_hash FROM console_isolation_users'),
        'write console_isolation_users': () => host.console!.execute!("UPDATE console_isolation_users SET password_hash = 'x'"),
        'SET ROLE': () => host.console!.execute!(`SET ROLE "${main.user}"`),
        "set_config('role')": () => host.console!.query!(`SELECT set_config('role', '${main.user}', true)`),
        'CREATE FUNCTION': () => host.console!.execute!('CREATE FUNCTION public.zhin_isolation_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'),
        'CREATE TABLE': () => host.console!.execute!('CREATE TABLE zhin_isolation_evil (a int)'),
        'pg_authid': () => host.console!.query!('SELECT rolpassword FROM pg_authid'),
        'pg_read_binary_file': () => host.console!.query!("SELECT pg_read_binary_file('/etc/passwd')"),
        'COPY PROGRAM': () => host.console!.execute!("COPY zhin_isolation_rows TO PROGRAM 'id'"),
        'lo_import': () => host.console!.query!("SELECT lo_import('/etc/passwd')"),
      };
      for (const [name, attempt] of Object.entries(attempts)) {
        const code = await outcome(attempt());
        expect(code, name).not.toBe('ok');
        // Without the text checks the server itself refuses: insufficient privilege.
        if (!textGuard) expect(code, name).toBe('42501');
      }
      expect(await admin.query('SELECT password_hash FROM console_isolation_users')).toEqual([{ password_hash: 'scrypt$secret' }]);
    });

    it('answers DDL with SQLSTATE 42501 so the Console can point to the schema editor', async () => {
      const request = { requestId: 1, type: 'db:execute', sql: 'CREATE TABLE zhin_isolation_ddl (a int)' };
      const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { database: host.console } as never))!;
      expect(reply).toMatchObject({ data: { sqlState: '42501' } });
    });
  });

  it('logs in as the console user also when the main account comes from a connection string (review M1)', async () => {
    const url = `postgresql://${encodeURIComponent(main.user)}:${encodeURIComponent(main.password)}@${main.host}:${main.port}/${main.database}?user=${encodeURIComponent(main.user)}&password=${encodeURIComponent(main.password)}`;
    const host = createDatabaseHost({ dialect: 'pg', connectionString: url, console: { user: plan.user, password: plan.password } } as never);
    await host.start();
    try {
      expect(host.console!.info().capabilities).toMatchObject({ sql: true });
      expect((await host.console!.query!('SELECT current_user AS who')).rows).toEqual([{ who: plan.user }]);
    } finally {
      await host.stop();
    }
  });

  it('answers 42P01 once the old table is gone (imported into gateway.db)', async () => {
    await admin.query('DROP TABLE IF EXISTS console_isolation_users');
    const host = createDatabaseHost({ dialect: 'pg', ...main, console: { user: plan.user, password: plan.password } } as never, { textGuard: false });
    await host.start();
    try {
      expect(await outcome(host.console!.query!('SELECT password_hash FROM console_isolation_users'))).toBe('42P01');
    } finally {
      await host.stop();
    }
  });
});

describe.skipIf(!live || !process.env.ZHIN_TEST_MYSQL_ROOT_PASSWORD)('owner raw SQL on MySQL (live)', () => {
  const main = {
    host: process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306),
    user: process.env.ZHIN_TEST_MYSQL_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_MYSQL_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test',
  };
  const admin = Registry.create('mysql', { ...main, user: process.env.ZHIN_TEST_MYSQL_ROOT_USER ?? 'root', password: process.env.ZHIN_TEST_MYSQL_ROOT_PASSWORD } as never) as unknown as Raw;
  let plan: ConsoleRolePlan;

  beforeAll(async () => {
    await admin.start();
    await admin.query('DROP TABLE IF EXISTS zhin_isolation_rows');
    await admin.query('CREATE TABLE zhin_isolation_rows (id int PRIMARY KEY, body text)');
    await admin.query("INSERT INTO zhin_isolation_rows VALUES (1, 'a')");
    plan = await provisionConsoleRole((sql, params) => admin.query(sql, params), { dialect: 'mysql', projectKey: `isolation-${randomBytes(4).toString('hex')}` });
  });
  afterAll(async () => {
    await admin.query('DROP TABLE IF EXISTS zhin_isolation_rows').catch(() => undefined);
    if (plan) await admin.query(`DROP USER IF EXISTS '${plan.user}'@'${plan.host ?? '%'}'`).catch(() => undefined);
    await admin.stop();
  });

  describe.each([true, false])('text guard %s', (textGuard) => {
    let host: Host;
    beforeAll(async () => {
      host = createDatabaseHost({ dialect: 'mysql', ...main, console: { user: plan.user, password: plan.password } } as never, { textGuard });
      await host.start();
    });
    afterAll(async () => { await host?.stop(); });

    it('cannot reach gateway data, other databases, server files, triggers or routines', async () => {
      expect(host.console!.info().capabilities).toMatchObject({ sql: true, sqlIsolation: 'restricted-credential' });
      const attempts: Record<string, [() => Promise<unknown>, string]> = {
        'console_isolation_users': [() => host.console!.query!('SELECT password_hash FROM console_isolation_users'), '1146'],
        'mysql.user': [() => host.console!.query!('SELECT authentication_string FROM mysql.user'), '1142'],
        'TRIGGER': [() => host.console!.execute!('CREATE TRIGGER zhin_isolation_t BEFORE INSERT ON zhin_isolation_rows FOR EACH ROW SET NEW.body = NEW.body'), '1142'],
        'PROCEDURE': [() => host.console!.execute!('CREATE PROCEDURE zhin_isolation_p() SELECT 1'), '1044'],
      };
      for (const [name, [attempt, code]] of Object.entries(attempts)) {
        const result = await outcome(attempt());
        expect(result, name).not.toBe('ok');
        if (!textGuard) expect(result, name).toBe(code);
      }
      if (!textGuard) {
        // LOAD DATA LOCAL: the client refuses to send a file (no LOCAL_FILES); LOAD_FILE reads nothing.
        expect(await outcome(host.console!.execute!("LOAD DATA LOCAL INFILE '/etc/passwd' INTO TABLE zhin_isolation_rows"))).not.toBe('ok');
        expect((await host.console!.query!("SELECT LOAD_FILE('/etc/passwd') AS f")).rows).toEqual([{ f: null }]);
      }
    });
  });
});
