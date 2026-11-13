/**
 * The restricted database account of the Console SQL editor (ADR 0059 §4). On PostgreSQL and
 * MySQL, raw SQL typed in the Console (`db:query` / `db:execute`) runs on its own connection
 * that logs in as this account — never as the main account the instance uses. The account can
 * read and change rows of the project schema and nothing else: no roles, no other databases,
 * no server files, and on PostgreSQL no DDL (CVE-2018-1058-style objects planted for the main
 * account). `SET [LOCAL] ROLE` is not a boundary (`RESET ROLE`, `set_config('role', …)`), so
 * this is a separate login.
 *
 * Statements are built here once and used by `zhin db console-role` (run as the main account,
 * or printed for a DBA with `--print-sql`), by the instance's startup probe and by the PostgreSQL
 * grant refresh.
 */
import { createHash, randomBytes } from 'node:crypto';
import { isGatewayOwnedTable } from './reserved-tables.js';

export type ConsoleCredentialDialect = 'pg' | 'mysql';

/** Runs one statement on a connection (parameters bound by the driver). */
export type ConsoleSqlRunner = (sql: string, params?: unknown[]) => Promise<unknown>;

/** Connections the restricted account may hold at once (the Console pool uses at most 2). */
export const CONSOLE_ROLE_CONNECTION_LIMIT = 4;
/** Role-level `statement_timeout` backstop (the Console sets a shorter one per transaction). */
export const CONSOLE_ROLE_STATEMENT_TIMEOUT = '60s';
/** Privileges of the PostgreSQL account on tables / sequences of `public`. */
export const PG_CONSOLE_TABLE_PRIVILEGES = 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE';
export const PG_CONSOLE_SEQUENCE_PRIVILEGES = 'USAGE, SELECT, UPDATE';
/** Privileges of the MySQL account on `<database>.*` (nothing global). */
export const MYSQL_CONSOLE_PRIVILEGES = Object.freeze([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'INDEX', 'REFERENCES',
  'CREATE VIEW', 'SHOW VIEW', 'CREATE TEMPORARY TABLES',
] as const);
/** Schema privileges the MySQL account must never hold. */
export const MYSQL_FORBIDDEN_PRIVILEGES: ReadonlySet<string> = new Set([
  'TRIGGER', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE', 'EVENT', 'LOCK TABLES', 'GRANT OPTION',
  'FILE', 'SUPER', 'PROCESS', 'RELOAD', 'SHUTDOWN', 'CREATE USER', 'REPLICATION SLAVE', 'REPLICATION CLIENT',
]);

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/u;

/** `zhin_console_<first 8 hex of SHA-256(projectKey)>`: one account per project. */
export function consoleRoleName(projectKey: string): string {
  return `zhin_console_${createHash('sha256').update(projectKey).digest('hex').slice(0, 8)}`;
}

/** 32 random bytes, base64url (no quotes or backslashes: safe inside a SQL literal). */
export function generateConsolePassword(): string {
  return randomBytes(32).toString('base64url');
}

function assertRoleName(role: string): void {
  if (!ROLE_NAME.test(role)) throw new TypeError(`Invalid console role name '${role}' (lowercase letters, digits and _; at most 63)`);
}

function assertPassword(password: string): void {
  if (!/^[A-Za-z0-9_-]{16,}$/u.test(password)) throw new TypeError('The console role password must be base64url (generateConsolePassword())');
}

export function quotePgIdentifier(name: string): string {
  return `"${String(name).replace(/"/gu, '""')}"`;
}

function pgLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function mysqlString(value: string): string {
  return `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "''")}'`;
}

function mysqlIdentifier(name: string): string {
  return `\`${name.replace(/`/gu, '``')}\``;
}

/** Database name in a GRANT: `_` and `%` are wildcards there, so they are escaped. */
function mysqlGrantDatabase(name: string): string {
  return mysqlIdentifier(name.replace(/[_%]/gu, character => `\\${character}`));
}

export interface ConsoleRoleStatementOptions {
  readonly dialect: ConsoleCredentialDialect;
  readonly role: string;
  /** The account's password; `--print-sql` passes a placeholder the DBA replaces. */
  readonly password: string;
  /** The project database. */
  readonly database: string;
  /** The main account (PostgreSQL: default privileges are declared for the tables it creates). */
  readonly mainUser: string;
  /** MySQL: host part of the new account (the host part of the main account's `CURRENT_USER()`). */
  readonly host?: string;
  /** PostgreSQL: the role exists already (ALTER instead of CREATE). */
  readonly exists?: boolean;
  /** PostgreSQL: the main account is a superuser (may set SUPERUSER / REPLICATION / BYPASSRLS attributes on ALTER). */
  readonly mainIsSuperuser?: boolean;
  /** PostgreSQL: the main account has CREATEDB (PG 16 lets only such an account name CREATEDB on ALTER). */
  readonly mainCanCreateDb?: boolean;
  /**
   * PostgreSQL: tables (and views) of `public` to grant on. Undefined grants `ON ALL TABLES IN
   * SCHEMA public`; gateway-owned names (`console_*`) are always left out.
   */
  readonly tables?: readonly string[];
  /** PostgreSQL ≤ 14: `PUBLIC` may create in `public`; revoke that (and grant CREATE to the main account first). */
  readonly revokePublicCreate?: boolean;
}

/** The statements that create (or rotate) the restricted account, in order. */
export function consoleRoleStatements(options: ConsoleRoleStatementOptions): string[] {
  assertRoleName(options.role);
  if (options.dialect === 'pg') return pgRoleStatements(options);
  return mysqlRoleStatements(options);
}

function pgRoleStatements(options: ConsoleRoleStatementOptions): string[] {
  const role = quotePgIdentifier(options.role);
  const main = quotePgIdentifier(options.mainUser);
  const password = pgLiteral(options.password);
  // On ALTER, a CREATEROLE (non-superuser) account cannot even name SUPERUSER / REPLICATION /
  // BYPASSRLS, nor CREATEDB unless it holds it (PG 16); their defaults are off, and the probe
  // checks every attribute either way.
  const privileged = !options.exists || options.mainIsSuperuser ? ' NOSUPERUSER NOREPLICATION NOBYPASSRLS' : '';
  const createdb = !options.exists || options.mainIsSuperuser || options.mainCanCreateDb ? ' NOCREATEDB' : '';
  const attributes = `LOGIN${privileged}${createdb} NOCREATEROLE NOINHERIT CONNECTION LIMIT ${CONSOLE_ROLE_CONNECTION_LIMIT} PASSWORD ${password}`;
  const statements = [
    options.exists ? `ALTER ROLE ${role} WITH ${attributes}` : `CREATE ROLE ${role} WITH ${attributes}`,
    `ALTER ROLE ${role} SET statement_timeout = ${pgLiteral(CONSOLE_ROLE_STATEMENT_TIMEOUT)}`,
    `ALTER ROLE ${role} SET search_path = public`,
    `GRANT CONNECT ON DATABASE ${quotePgIdentifier(options.database)} TO ${role}`,
  ];
  if (options.revokePublicCreate) {
    statements.push(`GRANT CREATE ON SCHEMA public TO ${main}`, 'REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  }
  statements.push(
    `REVOKE CREATE ON SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    ...pgTableGrants(options.role, options.tables),
    `GRANT ${PG_CONSOLE_SEQUENCE_PRIVILEGES} ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${main} IN SCHEMA public GRANT ${PG_CONSOLE_TABLE_PRIVILEGES} ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${main} IN SCHEMA public GRANT ${PG_CONSOLE_SEQUENCE_PRIVILEGES} ON SEQUENCES TO ${role}`,
  );
  return statements;
}

function pgTableGrants(roleName: string, tables: readonly string[] | undefined): string[] {
  const role = quotePgIdentifier(roleName);
  if (tables === undefined) return [`GRANT ${PG_CONSOLE_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA public TO ${role}`];
  return tables.filter(table => !isGatewayOwnedTable(table))
    .map(table => `GRANT ${PG_CONSOLE_TABLE_PRIVILEGES} ON TABLE public.${quotePgIdentifier(table)} TO ${role}`);
}

function mysqlRoleStatements(options: ConsoleRoleStatementOptions): string[] {
  const account = `${mysqlString(options.role)}@${mysqlString(options.host ?? '%')}`;
  const password = mysqlString(options.password);
  return [
    `CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ${password} WITH MAX_USER_CONNECTIONS ${CONSOLE_ROLE_CONNECTION_LIMIT}`,
    `ALTER USER ${account} IDENTIFIED BY ${password} WITH MAX_USER_CONNECTIONS ${CONSOLE_ROLE_CONNECTION_LIMIT}`,
    // Back to a known state: an account reused from an earlier setup keeps no extra grant.
    `REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${account}`,
    `GRANT ${MYSQL_CONSOLE_PRIVILEGES.join(', ')} ON ${mysqlGrantDatabase(options.database)}.* TO ${account}`,
  ];
}

function firstRow(result: unknown): Record<string, unknown> {
  return (Array.isArray(result) ? result[0] : undefined) as Record<string, unknown> ?? {};
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

/** `user@host` of MySQL `CURRENT_USER()` (the user part may itself contain `@`). */
export function splitMysqlAccount(account: string): { user: string; host: string } {
  const at = account.lastIndexOf('@');
  return at < 0 ? { user: account, host: '%' } : { user: account.slice(0, at), host: account.slice(at + 1) };
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

export interface ProvisionConsoleRoleOptions {
  readonly dialect: ConsoleCredentialDialect;
  /** Role name; default {@link consoleRoleName}(projectKey). */
  readonly role?: string;
  /** Stable project identity for the default role name (the CLI passes the project root). */
  readonly projectKey: string;
  /** Default {@link generateConsolePassword}. */
  readonly password?: string;
}

export interface ConsoleRolePlan {
  readonly dialect: ConsoleCredentialDialect;
  readonly user: string;
  readonly password: string;
  /** MySQL host part of the account. */
  readonly host?: string;
  readonly database: string;
  readonly mainUser: string;
  readonly statements: readonly string[];
}

/**
 * Reads what the statements need from the main account's connection (its name, the database,
 * existing tables, whether the role exists) and returns the plan without running it
 * (`--print-sql`).
 */
export async function planConsoleRole(run: ConsoleSqlRunner, options: ProvisionConsoleRoleOptions): Promise<ConsoleRolePlan> {
  const role = options.role ?? consoleRoleName(options.projectKey);
  assertRoleName(role);
  const password = options.password ?? generateConsolePassword();
  if (options.dialect === 'pg') {
    const facts = firstRow(await run(`SELECT current_user AS main, current_database() AS database,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
      (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS createdb,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS present,
      EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE') AS public_create`, [role]));
    const tables = rows(await run(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY c.relname`)).map(row => String(row.name));
    const mainUser = String(facts.main);
    const database = String(facts.database);
    return Object.freeze({
      dialect: 'pg', user: role, password, database, mainUser,
      statements: Object.freeze(consoleRoleStatements({
        dialect: 'pg', role, password, database, mainUser, tables,
        exists: truthy(facts.present), mainIsSuperuser: truthy(facts.super), mainCanCreateDb: truthy(facts.createdb), revokePublicCreate: truthy(facts.public_create),
      })),
    });
  }
  const facts = firstRow(await run('SELECT CURRENT_USER() AS main, DATABASE() AS db'));
  const database = facts.db == null ? '' : String(facts.db);
  if (!database) throw new Error('The MySQL connection has no default database (database.database)');
  const main = splitMysqlAccount(String(facts.main));
  return Object.freeze({
    dialect: 'mysql', user: role, password, host: main.host, database, mainUser: main.user,
    statements: Object.freeze(consoleRoleStatements({ dialect: 'mysql', role, password, database, mainUser: main.user, host: main.host })),
  });
}

/**
 * Creates (or rotates the password of) the restricted account with the main account's
 * connection. Needs CREATEROLE (PostgreSQL) or CREATE USER + GRANT OPTION (MySQL); without them
 * the first statement fails and the caller offers `--print-sql`.
 */
export async function provisionConsoleRole(run: ConsoleSqlRunner, options: ProvisionConsoleRoleOptions): Promise<ConsoleRolePlan> {
  const plan = await planConsoleRole(run, options);
  assertPassword(plan.password);
  for (const statement of plan.statements) await run(statement);
  if (plan.dialect === 'pg') await refreshConsoleGrants(run, { role: plan.user });
  return plan;
}

export interface ConsoleCredentialProbe {
  readonly ok: boolean;
  /** Why the account is not acceptable (empty when ok). */
  readonly problems: readonly string[];
  /** The account the connection logged in as. */
  readonly user?: string;
}

export interface ProbeConsoleCredentialOptions {
  readonly dialect: ConsoleCredentialDialect;
  /** `database.console.user`. */
  readonly expectedUser: string;
  /** The main account (`database.user`; PostgreSQL also the main connection's `current_user`). */
  readonly mainUser?: string;
}

/**
 * Checks, on the restricted connection itself, that it is the configured account and holds no
 * more than {@link consoleRoleStatements} grants. Raw Console SQL stays off unless `ok`.
 */
export async function probeConsoleCredential(run: ConsoleSqlRunner, options: ProbeConsoleCredentialOptions): Promise<ConsoleCredentialProbe> {
  return options.dialect === 'pg' ? probePg(run, options) : probeMysql(run, options);
}

async function probePg(run: ConsoleSqlRunner, options: ProbeConsoleCredentialOptions): Promise<ConsoleCredentialProbe> {
  const problems: string[] = [];
  const facts = firstRow(await run(`SELECT current_user AS "user", session_user AS "session", r.rolsuper AS super, r.rolcreaterole AS createrole,
      r.rolcreatedb AS createdb, r.rolbypassrls AS bypassrls, r.rolreplication AS replication,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid)::int AS memberships
    FROM pg_roles r WHERE r.rolname = current_user`));
  const user = String(facts.user ?? '');
  if (user !== options.expectedUser || String(facts.session ?? '') !== options.expectedUser) {
    problems.push(`the connection logged in as '${user}', not the configured console user '${options.expectedUser}'`);
  }
  if (options.mainUser && user === options.mainUser) problems.push('the console user is the main account');
  if (truthy(facts.super)) problems.push('the console user is a superuser');
  if (truthy(facts.createrole)) problems.push('the console user has CREATEROLE');
  if (truthy(facts.createdb)) problems.push('the console user has CREATEDB');
  if (truthy(facts.bypassrls)) problems.push('the console user has BYPASSRLS');
  if (truthy(facts.replication)) problems.push('the console user has REPLICATION');
  if (truthy(facts.schema_create)) {
    problems.push('the console user may CREATE in schema public (PostgreSQL ≤ 14 grants it to PUBLIC: REVOKE CREATE ON SCHEMA public FROM PUBLIC)');
  }
  if (truthy(facts.database_create)) problems.push('the console user may CREATE schemas in the database');
  if (Number(facts.memberships ?? 0) > 0) problems.push('the console user is a member of other roles');
  if (options.mainUser && options.mainUser !== user) {
    const member = firstRow(await run(`SELECT pg_has_role(current_user, oid, 'USAGE') AS usage FROM pg_roles WHERE rolname = $1`, [options.mainUser]));
    if (truthy(member.usage)) problems.push(`the console user can use the privileges of the main account '${options.mainUser}'`);
  }
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems), user });
}

async function probeMysql(run: ConsoleSqlRunner, options: ProbeConsoleCredentialOptions): Promise<ConsoleCredentialProbe> {
  const problems: string[] = [];
  const facts = firstRow(await run('SELECT CURRENT_USER() AS account, DATABASE() AS db'));
  const account = splitMysqlAccount(String(facts.account ?? ''));
  const database = facts.db == null ? '' : String(facts.db);
  if (account.user !== options.expectedUser) {
    problems.push(`the connection logged in as '${account.user}', not the configured console user '${options.expectedUser}'`);
  }
  if (options.mainUser && account.user === options.mainUser) problems.push('the console user is the main account');
  const grantee = `${mysqlString(account.user)}@${mysqlString(account.host)}`;
  const global = rows(await run('SELECT PRIVILEGE_TYPE AS privilege, IS_GRANTABLE AS grantable FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?', [grantee]));
  const extraGlobal = global.map(row => String(row.privilege).toUpperCase()).filter(privilege => privilege !== 'USAGE');
  if (extraGlobal.length) problems.push(`the console user holds global privileges: ${extraGlobal.join(', ')}`);
  const schema = rows(await run('SELECT TABLE_SCHEMA AS db, PRIVILEGE_TYPE AS privilege, IS_GRANTABLE AS grantable FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?', [grantee]));
  const unescape = (name: string) => name.replace(/\\([_%])/gu, '$1');
  const elsewhere = [...new Set(schema.map(row => unescape(String(row.db))).filter(name => name !== database))];
  if (elsewhere.length) problems.push(`the console user holds privileges on other databases: ${elsewhere.join(', ')}`);
  const forbidden = [...new Set(schema.map(row => String(row.privilege).toUpperCase()).filter(privilege => MYSQL_FORBIDDEN_PRIVILEGES.has(privilege)))];
  if (forbidden.length) problems.push(`the console user holds ${forbidden.join(', ')}`);
  if ([...global, ...schema].some(row => String(row.grantable).toUpperCase() === 'YES')) problems.push('the console user holds GRANT OPTION');
  const tables = firstRow(await run('SELECT COUNT(*) AS n FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA <> DATABASE()', [grantee]));
  if (Number(tables.n ?? 0) > 0) problems.push('the console user holds table privileges on other databases');
  try {
    const role = firstRow(await run('SELECT CURRENT_ROLE() AS role'));
    const active = String(role.role ?? 'NONE');
    if (active !== 'NONE' && active !== '') problems.push(`the console user has active roles: ${active}`);
  } catch {
    // MySQL 5.7 / MariaDB: no CURRENT_ROLE(); roles are not in use there.
  }
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems), user: account.user });
}

export interface RefreshConsoleGrantsOptions {
  readonly role: string;
}

/**
 * PostgreSQL, main account: grants the account the table / sequence privileges on what exists in
 * `public` now (tables created before the default privileges, or by another role the main
 * account can grant for), and revokes everything on gateway-owned (`console_*`) tables that are
 * still in the project database. Idempotent; run at instance start.
 */
export async function refreshConsoleGrants(run: ConsoleSqlRunner, options: RefreshConsoleGrantsOptions): Promise<{ readonly granted: readonly string[]; readonly revoked: readonly string[] }> {
  assertRoleName(options.role);
  const role = quotePgIdentifier(options.role);
  const present = rows(await run(`SELECT c.relname AS name, pg_get_userbyid(c.relowner) = current_user OR has_table_privilege(c.oid, 'SELECT WITH GRANT OPTION') AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY c.relname`));
  const granted: string[] = [];
  const revoked: string[] = [];
  for (const row of present) {
    const name = String(row.name);
    const table = `public.${quotePgIdentifier(name)}`;
    if (isGatewayOwnedTable(name)) {
      if (truthy(row.grantable)) {
        await run(`REVOKE ALL ON TABLE ${table} FROM ${role}`);
        revoked.push(name);
      }
      continue;
    }
    if (!truthy(row.grantable)) continue;
    await run(`GRANT ${PG_CONSOLE_TABLE_PRIVILEGES} ON TABLE ${table} TO ${role}`);
    granted.push(name);
  }
  await run(`GRANT ${PG_CONSOLE_SEQUENCE_PRIVILEGES} ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  return Object.freeze({ granted: Object.freeze(granted), revoked: Object.freeze(revoked) });
}
