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
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
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

/**
 * Role-level settings of the PostgreSQL account (`pg_db_role_setting`), exactly: the probe refuses
 * an account whose settings differ — the account itself may `ALTER ROLE current_user SET …`
 * (e.g. `search_path = pg_temp, public`), which would change how the main account's objects resolve
 * in its sessions.
 */
export const PG_CONSOLE_ROLE_SETTINGS: readonly string[] = Object.freeze([
  `search_path=public`,
  `statement_timeout=${CONSOLE_ROLE_STATEMENT_TIMEOUT}`,
]);

/** SCRAM-SHA-256 iteration count of the verifier sent instead of the password (PostgreSQL default). */
export const PG_SCRAM_ITERATIONS = 4096;

/**
 * A PostgreSQL SCRAM-SHA-256 verifier (`SCRAM-SHA-256$<iter>:<salt>$<StoredKey>:<ServerKey>`, RFC
 * 7677 / `pg_authid.rolpassword` format) computed on the client, so `CREATE` / `ALTER ROLE` never
 * carries the password itself — not to the server log, not into `--print-sql` output. The password
 * is base64url ASCII, so SASLprep leaves it unchanged.
 */
export function pgScramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = PG_SCRAM_ITERATIONS): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** Replaces every spelling of `secret` (raw, quoted, URL-encoded) in `text` with `[redacted]`. */
export function scrubSecret(text: string, secrets: readonly (string | undefined)[]): string {
  let out = String(text);
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    for (const form of new Set([secret, encodeURIComponent(secret), secret.replace(/'/gu, "''"), secret.replace(/\\/gu, '\\\\')])) {
      out = out.split(form).join('[redacted]');
    }
  }
  return out;
}

/** An error with `secrets` scrubbed from its message (driver codes kept; the original is dropped). */
export function scrubbedError(error: unknown, secrets: readonly (string | undefined)[]): Error {
  const source = error as { message?: unknown; code?: unknown; errno?: unknown; sqlState?: unknown; name?: unknown };
  const scrubbed = new Error(scrubSecret(String(source?.message ?? error), secrets));
  for (const key of ['code', 'errno', 'sqlState'] as const) {
    if (source && (typeof source[key] === 'string' || typeof source[key] === 'number')) Object.defineProperty(scrubbed, key, { value: source[key], enumerable: true });
  }
  return scrubbed;
}

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
  // A literal SCRAM verifier: the server stores it as is, the password never travels.
  const password = pgLiteral(options.password.startsWith('SCRAM-SHA-256$') || options.password.startsWith('<') ? options.password : pgScramVerifier(options.password));
  // On ALTER, a CREATEROLE (non-superuser) account cannot even name SUPERUSER / REPLICATION /
  // BYPASSRLS, nor CREATEDB unless it holds it (PG 16); their defaults are off, and the probe
  // checks every attribute either way.
  const privileged = !options.exists || options.mainIsSuperuser ? ' NOSUPERUSER NOREPLICATION NOBYPASSRLS' : '';
  const createdb = !options.exists || options.mainIsSuperuser || options.mainCanCreateDb ? ' NOCREATEDB' : '';
  const attributes = `LOGIN${privileged}${createdb} NOCREATEROLE NOINHERIT CONNECTION LIMIT ${CONSOLE_ROLE_CONNECTION_LIMIT} PASSWORD ${password}`;
  const statements = [
    options.exists ? `ALTER ROLE ${role} WITH ${attributes}` : `CREATE ROLE ${role} WITH ${attributes}`,
    // Exactly the expected settings (PG_CONSOLE_ROLE_SETTINGS), whatever an earlier run left.
    `ALTER ROLE ${role} RESET ALL`,
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
    // MySQL ≥ 5.7.6 / MariaDB ≥ 10.1.3 (planConsoleRole refuses older servers).
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
  const facts = firstRow(await run('SELECT CURRENT_USER() AS main, DATABASE() AS db, VERSION() AS version'));
  const database = facts.db == null ? '' : String(facts.db);
  if (!database) throw new Error('The MySQL connection has no default database (database.database)');
  const unsupported = mysqlVersionProblem(String(facts.version ?? ''));
  if (unsupported) throw new Error(unsupported);
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
  try {
    for (const statement of plan.statements) await run(statement);
    if (plan.dialect === 'pg') await refreshConsoleGrants(run, { role: plan.user });
    else await revokeMysqlRolesAndProxies(run, plan.user, plan.host ?? '%');
  } catch (error) {
    // A driver error may quote the statement (mysql2 keeps `sql`): the password never leaves here.
    throw scrubbedError(error, [plan.password]);
  }
  return plan;
}

/**
 * Version check of `CREATE USER IF NOT EXISTS` / `ALTER USER … IDENTIFIED BY` (MySQL 5.7.6,
 * MariaDB 10.1.3); `undefined` when supported.
 */
export function mysqlVersionProblem(version: string): string | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) return undefined;
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  const at = (a: number, b: number, c: number) => major > a || (major === a && (minor > b || (minor === b && patch >= c)));
  const mariadb = /mariadb/iu.test(version);
  const ok = mariadb ? at(10, 1, 3) : at(5, 7, 6);
  return ok ? undefined : `${mariadb ? 'MariaDB' : 'MySQL'} ${version} is too old for the restricted Console account (needs ${mariadb ? 'MariaDB 10.1.3' : 'MySQL 5.7.6'}+ for CREATE USER IF NOT EXISTS / ALTER USER)`;
}

interface GrantToken { readonly kind: 'word' | 'quoted' | 'at' | 'comma'; readonly text: string; readonly start: number; readonly end: number }

/** Splits a `SHOW GRANTS` line into words, quoted names, `@` and `,` in one linear pass (no regex backtracking). */
function grantTokens(line: string): GrantToken[] | undefined {
  const tokens: GrantToken[] = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index]!;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { index += 1; continue; }
    if (char === '`' || char === "'" || char === '"') {
      let end = index + 1;
      while (end < line.length && line[end] !== char) end += 1;
      if (end >= line.length) return undefined; // unterminated quote: not a line we understand
      tokens.push({ kind: 'quoted', text: line.slice(index, end + 1), start: index, end: end + 1 });
      index = end + 1;
      continue;
    }
    if (char === '@' || char === ',') {
      tokens.push({ kind: char === '@' ? 'at' : 'comma', text: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    let end = index;
    while (end < line.length && !' \t\n\r`\'"@,'.includes(line[end]!)) end += 1;
    tokens.push({ kind: 'word', text: line.slice(index, end), start: index, end });
    index = end;
  }
  return tokens;
}

const isWord = (token: GrantToken | undefined, word: string) => token?.kind === 'word' && token.text.toUpperCase() === word;

/** Role grants and PROXY grants in `SHOW GRANTS` output (`GRANT \`r\`@\`%\` TO …`, `GRANT PROXY ON …`). */
export function mysqlRoleAndProxyGrants(lines: readonly string[]): { readonly roles: readonly string[]; readonly proxies: readonly string[] } {
  const roles: string[] = [];
  const proxies: string[] = [];
  for (const line of lines) {
    const tokens = grantTokens(line);
    if (!tokens || !isWord(tokens[0], 'GRANT')) continue;
    const to = tokens.findIndex((token, index) => index > 0 && isWord(token, 'TO'));
    if (to < 0) continue;
    if (isWord(tokens[1], 'PROXY') && isWord(tokens[2], 'ON')) {
      if (to > 3) proxies.push(line.slice(tokens[3]!.start, tokens[to - 1]!.end));
      continue;
    }
    // A role grant has no ON clause and lists only quoted names: GRANT `r1`@`%`,`r2`@`%` TO `u`@`h`
    // (MariaDB: GRANT `r1` TO …, no host).
    const names = tokens.slice(1, to);
    if (names.length === 0 || names.some(token => token.kind === 'word')) continue;
    let entryStart: number | undefined;
    let entryEnd = 0;
    const flush = () => { if (entryStart !== undefined) roles.push(line.slice(entryStart, entryEnd)); entryStart = undefined; };
    for (const token of names) {
      if (token.kind === 'comma') { flush(); continue; }
      if (entryStart === undefined) entryStart = token.start;
      entryEnd = token.end;
    }
    flush();
  }
  return Object.freeze({ roles: Object.freeze(roles), proxies: Object.freeze(proxies) });
}

function grantLines(result: unknown): string[] {
  return rows(result).map(row => String(Object.values(row)[0] ?? ''));
}

/** MySQL: revokes roles and PROXY grants the account may still hold (REVOKE ALL PRIVILEGES does not). */
async function revokeMysqlRolesAndProxies(run: ConsoleSqlRunner, user: string, host: string): Promise<void> {
  const account = `${mysqlString(user)}@${mysqlString(host)}`;
  let lines: string[];
  try {
    lines = grantLines(await run(`SHOW GRANTS FOR ${account}`));
  } catch {
    return; // The probe still refuses an account with roles or PROXY grants.
  }
  const { roles, proxies } = mysqlRoleAndProxyGrants(lines);
  for (const role of roles) await run(`REVOKE ${role} FROM ${account}`);
  for (const proxy of proxies) await run(`REVOKE PROXY ON ${proxy} FROM ${account}`);
}

export interface ConsoleCredentialProbe {
  readonly ok: boolean;
  /** Why the account is not acceptable (empty when ok). */
  readonly problems: readonly string[];
  /** The account the connection logged in as. */
  readonly user?: string;
  /**
   * For the log only (never shown to Console users): object names behind a problem, e.g. the
   * SECURITY DEFINER functions the account may execute.
   */
  readonly details?: readonly string[];
}

/** How many SECURITY DEFINER functions a probe names in its log details. */
export const PG_DEFINER_FUNCTIONS_LOGGED = 5;

/**
 * The account may EXECUTE a SECURITY DEFINER function owned by another role outside `pg_catalog` /
 * `information_schema` (extension functions in other schemas included): it would run with that
 * owner's rights. PUBLIC has EXECUTE on functions by default, so provisioning cannot fix this
 * without changing everyone's access — the owner revokes it (or grants it explicitly) instead.
 */
export const PG_DEFINER_FUNCTION_PROBLEM = 'the console user can execute SECURITY DEFINER functions owned by other roles (they run with the owner\'s rights): '
  + 'REVOKE EXECUTE ON FUNCTION <schema>.<function>(…) FROM PUBLIC, or grant EXECUTE only to the roles that need it; the instance log names the functions';

/**
 * Functions that read or write server files or reach other servers (`pg_ls_*`, `pg_read_file`,
 * `pg_read_binary_file`, `pg_stat_file`, server-side `lo_import` / `lo_export`, adminpack
 * `pg_file_*`, `dblink*`): none of them may be executable by the console account (they are
 * revoked from PUBLIC by default; an explicit grant or an extension that grants them is refused).
 */
export const PG_FILE_FUNCTIONS_QUERY = `SELECT DISTINCT p.proname AS name FROM pg_proc p
    WHERE (p.proname LIKE 'pg\\_ls\\_%' OR p.proname IN ('pg_read_file', 'pg_read_binary_file', 'pg_stat_file', 'lo_import', 'lo_export')
      OR p.proname LIKE 'pg\\_file\\_%' OR p.proname LIKE 'dblink%')
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')
    ORDER BY 1`;

/** The query behind {@link PG_DEFINER_FUNCTION_PROBLEM} (at most PG_DEFINER_FUNCTIONS_LOGGED + 1 rows). */
export const PG_DEFINER_FUNCTIONS_QUERY = `SELECT n.nspname AS schema, p.proname AS name FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_temp\\_%' AND n.nspname NOT LIKE 'pg\\_toast\\_temp\\_%'
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')
    ORDER BY 1, 2 LIMIT ${PG_DEFINER_FUNCTIONS_LOGGED + 1}`;

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
  // CVE-2018-1058 preconditions: objects the main account could resolve to in a schema the console
  // user may create in, or owns already (a schema named after the main account comes first in
  // its default search_path "$user", public).
  const temp = `n.nspname NOT LIKE 'pg\\_temp\\_%' AND n.nspname NOT LIKE 'pg\\_toast\\_temp\\_%'`;
  const creatable = rows(await run(`SELECT n.nspname AS name FROM pg_namespace n WHERE has_schema_privilege(current_user, n.oid, 'CREATE') AND ${temp} ORDER BY 1`)).map(row => String(row.name));
  if (creatable.length) problems.push(`the console user may CREATE in schema ${creatable.join(', ')}`);
  const owned = firstRow(await run(`SELECT
      (SELECT count(*) FROM pg_namespace n WHERE n.nspowner = r.oid AND ${temp})::int AS schemas,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relowner = r.oid AND ${temp})::int AS relations,
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proowner = r.oid AND ${temp})::int AS functions,
      (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typowner = r.oid AND ${temp})::int AS types,
      (SELECT count(*) FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE o.oprowner = r.oid AND ${temp})::int AS operators
    FROM pg_roles r WHERE r.rolname = current_user`));
  const ownedKinds = ['schemas', 'relations', 'functions', 'types', 'operators'].filter(kind => Number(owned[kind] ?? 0) > 0);
  if (ownedKinds.length) problems.push(`the console user owns objects (${ownedKinds.map(kind => `${kind}: ${owned[kind]}`).join(', ')})`);
  const settings = rows(await run(`SELECT unnest(s.setconfig) AS setting FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
    WHERE r.rolname = current_user AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))`)).map(row => String(row.setting));
  const expected = [...PG_CONSOLE_ROLE_SETTINGS].sort();
  if (JSON.stringify([...settings].sort()) !== JSON.stringify(expected)) {
    problems.push(`the console user's role settings are ${JSON.stringify(settings)}, expected ${JSON.stringify(expected)}`);
  }
  // Column-level grants count too (GRANT UPDATE (store_id) ON zhin_gateway_store …).
  const gatewayTables = rows(await run(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND (has_table_privilege(current_user, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      OR has_any_column_privilege(current_user, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))`))
    .map(row => String(row.name)).filter(name => isGatewayOwnedTable(name));
  if (gatewayTables.length) problems.push(`the console user can reach gateway tables: ${gatewayTables.join(', ')}`);
  // Grants beyond the project schema (another schema's tables / views it can use).
  const elsewhere = rows(await run(`SELECT DISTINCT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema') AND ${temp} AND n.nspname <> 'pg_toast'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND has_schema_privilege(current_user, n.oid, 'USAGE')
      AND (has_table_privilege(current_user, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege(current_user, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
    ORDER BY 1 LIMIT 5`)).map(row => String(row.schema));
  if (elsewhere.length) problems.push(`the console user can use tables outside schema public: ${elsewhere.join(', ')}`);
  const fileFunctions = rows(await run(PG_FILE_FUNCTIONS_QUERY)).map(row => String(row.name));
  if (fileFunctions.length) problems.push(`the console user may execute server file / remote functions: ${[...new Set(fileFunctions)].join(', ')}`);
  const largeObjects = firstRow(await run(`SELECT count(*)::int AS n FROM pg_largeobject_metadata WHERE lomowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`));
  if (Number(largeObjects.n ?? 0) > 0) problems.push(`the console user owns large objects (${largeObjects.n})`);
  const definers = rows(await run(PG_DEFINER_FUNCTIONS_QUERY)).map(row => `${String(row.schema)}.${String(row.name)}`);
  const details: string[] = [];
  if (definers.length) {
    problems.push(PG_DEFINER_FUNCTION_PROBLEM);
    const named = definers.slice(0, PG_DEFINER_FUNCTIONS_LOGGED);
    details.push(`SECURITY DEFINER functions executable by the console user: ${named.join(', ')}${definers.length > named.length ? ', …' : ''}`);
  }
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems), user, ...(details.length ? { details: Object.freeze(details) } : {}) });
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
  const allowed = new Set<string>(MYSQL_CONSOLE_PRIVILEGES);
  const fine = [
    ...rows(await run('SELECT TABLE_SCHEMA AS db, PRIVILEGE_TYPE AS privilege, IS_GRANTABLE AS grantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ?', [grantee])),
    ...rows(await run('SELECT TABLE_SCHEMA AS db, PRIVILEGE_TYPE AS privilege, IS_GRANTABLE AS grantable FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE = ?', [grantee])),
  ];
  const outside = [...new Set(fine.filter(row => unescape(String(row.db)) !== database || !allowed.has(String(row.privilege).toUpperCase()) || String(row.grantable).toUpperCase() === 'YES')
    .map(row => `${String(row.privilege).toUpperCase()} on ${unescape(String(row.db))}`))];
  if (outside.length) problems.push(`the console user holds table / column privileges outside its grant: ${outside.join(', ')}`);
  try {
    const applicable = firstRow(await run('SELECT COUNT(*) AS n FROM information_schema.APPLICABLE_ROLES'));
    if (Number(applicable.n ?? 0) > 0) problems.push('the console user has granted roles (information_schema.APPLICABLE_ROLES)');
  } catch {
    // Before MySQL 8.0.19 / MariaDB: SHOW GRANTS below lists role grants.
  }
  try {
    const { roles, proxies } = mysqlRoleAndProxyGrants(grantLines(await run('SHOW GRANTS')));
    if (roles.length) problems.push(`the console user has granted roles: ${roles.join(', ')}`);
    if (proxies.length) problems.push(`the console user holds PROXY grants: ${proxies.join(', ')}`);
  } catch (error) {
    problems.push(`SHOW GRANTS failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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

export interface ConsoleCredential {
  readonly user: string;
  readonly password: string;
}

/** Query parameters of a MySQL `uri` the restricted connection keeps (no credentials, flags or statements switches). */
const MYSQL_URI_KEPT_PARAMS: ReadonlySet<string> = new Set(['charset', 'timezone', 'connectTimeout', 'ssl', 'supportBigNumbers', 'bigNumberStrings', 'dateStrings', 'decimalNumbers']);

/**
 * Connection options of the restricted Console account, built from the main connection's options
 * (ADR 0059 §4): the main account's credentials never reach it — neither as fields nor inside a
 * PostgreSQL `connectionString` (whose `user` / `password`, also as query parameters, would win over
 * explicit fields, empty ones included) nor a MySQL `uri` (whose query parameters fill every falsy
 * field: `?multipleStatements=true` would beat `false`, `?flags=LOCAL_FILES` would re-enable LOCAL
 * INFILE). Pool of at most two connections, session reset on release; MySQL without
 * `LOCAL_FILES` and multiple statements.
 */
export function consoleConnectionOptions(dialect: ConsoleCredentialDialect, main: Readonly<Record<string, unknown>>, credential: ConsoleCredential): Record<string, unknown> {
  const {
    user: _user, password: _password, password1: _password1, password2: _password2, password3: _password3, passwordSha1: _passwordSha1,
    connectionString, uri, pool: _pool, options: _options,
    flags: _flags, multipleStatements: _multiple, infileStreamFactory: _infile, localInfile: _localInfile,
    resetSession: _reset, console: _console, ...rest
  } = main;
  const base: Record<string, unknown> = { ...rest };
  if (dialect === 'pg' && typeof connectionString === 'string') {
    let url: URL;
    try {
      url = new URL(connectionString);
    } catch {
      throw new TypeError('database.connectionString is not a URL; the restricted Console account cannot reuse it');
    }
    url.username = '';
    url.password = '';
    for (const key of ['user', 'password', 'options']) url.searchParams.delete(key);
    // pg-connection-string reads these query parameters before the URL's user info.
    url.searchParams.set('user', credential.user);
    url.searchParams.set('password', credential.password);
    base.connectionString = url.toString();
  }
  if (dialect === 'mysql' && typeof uri === 'string') {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new TypeError('database.uri is not a URL; the restricted Console account cannot reuse it');
    }
    const fromUri: Record<string, unknown> = {};
    if (url.hostname) fromUri.host = decodeURIComponent(url.hostname);
    if (url.port) fromUri.port = Number(url.port);
    if (url.pathname.length > 1) fromUri.database = decodeURIComponent(url.pathname.slice(1));
    for (const [key, value] of url.searchParams) {
      if (!MYSQL_URI_KEPT_PARAMS.has(key)) continue;
      try { fromUri[key] = JSON.parse(value); } catch { fromUri[key] = value; }
    }
    Object.assign(base, { ...fromUri, ...rest });
  }
  base.user = credential.user;
  base.password = credential.password;
  base.pool = { max: 2, min: 0 };
  base.resetSession = true;
  if (dialect === 'mysql') Object.assign(base, { flags: ['-LOCAL_FILES', '-MULTI_STATEMENTS'], multipleStatements: false });
  return base;
}
