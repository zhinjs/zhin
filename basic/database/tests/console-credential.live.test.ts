import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MySQL } from '../src/dialects/mysql.js';
import { PG } from '../src/dialects/pg.js';
import {
  PG_DEFINER_FUNCTION_PROBLEM,
  probeConsoleCredential,
  provisionConsoleRole,
  refreshConsoleGrants,
  type ConsoleRolePlan,
} from '../src/console-credential.js';

/**
 * The restricted Console account against real servers (full-validation, ADR 0059 §4): it is
 * provisioned by an account that may create roles, passes the probe, and cannot reach anything
 * beyond rows of the project schema.
 */
const live = process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1';

const pgConfig = (user: string, password: string) => ({
  host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
  user,
  password,
  database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
});

describe.skipIf(!live)('Console role on PostgreSQL (live)', () => {
  const mainUser = process.env.ZHIN_TEST_PG_USER ?? 'zhin';
  const main = new PG(pgConfig(mainUser, process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin'));
  const run = (sql: string, params?: unknown[]) => main.query(sql, params as never[]);
  let plan: ConsoleRolePlan;
  let restricted: PG;
  const restrictedRun = (sql: string, params?: unknown[]) => restricted.query(sql, params as never[]);
  const code = async (sql: string) => {
    try {
      await restrictedRun(sql);
      return 'ok';
    } catch (error) {
      return String((error as { code?: unknown }).code ?? (error as Error).message);
    }
  };

  beforeAll(async () => {
    await main.start();
    await run('DROP TABLE IF EXISTS zhin_console_cred_rows, zhin_console_cred_later, console_users');
    await run('CREATE TABLE zhin_console_cred_rows (id serial PRIMARY KEY, body text)');
    await run("INSERT INTO zhin_console_cred_rows (body) VALUES ('a')");
    plan = await provisionConsoleRole(run, { dialect: 'pg', projectKey: `live-${randomBytes(4).toString('hex')}` });
    restricted = new PG(pgConfig(plan.user, plan.password));
    await restricted.start();
  });

  afterAll(async () => {
    await restricted?.stop().catch(() => undefined);
    await run('DROP TABLE IF EXISTS zhin_console_cred_rows, zhin_console_cred_later, console_users').catch(() => undefined);
    if (plan) {
      await run(`DROP OWNED BY "${plan.user}"`).catch(() => undefined);
      await run(`DROP ROLE IF EXISTS "${plan.user}"`).catch(() => undefined);
    }
    await main.stop();
  });

  it('passes the probe as the configured account', async () => {
    expect(await probeConsoleCredential(restrictedRun, { dialect: 'pg', expectedUser: plan.user, mainUser })).toMatchObject({ ok: true, problems: [] });
    // The main account fails it.
    expect((await probeConsoleCredential(run, { dialect: 'pg', expectedUser: plan.user, mainUser })).ok).toBe(false);
  });

  it('reads and writes rows, also of tables the main account creates later', async () => {
    expect(await restrictedRun('SELECT body FROM zhin_console_cred_rows')).toEqual([{ body: 'a' }]);
    await restrictedRun("INSERT INTO zhin_console_cred_rows (body) VALUES ('b')");
    await run('CREATE TABLE zhin_console_cred_later (id int)');
    await restrictedRun('INSERT INTO zhin_console_cred_later VALUES (1)');
    expect(await restrictedRun('SELECT count(*)::int AS n FROM zhin_console_cred_later')).toEqual([{ n: 1 }]);
  });

  it('cannot leave its grants: roles, DDL, server files, catalogs of secrets', async () => {
    expect(await code(`SET ROLE "${mainUser}"`)).toBe('42501');
    expect(await code(`SELECT set_config('role', '${mainUser}', false)`)).toBe('42501');
    expect(await code('CREATE TABLE zhin_console_cred_evil (a int)')).toBe('42501');
    expect(await code('CREATE FUNCTION public.zhin_console_cred_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$')).toBe('42501');
    expect(await code('ALTER TABLE zhin_console_cred_rows ADD COLUMN x int')).toBe('42501');
    expect(await code('DROP TABLE zhin_console_cred_rows')).toBe('42501');
    expect(await code('SELECT rolpassword FROM pg_authid')).toBe('42501');
    expect(await code("SELECT pg_read_binary_file('/etc/passwd')")).toBe('42501');
    expect(await code("COPY zhin_console_cred_rows TO PROGRAM 'id'")).toBe('42501');
    expect(await code("SELECT lo_import('/etc/passwd')")).toBe('42501');
    expect(await code('CREATE SCHEMA zhin_console_cred_schema')).toBe('42501');
  });

  it('loses access to a gateway table left in the project database after a grant refresh', async () => {
    // Default privileges grant on every new table of the main account, console_users included…
    await run('CREATE TABLE console_users (id text PRIMARY KEY, password_hash text)');
    await run("INSERT INTO console_users VALUES ('u1', 'scrypt$secret')");
    expect(await code('SELECT password_hash FROM console_users')).toBe('ok');
    // …and the refresh the instance runs at start revokes them.
    const refreshed = await refreshConsoleGrants(run, { role: plan.user });
    expect(refreshed.revoked).toContain('console_users');
    expect(await code('SELECT password_hash FROM console_users')).toBe('42501');
    expect(refreshed.granted).toContain('zhin_console_cred_rows');
  });

  it('refuses every CVE-2018-1058 precondition and changed role settings (review L1 / L5)', async () => {
    const probe = async () => probeConsoleCredential(restrictedRun, { dialect: 'pg', expectedUser: plan.user, mainUser });
    const role = `"${plan.user}"`;
    const cases: Array<[string, string, string, RegExp]> = [
      ['member of the main account', `GRANT "${mainUser}" TO ${role}`, `REVOKE "${mainUser}" FROM ${role}`, /member of other roles|privileges of the main account/],
      ['CREATE on public', `GRANT CREATE ON SCHEMA public TO ${role}`, `REVOKE CREATE ON SCHEMA public FROM ${role}`, /CREATE in schema public/],
      ['pg_read_server_files', `GRANT pg_read_server_files TO ${role}`, `REVOKE pg_read_server_files FROM ${role}`, /member of other roles/],
      ['a schema named like the main account', `CREATE SCHEMA zhin_cve_main AUTHORIZATION ${role}`, 'DROP SCHEMA zhin_cve_main CASCADE', /owns objects \(schemas: 1|CREATE in schema zhin_cve_main/],
      ['CREATE on another schema', `CREATE SCHEMA zhin_cve_s2; GRANT CREATE ON SCHEMA zhin_cve_s2 TO ${role}`, 'DROP SCHEMA zhin_cve_s2 CASCADE', /CREATE in schema zhin_cve_s2/],
      ['owns a table', `CREATE TABLE zhin_cve_owned (a int); ALTER TABLE zhin_cve_owned OWNER TO ${role}`, 'DROP TABLE zhin_cve_owned', /owns objects \(relations/],
      ['a changed search_path', `ALTER ROLE ${role} SET search_path = "$user", pg_temp, public`, `ALTER ROLE ${role} SET search_path = public`, /role settings/],
    ];
    expect((await probe()).ok).toBe(true);
    const ran: string[] = [];
    const [{ super: isSuper }] = await run('SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user') as Array<{ super: boolean }>;
    for (const [label, apply, undo, problem] of cases) {
      // A CREATEROLE (non-superuser) main account cannot grant predefined roles or itself (PG 16).
      if (!isSuper && (label === 'pg_read_server_files' || label === 'member of the main account')) continue;
      try {
        for (const statement of apply.split('; ')) await run(statement);
      } catch (error) {
        // PG 16: a CREATEROLE account may not give objects to a role it cannot SET ROLE to.
        if (isSuper || (error as { code?: string }).code !== '42501') throw error;
        for (const statement of undo.split('; ')) await run(statement).catch(() => undefined);
        continue;
      }
      ran.push(label);
      try {
        const result = await probe();
        expect(result.ok, label).toBe(false);
        expect(result.problems.join('\n'), label).toMatch(problem);
      } finally {
        for (const statement of undo.split('; ')) await run(statement).catch(() => undefined);
      }
    }
    expect(ran).toEqual(expect.arrayContaining(['CREATE on public', 'CREATE on another schema', 'a changed search_path']));
    if (isSuper) expect(ran).toHaveLength(cases.length);
    expect((await probe()).ok).toBe(true);
    // The account may change its own settings (PG allows it): the probe notices.
    await restrictedRun(`ALTER ROLE CURRENT_USER SET search_path = pg_temp, public`);
    expect((await probe()).problems.join('\n')).toMatch(/role settings/);
    await run(`ALTER ROLE ${role} SET search_path = public`);
    expect((await probe()).ok).toBe(true);
  });

  it('refuses SECURITY DEFINER functions of the main account the account may execute, until PUBLIC loses EXECUTE', async () => {
    const probe = () => probeConsoleCredential(restrictedRun, { dialect: 'pg', expectedUser: plan.user, mainUser });
    expect((await probe()).ok).toBe(true);
    await run('CREATE OR REPLACE FUNCTION public.zhin_cve_definer() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT current_user::text $$');
    try {
      // PUBLIC may execute it by default: it would run with the main account's rights.
      expect(await restrictedRun('SELECT public.zhin_cve_definer() AS who')).toEqual([{ who: mainUser }]);
      const refused = await probe();
      expect(refused.ok).toBe(false);
      expect(refused.problems).toContain(PG_DEFINER_FUNCTION_PROBLEM);
      expect(refused.details?.join(' ')).toContain('public.zhin_cve_definer');
      await run('REVOKE EXECUTE ON FUNCTION public.zhin_cve_definer() FROM PUBLIC');
      expect(await probe()).toMatchObject({ ok: true, problems: [] });
    } finally {
      await run('DROP FUNCTION IF EXISTS public.zhin_cve_definer()');
    }
  });

  it('refuses file / remote functions, column grants on gateway tables and owned large objects (third review)', async () => {
    const probe = () => probeConsoleCredential(restrictedRun, { dialect: 'pg', expectedUser: plan.user, mainUser });
    const role = `"${plan.user}"`;
    const [{ super: isSuper }] = await run('SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user') as Array<{ super: boolean }>;
    const cases: Array<[string, string, string, RegExp, boolean]> = [
      ['EXECUTE pg_read_file', `GRANT EXECUTE ON FUNCTION pg_read_file(text) TO ${role}`, `REVOKE EXECUTE ON FUNCTION pg_read_file(text) FROM ${role}`, /server file \/ remote functions: .*pg_read_file/, true],
      ['EXECUTE pg_ls_dir', `GRANT EXECUTE ON FUNCTION pg_ls_dir(text) TO ${role}`, `REVOKE EXECUTE ON FUNCTION pg_ls_dir(text) FROM ${role}`, /pg_ls_dir/, true],
      ['EXECUTE lo_export', `GRANT EXECUTE ON FUNCTION lo_export(oid, text) TO ${role}`, `REVOKE EXECUTE ON FUNCTION lo_export(oid, text) FROM ${role}`, /lo_export/, true],
      ['column grant on the marker', `CREATE TABLE IF NOT EXISTS zhin_gateway_store (id text, store_id text, migrated_at bigint); REVOKE ALL ON zhin_gateway_store FROM ${role}; GRANT UPDATE (store_id) ON zhin_gateway_store TO ${role}`, 'DROP TABLE zhin_gateway_store', /can reach gateway tables: zhin_gateway_store/, false],
      ['tables in another schema', `CREATE SCHEMA zhin_cve_s9; CREATE TABLE zhin_cve_s9.t (a int); GRANT USAGE ON SCHEMA zhin_cve_s9 TO ${role}; GRANT SELECT ON zhin_cve_s9.t TO ${role}`, 'DROP SCHEMA zhin_cve_s9 CASCADE', /outside schema public: zhin_cve_s9/, false],
      ['owns a large object', `SELECT lo_from_bytea(424242, 'x'); ALTER LARGE OBJECT 424242 OWNER TO ${role}`, 'SELECT lo_unlink(424242)', /owns large objects/, true],
    ];
    let ran = 0;
    for (const [label, apply, undo, problem, needsSuper] of cases) {
      if (needsSuper && !isSuper) continue;
      for (const statement of apply.split('; ')) await run(statement);
      try {
        const result = await probe();
        expect(result.ok, label).toBe(false);
        expect(result.problems.join('\n'), label).toMatch(problem);
      } finally {
        for (const statement of undo.split('; ')) await run(statement).catch(() => undefined);
      }
      ran += 1;
    }
    expect(ran).toBe(isSuper ? cases.length : 2);
    expect((await probe()).ok).toBe(true);
  });

  it('never sends the password: the role stores the client-computed SCRAM verifier', async () => {
    expect(plan.statements.join('\n')).not.toContain(plan.password);
    expect(plan.statements[0]).toMatch(/PASSWORD 'SCRAM-SHA-256\$4096:/);
  });

  it('refuses the probe while a gateway table is reachable (review L2)', async () => {
    await run('DROP TABLE IF EXISTS console_users');
    await run('CREATE TABLE console_users (id text PRIMARY KEY, password_hash text)');
    try {
      const probe = await probeConsoleCredential(restrictedRun, { dialect: 'pg', expectedUser: plan.user, mainUser });
      expect(probe.problems.join('\n')).toMatch(/can reach gateway tables: console_users/);
      await refreshConsoleGrants(run, { role: plan.user });
      expect((await probeConsoleCredential(restrictedRun, { dialect: 'pg', expectedUser: plan.user, mainUser })).ok).toBe(true);
    } finally {
      await run('DROP TABLE IF EXISTS console_users');
    }
  });

  it('rotates the password of an existing role', async () => {
    const rotated = await provisionConsoleRole(run, { dialect: 'pg', projectKey: 'unused', role: plan.user });
    expect(rotated.statements[0]).toMatch(/^ALTER ROLE/);
    const again = new PG(pgConfig(plan.user, rotated.password));
    await again.start();
    expect(await probeConsoleCredential((sql, params) => again.query(sql, params as never[]), { dialect: 'pg', expectedUser: plan.user, mainUser })).toMatchObject({ ok: true });
    await again.stop();
    plan = rotated;
  });
});

describe.skipIf(!live || !process.env.ZHIN_TEST_MYSQL_ROOT_PASSWORD)('Console account on MySQL (live)', () => {
  const host = process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1';
  const port = Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306);
  const database = process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test';
  // Docker's MYSQL_USER cannot create users; root provisions the account.
  const admin = new MySQL({ host, port, user: process.env.ZHIN_TEST_MYSQL_ROOT_USER ?? 'root', password: process.env.ZHIN_TEST_MYSQL_ROOT_PASSWORD, database });
  const run = (sql: string, params?: unknown[]) => admin.query(sql, params as never[]);
  let plan: ConsoleRolePlan;
  let restricted: MySQL;
  const restrictedRun = (sql: string, params?: unknown[]) => restricted.query(sql, params as never[]);
  const errno = async (sql: string) => {
    try {
      await restrictedRun(sql);
      return 'ok';
    } catch (error) {
      return String((error as { errno?: unknown }).errno ?? (error as Error).message);
    }
  };

  beforeAll(async () => {
    await admin.start();
    await run('DROP TABLE IF EXISTS zhin_console_cred_rows');
    await run('CREATE TABLE zhin_console_cred_rows (id int PRIMARY KEY, body text)');
    await run("INSERT INTO zhin_console_cred_rows VALUES (1, 'a')");
    plan = await provisionConsoleRole(run, { dialect: 'mysql', projectKey: `live-${randomBytes(4).toString('hex')}` });
    restricted = new MySQL({ host, port, user: plan.user, password: plan.password, database, flags: ['-LOCAL_FILES'], multipleStatements: false } as never);
    await restricted.start();
  });

  afterAll(async () => {
    await restricted?.stop().catch(() => undefined);
    await run('DROP TABLE IF EXISTS zhin_console_cred_rows, zhin_console_cred_ddl').catch(() => undefined);
    if (plan) await run(`DROP USER IF EXISTS '${plan.user}'@'${plan.host ?? '%'}'`).catch(() => undefined);
    await admin.stop();
  });

  it('passes the probe and works on rows and DDL of its database', async () => {
    expect(await probeConsoleCredential(restrictedRun, { dialect: 'mysql', expectedUser: plan.user, mainUser: 'root' })).toMatchObject({ ok: true, problems: [] });
    expect(await restrictedRun('SELECT body FROM zhin_console_cred_rows')).toEqual([{ body: 'a' }]);
    await restrictedRun('CREATE TABLE zhin_console_cred_ddl (a int)');
    await restrictedRun('DROP TABLE zhin_console_cred_ddl');
  });

  it('cannot reach other databases, server files, triggers or routines', async () => {
    expect(await errno('SELECT user FROM mysql.user')).toBe('1142');
    expect(await restrictedRun("SELECT LOAD_FILE('/etc/passwd') AS f")).toEqual([{ f: null }]);
    expect(await errno('CREATE TRIGGER zhin_console_cred_t BEFORE INSERT ON zhin_console_cred_rows FOR EACH ROW SET NEW.body = NEW.body')).toBe('1142');
    expect(await errno('CREATE PROCEDURE zhin_console_cred_p() SELECT 1')).toBe('1044');
    // LOAD DATA LOCAL: the client refuses to send a file (LOCAL_FILES off).
    expect(await errno("LOAD DATA LOCAL INFILE '/etc/passwd' INTO TABLE zhin_console_cred_rows")).not.toBe('ok');
  });
});
