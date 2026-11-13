import { describe, expect, it } from 'vitest';
import { MySQL } from '../src/dialects/mysql.js';
import {
  consoleConnectionOptions,
  consoleRoleName,
  mysqlRoleAndProxyGrants,
  mysqlVersionProblem,
  PG_DEFINER_FUNCTION_PROBLEM,
  PG_DEFINER_FUNCTIONS_QUERY,
  pgScramVerifier,
  scrubSecret,
  consoleRoleStatements,
  generateConsolePassword,
  planConsoleRole,
  probeConsoleCredential,
  provisionConsoleRole,
  refreshConsoleGrants,
  splitMysqlAccount,
  type ConsoleSqlRunner,
} from '../src/console-credential.js';

/** Answers by the first matching pattern and records every statement. */
function runner(answers: Array<[RegExp, unknown]>): ConsoleSqlRunner & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const run = (async (sql: string, params?: unknown[]) => {
    calls.push({ sql, ...(params ? { params } : {}) });
    for (const [pattern, answer] of answers) if (pattern.test(sql)) return typeof answer === 'function' ? (answer as (p?: unknown[]) => unknown)(params) : answer;
    return [];
  }) as ConsoleSqlRunner & { calls: typeof calls };
  run.calls = calls;
  return run;
}

describe('console role statements (ADR 0059 §4)', () => {
  it('names one role per project and generates base64url passwords', () => {
    expect(consoleRoleName('/srv/bot')).toMatch(/^zhin_console_[0-9a-f]{8}$/);
    expect(consoleRoleName('/srv/bot')).toBe(consoleRoleName('/srv/bot'));
    expect(consoleRoleName('/srv/other')).not.toBe(consoleRoleName('/srv/bot'));
    const password = generateConsolePassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('builds the PostgreSQL role: login only, no DDL, default privileges for the main account', () => {
    expect(consoleRoleStatements({
      dialect: 'pg', role: 'zhin_console_abcd1234', password: '<password>', database: 'bot', mainUser: 'zhin',
      tables: ['notes', 'console_users', 'console_conversations'],
    })).toMatchInlineSnapshot(`
      [
        "CREATE ROLE "zhin_console_abcd1234" WITH LOGIN NOSUPERUSER NOREPLICATION NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 4 PASSWORD '<password>'",
        "ALTER ROLE "zhin_console_abcd1234" RESET ALL",
        "ALTER ROLE "zhin_console_abcd1234" SET statement_timeout = '60s'",
        "ALTER ROLE "zhin_console_abcd1234" SET search_path = public",
        "GRANT CONNECT ON DATABASE "bot" TO "zhin_console_abcd1234"",
        "REVOKE CREATE ON SCHEMA public FROM "zhin_console_abcd1234"",
        "GRANT USAGE ON SCHEMA public TO "zhin_console_abcd1234"",
        "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."notes" TO "zhin_console_abcd1234"",
        "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."console_conversations" TO "zhin_console_abcd1234"",
        "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "zhin_console_abcd1234"",
        "ALTER DEFAULT PRIVILEGES FOR ROLE "zhin" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO "zhin_console_abcd1234"",
        "ALTER DEFAULT PRIVILEGES FOR ROLE "zhin" IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "zhin_console_abcd1234"",
      ]
    `);
  });

  it('rotates an existing PostgreSQL role without naming superuser attributes for a CREATEROLE account', () => {
    const [first] = consoleRoleStatements({ dialect: 'pg', role: 'r_x', password: 'x'.repeat(43), database: 'd', mainUser: 'm', exists: true });
    // The password itself never appears: a client-computed SCRAM-SHA-256 verifier does.
    expect(first).toMatch(/^ALTER ROLE "r_x" WITH LOGIN NOCREATEROLE NOINHERIT CONNECTION LIMIT 4 PASSWORD 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+'$/);
    expect(first).not.toContain('x'.repeat(43));
    const hardened = consoleRoleStatements({ dialect: 'pg', role: 'r_x', password: 'p', database: 'd', mainUser: 'm', revokePublicCreate: true });
    expect(hardened).toContain('GRANT CREATE ON SCHEMA public TO "m"');
    expect(hardened).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    expect(hardened.indexOf('GRANT CREATE ON SCHEMA public TO "m"')).toBeLessThan(hardened.indexOf('REVOKE CREATE ON SCHEMA public FROM PUBLIC'));
  });

  it('builds the MySQL account: database privileges only, escaped wildcards, connection cap', () => {
    expect(consoleRoleStatements({ dialect: 'mysql', role: 'zhin_console_abcd1234', password: '<password>', database: 'zhin_bot', mainUser: 'zhin', host: '10.0.%' }))
      .toMatchInlineSnapshot(`
        [
          "CREATE USER IF NOT EXISTS 'zhin_console_abcd1234'@'10.0.%' IDENTIFIED BY '<password>' WITH MAX_USER_CONNECTIONS 4",
          "ALTER USER 'zhin_console_abcd1234'@'10.0.%' IDENTIFIED BY '<password>' WITH MAX_USER_CONNECTIONS 4",
          "REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'zhin_console_abcd1234'@'10.0.%'",
          "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW, CREATE TEMPORARY TABLES ON \`zhin\\_bot\`.* TO 'zhin_console_abcd1234'@'10.0.%'",
        ]
      `);
    expect(() => consoleRoleStatements({ dialect: 'mysql', role: 'Bad Name', password: 'x', database: 'd', mainUser: 'm' })).toThrow(/Invalid console role name/);
    expect(splitMysqlAccount('a@b@%')).toEqual({ user: 'a@b', host: '%' });
  });

  it('plans from the main connection: existing tables, role presence, PUBLIC CREATE', async () => {
    const run = runner([
      [/current_database\(\)/, [{ main: 'owner', database: 'app', super: false, present: true, public_create: true }]],
      [/FROM pg_class/, [{ name: 'notes' }, { name: 'console_users' }]],
    ]);
    const plan = await planConsoleRole(run, { dialect: 'pg', projectKey: '/srv/bot', password: 'x'.repeat(43) });
    expect(plan).toMatchObject({ dialect: 'pg', user: consoleRoleName('/srv/bot'), mainUser: 'owner', database: 'app' });
    expect(plan.statements[0]).toMatch(/^ALTER ROLE .* WITH LOGIN NOCREATEROLE/);
    expect(plan.statements).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    expect(plan.statements.some(statement => statement.includes('console_users'))).toBe(false);
    const mysql = await planConsoleRole(runner([[/CURRENT_USER/, [{ main: 'zhin@localhost', db: 'bot' }]]]), { dialect: 'mysql', projectKey: 'p', password: 'y'.repeat(43) });
    expect(mysql).toMatchObject({ host: 'localhost', mainUser: 'zhin', database: 'bot' });
    await expect(planConsoleRole(runner([[/CURRENT_USER/, [{ main: 'zhin@%', db: null }]]]), { dialect: 'mysql', projectKey: 'p' })).rejects.toThrow(/no default database/);
  });
});

describe('probeConsoleCredential', () => {
  const pgFacts = (overrides: Record<string, unknown> = {}) => [{
    user: 'zhin_console_x', session: 'zhin_console_x', super: false, createrole: false, createdb: false, bypassrls: false,
    replication: false, schema_create: false, database_create: false, memberships: 0, ...overrides,
  }];

  it('accepts a PostgreSQL account that holds only its grants', async () => {
    const run = runner([[/FROM pg_roles r WHERE r.rolname = current_user$/, pgFacts()], [/pg_has_role/, [{ usage: false }]],
      [/unnest\(s.setconfig\)/, [{ setting: 'statement_timeout=60s' }, { setting: 'search_path=public' }]]]);
    expect(await probeConsoleCredential(run, { dialect: 'pg', expectedUser: 'zhin_console_x', mainUser: 'zhin' })).toEqual({ ok: true, problems: [], user: 'zhin_console_x' });
    expect(run.calls.find(call => /pg_has_role/.test(call.sql))?.params).toEqual(['zhin']);
  });

  it('refuses every extra PostgreSQL capability', async () => {
    const run = runner([[/FROM pg_roles r/, pgFacts({ user: 'zhin', session: 'zhin', super: true, createrole: true, createdb: true, bypassrls: true, replication: true, schema_create: true, database_create: true, memberships: 2 })], [/pg_has_role/, [{ usage: true }]]]);
    const probe = await probeConsoleCredential(run, { dialect: 'pg', expectedUser: 'zhin_console_x', mainUser: 'zhin' });
    expect(probe.ok).toBe(false);
    expect(probe.problems.join('\n')).toMatch(/logged in as 'zhin'/);
    for (const text of ['main account', 'superuser', 'CREATEROLE', 'CREATEDB', 'BYPASSRLS', 'REPLICATION', 'CREATE in schema public', 'CREATE schemas', 'member of other roles']) {
      expect(probe.problems.join('\n')).toContain(text);
    }
  });

  it('accepts a MySQL account limited to its database and refuses extra grants', async () => {
    const good = runner([
      [/CURRENT_USER\(\)/, [{ account: 'zhin_console_x@%', db: 'bot' }]],
      [/USER_PRIVILEGES/, [{ privilege: 'USAGE', grantable: 'NO' }]],
      [/SCHEMA_PRIVILEGES/, [{ db: 'bot', privilege: 'SELECT', grantable: 'NO' }, { db: 'bot', privilege: 'CREATE', grantable: 'NO' }]],
      [/COUNT\(\*\) AS n FROM information_schema.TABLE_PRIVILEGES/, [{ n: 0 }]],
      [/FROM information_schema.TABLE_PRIVILEGES/, [{ db: 'bot', privilege: 'SELECT', grantable: 'NO' }]],
      [/APPLICABLE_ROLES/, [{ n: 0 }]],
      [/SHOW GRANTS/, [{ 'Grants for zhin_console_x@%': "GRANT USAGE ON *.* TO `zhin_console_x`@`%`" }, { 'Grants for zhin_console_x@%': 'GRANT SELECT, CREATE ON `bot`.* TO `zhin_console_x`@`%`' }]],
      [/CURRENT_ROLE/, [{ role: 'NONE' }]],
    ]);
    expect(await probeConsoleCredential(good, { dialect: 'mysql', expectedUser: 'zhin_console_x', mainUser: 'zhin' })).toMatchObject({ ok: true });
    expect(good.calls.find(call => /USER_PRIVILEGES/.test(call.sql))?.params).toEqual(["'zhin_console_x'@'%'"]);
    const bad = runner([
      [/CURRENT_USER\(\)/, [{ account: 'zhin_console_x@%', db: 'bot' }]],
      [/USER_PRIVILEGES/, [{ privilege: 'FILE', grantable: 'NO' }]],
      [/SCHEMA_PRIVILEGES/, [{ db: 'other', privilege: 'SELECT', grantable: 'YES' }, { db: 'bot', privilege: 'TRIGGER', grantable: 'NO' }]],
      [/COUNT\(\*\) AS n FROM information_schema.TABLE_PRIVILEGES/, [{ n: 3 }]],
      [/FROM information_schema.TABLE_PRIVILEGES/, [{ db: 'bot', privilege: 'TRIGGER', grantable: 'NO' }]],
      [/FROM information_schema.COLUMN_PRIVILEGES/, [{ db: 'other', privilege: 'SELECT', grantable: 'NO' }]],
      [/APPLICABLE_ROLES/, () => { throw new Error("Unknown table 'APPLICABLE_ROLES'"); }],
      [/SHOW GRANTS/, [{ g: 'GRANT `admin`@`%` TO `zhin_console_x`@`%`' }, { g: "GRANT PROXY ON 'root'@'%' TO 'zhin_console_x'@'%'" }]],
      [/CURRENT_ROLE/, () => { throw new Error('FUNCTION CURRENT_ROLE does not exist'); }],
    ]);
    const probe = await probeConsoleCredential(bad, { dialect: 'mysql', expectedUser: 'zhin_console_x' });
    expect(probe.ok).toBe(false);
    expect(probe.problems).toEqual([
      'the console user holds global privileges: FILE',
      'the console user holds privileges on other databases: other',
      'the console user holds TRIGGER',
      'the console user holds GRANT OPTION',
      'the console user holds table privileges on other databases',
      'the console user holds table / column privileges outside its grant: TRIGGER on bot, SELECT on other',
      'the console user has granted roles: `admin`@`%`',
      "the console user holds PROXY grants: 'root'@'%'",
    ]);
  });
});

describe('PostgreSQL SECURITY DEFINER functions', () => {
  it('refuses executable definer functions of other roles, naming them in the log details only', async () => {
    const definers = Array.from({ length: 7 }, (_, index) => ({ schema: index < 2 ? 'public' : 'ext', name: `fn${index}` }));
    const run = runner([
      [/FROM pg_roles r WHERE r.rolname = current_user$/, [{ user: 'zhin_console_x', session: 'zhin_console_x', super: false, createrole: false, createdb: false, bypassrls: false, replication: false, schema_create: false, database_create: false, memberships: 0 }]],
      [/unnest\(s.setconfig\)/, [{ setting: 'statement_timeout=60s' }, { setting: 'search_path=public' }]],
      [/p\.prosecdef/, definers.slice(0, 6)],
    ]);
    const probe = await probeConsoleCredential(run, { dialect: 'pg', expectedUser: 'zhin_console_x' });
    expect(probe.ok).toBe(false);
    expect(probe.problems).toEqual([PG_DEFINER_FUNCTION_PROBLEM]);
    expect(probe.problems.join(' ')).not.toMatch(/fn\d/);
    expect(probe.problems.join(' ')).toMatch(/REVOKE EXECUTE ON FUNCTION .* FROM PUBLIC/);
    expect(probe.details).toEqual(['SECURITY DEFINER functions executable by the console user: public.fn0, public.fn1, ext.fn2, ext.fn3, ext.fn4, …']);
    const query = run.calls.find(call => /prosecdef/.test(call.sql))!.sql;
    expect(query).toBe(PG_DEFINER_FUNCTIONS_QUERY);
    expect(query).toMatch(/has_function_privilege\(current_user, p\.oid, 'EXECUTE'\)/);
    expect(query).toMatch(/p\.proowner <> \(SELECT oid FROM pg_roles WHERE rolname = current_user\)/);
    expect(query).toMatch(/NOT IN \('pg_catalog', 'information_schema'\)/);
    expect(query).toMatch(/LIMIT 6$/);
  });
});

describe('MySQL roles, PROXY, versions and secrets', () => {
  it('reads role and PROXY grants out of SHOW GRANTS', () => {
    expect(mysqlRoleAndProxyGrants([
      'GRANT USAGE ON *.* TO `u`@`%`',
      'GRANT SELECT ON `bot`.* TO `u`@`%`',
      'GRANT `r1`@`%`,`r2`@`localhost` TO `u`@`%`',
      "GRANT PROXY ON ''@'' TO 'u'@'%'",
    ])).toEqual({ roles: ['`r1`@`%`', '`r2`@`localhost`'], proxies: ["''@''"] });
  });

  it('revokes leftover roles and PROXY grants when provisioning', async () => {
    const run = runner([
      [/CURRENT_USER\(\) AS main/, [{ main: 'root@%', db: 'bot', version: '8.4.3' }]],
      [/SHOW GRANTS FOR/, [{ g: 'GRANT `dba`@`%` TO `zhin_console_x`@`%`' }, { g: "GRANT PROXY ON 'root'@'%' TO 'zhin_console_x'@'%'" }]],
    ]);
    await provisionConsoleRole(run, { dialect: 'mysql', projectKey: 'p', role: 'zhin_console_x', password: 'y'.repeat(43) });
    const statements = run.calls.map(call => call.sql);
    expect(statements).toContain("REVOKE `dba`@`%` FROM 'zhin_console_x'@'%'");
    expect(statements).toContain("REVOKE PROXY ON 'root'@'%' FROM 'zhin_console_x'@'%'");
  });

  it('refuses servers without CREATE USER IF NOT EXISTS', async () => {
    expect(mysqlVersionProblem('5.7.44-log')).toBeUndefined();
    expect(mysqlVersionProblem('10.11.6-MariaDB')).toBeUndefined();
    expect(mysqlVersionProblem('5.6.51')).toMatch(/too old/);
    expect(mysqlVersionProblem('10.0.38-MariaDB')).toMatch(/MariaDB 10\.1\.3/);
    await expect(planConsoleRole(runner([[/CURRENT_USER/, [{ main: 'u@%', db: 'bot', version: '5.6.51' }]]]), { dialect: 'mysql', projectKey: 'p' })).rejects.toThrow(/too old/);
  });

  it('never lets the password out through a driver error', async () => {
    const password = 'z'.repeat(43);
    const run = runner([
      [/CURRENT_USER\(\) AS main/, [{ main: 'u@%', db: 'bot', version: '8.4.3' }]],
      [/^CREATE USER/, (params?: unknown[]) => { throw Object.assign(new Error(`Operation CREATE USER failed: IDENTIFIED BY '${password}'`), { errno: 1396, sqlState: 'HY000' }); }],
    ]);
    const error = await provisionConsoleRole(run, { dialect: 'mysql', projectKey: 'p', password }).catch((caught: unknown) => caught as Error & { errno?: number });
    expect(error.message).not.toContain(password);
    expect(error.message).toContain('[redacted]');
    expect(error.errno).toBe(1396);
    expect(scrubSecret(`a ${encodeURIComponent('p@ss/word!')} b`, ['p@ss/word!'])).toBe('a [redacted] b');
  });

  it('computes PostgreSQL SCRAM verifiers like the server', () => {
    // Read from pg_authid after CREATE ROLE … PASSWORD 'pencil' on PostgreSQL 16 (password_encryption = scram-sha-256).
    const fromServer = 'SCRAM-SHA-256$4096:KZ53IZ6ptVyff5iQNaIyyw==$EJoR3j7lr3xTFpFAVSuP+vFghL2Tvsl/VPzMZigrGJo=:i55qDIkfyhl+zBJLCvx7ZGT3Hg+oJJztU6D5Xb+2W2s=';
    expect(pgScramVerifier('pencil', Buffer.from('KZ53IZ6ptVyff5iQNaIyyw==', 'base64'), 4096)).toBe(fromServer);
  });
});

describe('consoleConnectionOptions (restricted connection)', () => {
  const credential = { user: 'zhin_console_x', password: 'secret_console' };
  it('rewrites a PostgreSQL connection string: no main user or password, also not as query parameters', () => {
    const options = consoleConnectionOptions('pg', {
      connectionString: 'postgresql://zhin:main-secret@db.example:5433/bot?user=zhin&password=main-secret&sslmode=require&options=-c%20role%3Dzhin',
      user: '', password: 'main-secret', pool: { max: 10 }, ssl: { rejectUnauthorized: true }, console: credential,
    }, credential);
    const url = new URL(String(options.connectionString));
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.searchParams.get('user')).toBe('zhin_console_x');
    expect(url.searchParams.get('password')).toBe('secret_console');
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.has('options')).toBe(false);
    expect(String(options.connectionString)).not.toContain('main-secret');
    expect(options).toMatchObject({ user: 'zhin_console_x', password: 'secret_console', pool: { max: 2, min: 0 }, resetSession: true, ssl: { rejectUnauthorized: true } });
    expect(options).not.toHaveProperty('console');
  });

  it('rebuilds a MySQL uri without its query switches; LOCAL_FILES and multiple statements stay off', () => {
    const options = consoleConnectionOptions('mysql', {
      uri: 'mysql://root:main@db:3307/bot?multipleStatements=true&flags=LOCAL_FILES&charset=utf8mb4&user=root',
      multipleStatements: true, flags: ['LOCAL_FILES'], infileStreamFactory: () => undefined, password: 'main',
    }, credential);
    expect(options).toEqual({
      host: 'db', port: 3307, database: 'bot', charset: 'utf8mb4',
      user: 'zhin_console_x', password: 'secret_console', pool: { max: 2, min: 0 }, resetSession: true,
      flags: ['-LOCAL_FILES', '-MULTI_STATEMENTS'], multipleStatements: false,
    });
  });

  it('gives mysql2 a config without LOCAL_FILES or MULTI_STATEMENTS', async () => {
    const options = consoleConnectionOptions('mysql', { uri: 'mysql://root:main@127.0.0.1:1/bot?multipleStatements=true&flags=LOCAL_FILES' }, credential);
    const db = new MySQL(options as never);
    // createPool does not connect: the driver's own merged config is inspected.
    await (db as unknown as { dialect: { connect(): Promise<void> } }).dialect.connect();
    try {
      expect((db as unknown as { dialect: { connectionSafety(): unknown } }).dialect.connectionSafety()).toEqual({ localFiles: false, multipleStatements: false });
    } finally {
      await (db as unknown as { dialect: { disconnect(): Promise<void> } }).dialect.disconnect();
    }
    const unsafe = new MySQL({ host: '127.0.0.1', port: 1, user: 'x', database: 'bot', pool: { max: 1 }, uri: 'mysql://x@127.0.0.1:1/bot?multipleStatements=true' } as never);
    await (unsafe as unknown as { dialect: { connect(): Promise<void> } }).dialect.connect();
    try {
      expect((unsafe as unknown as { dialect: { connectionSafety(): unknown } }).dialect.connectionSafety()).toEqual({ localFiles: true, multipleStatements: true });
    } finally {
      await (unsafe as unknown as { dialect: { disconnect(): Promise<void> } }).dialect.disconnect();
    }
  });
});

describe('refreshConsoleGrants', () => {
  it('grants on instance tables it may grant for and revokes on gateway tables still present', async () => {
    const run = runner([[/FROM pg_class/, [
      { name: 'notes', grantable: true },
      { name: 'foreign_owned', grantable: false },
      { name: 'console_users', grantable: true },
      { name: 'console_conversations', grantable: true },
    ]]]);
    expect(await refreshConsoleGrants(run, { role: 'zhin_console_x' })).toEqual({ granted: ['notes', 'console_conversations'], revoked: ['console_users'] });
    const statements = run.calls.map(call => call.sql).filter(sql => !/FROM pg_class/.test(sql));
    expect(statements).toEqual([
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."notes" TO "zhin_console_x"',
      'REVOKE ALL ON TABLE public."console_users" FROM "zhin_console_x"',
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."console_conversations" TO "zhin_console_x"',
      'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "zhin_console_x"',
    ]);
  });
});
