/**
 * Statement analysis for the Console SQL editor (`db:query` / `db:execute`).
 *
 * This is a guard rail, not the enforcement: read-only statements also run in a read-only
 * transaction (SQLite `query_only`, PostgreSQL `READ ONLY`, MySQL `START TRANSACTION READ ONLY`),
 * so a statement the classifier misjudges as a read still cannot write.
 */
import { isGatewayOwnedTable } from '@zhin.js/database';

export type ConsoleSqlDialect = 'sqlite' | 'mysql' | 'pg';

export interface ConsoleSqlStatement {
  /** Original statement text without the trailing terminator. */
  readonly text: string;
  /** Lower-cased text with comments removed and literals / quoted identifiers blanked. */
  readonly code: string;
  /** Every identifier, quoted ones unquoted (lower-cased). */
  readonly identifiers: readonly string[];
}

export class ConsoleSqlRefusal extends Error {
  constructor(
    readonly code: 'empty' | 'multi_statement' | 'read_only' | 'protected_table' | 'refused_statement' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'ConsoleSqlRefusal';
  }
}

/** Splits SQL into statements on top-level `;`, honouring strings, quoted names, comments and `$tag$` bodies. */
export function splitConsoleSql(sql: string, dialect: ConsoleSqlDialect): ConsoleSqlStatement[] {
  const statements: ConsoleSqlStatement[] = [];
  let start = 0;
  let code = '';
  let identifiers: string[] = [];
  let index = 0;
  const flush = (end: number) => {
    const text = sql.slice(start, end).trim();
    if (text) statements.push(Object.freeze({ text, code: code.toLowerCase().replace(/\s+/g, ' ').trim(), identifiers: Object.freeze(identifiers) }));
    code = '';
    identifiers = [];
  };
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (char === '-' && next === '-' || (dialect === 'mysql' && char === '#')) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      code += ' ';
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      if (end === -1) throw new ConsoleSqlRefusal('refused_statement', 'Unterminated comment');
      index = end + 2;
      code += ' ';
      continue;
    }
    if (char === '\'' || (char === '"' && dialect === 'mysql')) {
      index = skipQuoted(sql, index, char, dialect === 'mysql');
      code += ' \'\' ';
      continue;
    }
    if (char === '"' || char === '`' || (char === '[' && dialect === 'sqlite')) {
      const close = char === '[' ? ']' : char;
      const end = skipQuoted(sql, index, close, false, char === '[');
      identifiers.push(sql.slice(index + 1, end - 1).replaceAll(close + close, close).toLowerCase());
      code += ' "q" ';
      index = end;
      continue;
    }
    if (char === '$' && dialect === 'pg') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
      if (tag) {
        const end = sql.indexOf(tag[0], index + tag[0].length);
        if (end === -1) throw new ConsoleSqlRefusal('refused_statement', 'Unterminated dollar-quoted string');
        index = end + tag[0].length;
        code += ' \'\' ';
        continue;
      }
    }
    if (char === ';') {
      flush(index);
      index += 1;
      start = index;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index, index + 256));
    if (word) {
      identifiers.push(word[0].toLowerCase());
      code += word[0];
      index += word[0].length;
      continue;
    }
    code += char;
    index += 1;
  }
  flush(sql.length);
  return statements;
}

function skipQuoted(sql: string, from: number, quote: string, backslash: boolean, bracket = false): number {
  let index = from + 1;
  while (index < sql.length) {
    const char = sql[index]!;
    if (backslash && char === '\\') { index += 2; continue; }
    if (char === quote) {
      if (!bracket && sql[index + 1] === quote) { index += 2; continue; }
      return index + 1;
    }
    index += 1;
  }
  throw new ConsoleSqlRefusal('refused_statement', 'Unterminated quoted text');
}

/** SQLite PRAGMAs that only report, with or without a table / index argument. */
const READ_PRAGMAS: ReadonlySet<string> = new Set([
  'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list',
  'foreign_key_check', 'integrity_check', 'quick_check', 'database_list', 'collation_list', 'compile_options',
  'function_list', 'module_list', 'pragma_list', 'user_version', 'schema_version', 'application_id', 'page_count',
  'page_size', 'freelist_count', 'encoding', 'journal_mode', 'foreign_keys', 'data_version',
]);

/** Server-side functions with effects a read-only transaction does not stop. */
const REFUSED_READ_FUNCTIONS = /\b(?:pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_promote|pg_switch_wal|lo_import|lo_export|lo_unlink|dblink\w*|set_config|pg_advisory\w*|load_file|load_extension)\s*\(/;

const WRITE_WORDS = /\b(?:insert|update|delete|merge|replace|upsert|create|drop|alter|truncate|grant|revoke|vacuum|reindex|attach|detach|copy|call|do|lock|set|reset|load)\b/;

export type ConsoleSqlReadKind = 'select' | 'with' | 'explain' | 'show' | 'describe' | 'pragma' | 'values';

/**
 * The read form of one statement, or null when it may write. Callers still run reads in a
 * read-only transaction.
 */
export function readStatementKind(statement: ConsoleSqlStatement, dialect: ConsoleSqlDialect): ConsoleSqlReadKind | null {
  const code = statement.code;
  const first = /^\(*\s*([a-z_]+)/.exec(code)?.[1];
  switch (first) {
    case 'select':
    case 'values':
      return /\binto\b|\bfor (?:update|share|no key update|key share)\b/.test(code) ? null : first;
    case 'with':
      return WRITE_WORDS.test(code) || /\binto\b|\bfor (?:update|share)\b/.test(code) ? null : 'with';
    case 'explain': {
      if (WRITE_WORDS.test(code.replace(/^explain\b/, '')) || /\binto\b/.test(code)) return null;
      return 'explain';
    }
    case 'show':
      return dialect === 'sqlite' || /\bshow (?:grants|create user)\b/.test(code) ? null : 'show';
    case 'describe':
    case 'desc':
      return dialect === 'mysql' ? 'describe' : null;
    case 'pragma': {
      if (dialect !== 'sqlite' || code.includes('=')) return null;
      const match = /^pragma (?:"q" ?\. ?|[a-z_]+ ?\. ?)?([a-z_]+) ?(\(.*\))? ?$/.exec(code);
      if (!match || !READ_PRAGMAS.has(match[1]!)) return null;
      // An argument sets most pragmas (`PRAGMA query_only(0)`); only table / index pragmas read with one.
      if (match[2] && !/^(?:table_info|table_xinfo|table_list|index_list|index_info|index_xinfo|foreign_key_list|foreign_key_check|integrity_check|quick_check)$/.test(match[1]!)) return null;
      return 'pragma';
    }
    default:
      return null;
  }
}

/**
 * Tables the Console never changes: the gateway's `console_*` (never even read), migration
 * bookkeeping and engine catalogs. Reads of the latter are allowed.
 */
const PROTECTED_TABLE = /^(?:__zhin_persistent_state|_migrations|agent_schedule_migration|sqlite_\w+|pg_\w+|information_schema|mysql|performance_schema|sys)$/;

export function isProtectedConsoleTable(name: string): boolean {
  const bare = String(name).trim().toLowerCase();
  return isGatewayOwnedTable(bare) || PROTECTED_TABLE.test(bare);
}

/** First protected table a statement mentions (identifier or quoted name), if any. */
export function protectedTableIn(statement: ConsoleSqlStatement, options: { readonly forRead: boolean }): string | undefined {
  for (const identifier of statement.identifiers) {
    if (isGatewayOwnedTable(identifier)) return identifier;
    if (!options.forRead && isProtectedConsoleTable(identifier)) return identifier;
  }
  // `console_x` can also hide in a string literal (`SELECT * FROM pragma_table_info('console_users')`).
  const literal = /(?<![A-Za-z0-9_$])console_[A-Za-z0-9_$]*/gi;
  for (const match of statement.text.matchAll(literal)) if (isGatewayOwnedTable(match[0])) return match[0].toLowerCase();
  return undefined;
}

/** Statements the write console refuses even for an owner (transaction control, engine settings). */
export function refusedWriteStatement(statement: ConsoleSqlStatement): string | undefined {
  const first = /^\(*\s*([a-z_]+)/.exec(statement.code)?.[1] ?? '';
  if (['begin', 'commit', 'rollback', 'savepoint', 'release', 'start', 'end', 'attach', 'detach', 'vacuum', 'load', 'grant', 'revoke', 'set', 'reset', 'copy', 'do', 'call', 'handler', 'lock', 'unlock', 'flush', 'kill', 'shutdown', 'install', 'uninstall'].includes(first)) {
    return first.toUpperCase();
  }
  if (first === 'pragma' && statement.code.includes('=')) return 'PRAGMA … =';
  if (first === 'pragma' && /\b(?:writable_schema|query_only|journal_mode|locking_mode|key|rekey)\b/.test(statement.code)) return 'PRAGMA';
  if (/\binto (?:outfile|dumpfile)\b/.test(statement.code)) return 'INTO OUTFILE';
  return undefined;
}

/** Validates one read-only statement for `db:query`; throws {@link ConsoleSqlRefusal}. */
export function readOnlyConsoleStatement(sql: string, dialect: ConsoleSqlDialect): ConsoleSqlStatement & { readonly kind: ConsoleSqlReadKind } {
  const statements = splitConsoleSql(sql, dialect);
  if (!statements.length) throw new ConsoleSqlRefusal('empty', 'SQL is empty');
  if (statements.length > 1) throw new ConsoleSqlRefusal('multi_statement', 'Only one statement can run as a read-only query');
  const statement = statements[0]!;
  const kind = readStatementKind(statement, dialect);
  if (!kind) throw new ConsoleSqlRefusal('read_only', 'Only read statements (SELECT / WITH / EXPLAIN / SHOW / read PRAGMA) run without ops.database.schema');
  if (REFUSED_READ_FUNCTIONS.test(statement.code)) throw new ConsoleSqlRefusal('refused_statement', 'This server function is not allowed from the Console');
  const table = protectedTableIn(statement, { forRead: true });
  if (table) throw new ConsoleSqlRefusal('protected_table', `Table '${table}' is owned by the management gateway and is not accessible from the instance`);
  return Object.freeze({ ...statement, kind });
}

/** Validates the statements of `db:execute`; throws {@link ConsoleSqlRefusal}. */
export function writeConsoleStatements(sql: string, dialect: ConsoleSqlDialect, maxStatements = 50): ConsoleSqlStatement[] {
  const statements = splitConsoleSql(sql, dialect);
  if (!statements.length) throw new ConsoleSqlRefusal('empty', 'SQL is empty');
  if (statements.length > maxStatements) throw new ConsoleSqlRefusal('multi_statement', `At most ${maxStatements} statements per run`);
  for (const statement of statements) {
    const refused = refusedWriteStatement(statement);
    if (refused) throw new ConsoleSqlRefusal('refused_statement', `${refused} is not allowed from the Console SQL editor`);
    const table = protectedTableIn(statement, { forRead: false });
    if (table) throw new ConsoleSqlRefusal('protected_table', `Table '${table}' is protected and cannot be changed from the Console`);
  }
  return statements;
}
