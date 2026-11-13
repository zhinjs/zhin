import { describe, expect, it } from 'vitest';
import {
  consoleRoleName,
  consoleRoleStatements,
  generateConsolePassword,
  planConsoleRole,
  probeConsoleCredential,
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
    const [first] = consoleRoleStatements({ dialect: 'pg', role: 'r_x', password: 'p', database: 'd', mainUser: 'm', exists: true });
    expect(first).toBe("ALTER ROLE \"r_x\" WITH LOGIN NOCREATEROLE NOINHERIT CONNECTION LIMIT 4 PASSWORD 'p'");
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
    const run = runner([[/FROM pg_roles r/, pgFacts()], [/pg_has_role/, [{ usage: false }]]]);
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
      [/TABLE_PRIVILEGES/, [{ n: 0 }]],
      [/CURRENT_ROLE/, [{ role: 'NONE' }]],
    ]);
    expect(await probeConsoleCredential(good, { dialect: 'mysql', expectedUser: 'zhin_console_x', mainUser: 'zhin' })).toMatchObject({ ok: true });
    expect(good.calls.find(call => /USER_PRIVILEGES/.test(call.sql))?.params).toEqual(["'zhin_console_x'@'%'"]);
    const bad = runner([
      [/CURRENT_USER\(\)/, [{ account: 'zhin_console_x@%', db: 'bot' }]],
      [/USER_PRIVILEGES/, [{ privilege: 'FILE', grantable: 'NO' }]],
      [/SCHEMA_PRIVILEGES/, [{ db: 'other', privilege: 'SELECT', grantable: 'YES' }, { db: 'bot', privilege: 'TRIGGER', grantable: 'NO' }]],
      [/TABLE_PRIVILEGES/, [{ n: 3 }]],
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
    ]);
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
