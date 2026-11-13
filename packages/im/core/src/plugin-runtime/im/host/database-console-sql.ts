/**
 * Statement analysis for the Console SQL editor (`db:query` / `db:execute`).
 *
 * This is a guard rail, not the enforcement. The Host runs every Console statement through a
 * single-statement protocol (PostgreSQL extended protocol, MySQL prepared statements, SQLite
 * `prepare()`), so text this lexer splits differently from the server can still never carry a
 * second statement; read-only statements also run in a read-only transaction (SQLite
 * `query_only`, PostgreSQL `READ ONLY`, MySQL `START TRANSACTION READ ONLY`).
 */
import { isGatewayOwnedTable, referencesGatewayOwnedTable } from '@zhin.js/database';

export type ConsoleSqlDialect = 'sqlite' | 'mysql' | 'pg';

export interface ConsoleSqlToken {
  /** `word`: bare identifier / keyword; `quoted`: quoted identifier; `string`: literal; `punct`: one other character. */
  readonly type: 'word' | 'quoted' | 'string' | 'punct';
  /** Words lower-cased; quoted names and strings unquoted with their escapes resolved. */
  readonly value: string;
}

export interface ConsoleSqlStatement {
  /** Original statement text without the trailing terminator. */
  readonly text: string;
  /** Lower-cased text with comments removed and literals / quoted identifiers blanked. */
  readonly code: string;
  /** Every identifier, quoted ones unquoted (lower-cased). */
  readonly identifiers: readonly string[];
  /** Tokens without comments and whitespace. */
  readonly tokens: readonly ConsoleSqlToken[];
  /** Names called as functions (`name(` / `"name"(` / `schema.name(`), lower-cased, schema stripped. */
  readonly functions: readonly string[];
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

const WORD = /^[A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*/;
/** PostgreSQL dollar-quote tag: `$$` or `$name$` (a letter or `_` first, then letters / digits / `_`). */
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

/**
 * Splits SQL into statements on top-level `;`, honouring per dialect: strings (`E'…'` backslash
 * escapes on PostgreSQL, backslashes in MySQL strings), quoted names, `--` / `#` / nested
 * PostgreSQL block comments and `$tag$` bodies. Refuses what it cannot analyse safely: PostgreSQL
 * `U&` escaped names and strings, MySQL executable comments (`/*! … *\/`) and optimizer hints.
 */
export function splitConsoleSql(sql: string, dialect: ConsoleSqlDialect): ConsoleSqlStatement[] {
  const statements: ConsoleSqlStatement[] = [];
  let start = 0;
  let code = '';
  let tokens: ConsoleSqlToken[] = [];
  let index = 0;
  const flush = (end: number) => {
    const text = sql.slice(start, end).trim();
    if (text) {
      const identifiers = tokens.filter(token => token.type === 'word' || token.type === 'quoted').map(token => token.value.toLowerCase());
      statements.push(Object.freeze({
        text,
        code: code.toLowerCase().replace(/\s+/g, ' ').trim(),
        identifiers: Object.freeze(identifiers),
        tokens: Object.freeze(tokens),
        functions: Object.freeze(calledFunctions(tokens)),
      }));
    }
    code = '';
    tokens = [];
  };
  const push = (type: ConsoleSqlToken['type'], value: string) => tokens.push(Object.freeze({ type, value }));
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];
    // MySQL: `--` starts a comment only before whitespace or a control character (`--x` is `- -x`).
    if (char === '-' && next === '-' && (dialect !== 'mysql' || index + 2 >= sql.length || /[\s\u0000-\u001f]/.test(sql[index + 2]!))
      || (dialect === 'mysql' && char === '#')) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      code += ' ';
      continue;
    }
    if (char === '/' && next === '*') {
      if (dialect === 'mysql' && (sql[index + 2] === '!' || sql[index + 2] === '+')) {
        throw new ConsoleSqlRefusal('refused_statement', 'MySQL executable comments (/*! … */) and optimizer hints (/*+ … */) are not allowed');
      }
      index = skipBlockComment(sql, index, dialect === 'pg');
      code += ' ';
      continue;
    }
    if (dialect === 'pg' && (char === 'u' || char === 'U') && next === '&' && /['"]/.test(sql[index + 2] ?? '') && !isWordChar(sql[index - 1])) {
      throw new ConsoleSqlRefusal('refused_statement', 'U& escaped names and strings are not allowed from the Console');
    }
    if (char === '\'' || (char === '"' && dialect === 'mysql')) {
      // PostgreSQL E'…' (the `E` was just read as a word) resolves backslash escapes.
      const previous = tokens.at(-1);
      const escapeString = dialect === 'mysql'
        || (dialect === 'pg' && previous?.type === 'word' && previous.value === 'e' && /[eE]/.test(sql[index - 1] ?? ''));
      if (escapeString && dialect === 'pg') { tokens.pop(); code = code.slice(0, -1); }
      const end = skipQuoted(sql, index, char, escapeString);
      push('string', unquote(sql.slice(index + 1, end - 1), char, escapeString));
      code += ' \'\' ';
      index = end;
      continue;
    }
    if (char === '"' || char === '`' || (char === '[' && dialect === 'sqlite')) {
      const close = char === '[' ? ']' : char;
      const end = skipQuoted(sql, index, close, false, char === '[');
      push('quoted', unquote(sql.slice(index + 1, end - 1), close, false));
      code += ' "q" ';
      index = end;
      continue;
    }
    if (char === '$' && dialect === 'pg') {
      const tag = DOLLAR_TAG.exec(sql.slice(index, index + 256));
      if (tag) {
        const end = sql.indexOf(tag[0], index + tag[0].length);
        if (end === -1) throw new ConsoleSqlRefusal('refused_statement', 'Unterminated dollar-quoted string');
        push('string', sql.slice(index + tag[0].length, end));
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
    const word = WORD.exec(sql.slice(index, index + 256));
    if (word) {
      push('word', word[0].toLowerCase());
      code += word[0];
      index += word[0].length;
      continue;
    }
    if (!/\s/.test(char)) push('punct', char);
    code += char;
    index += 1;
  }
  flush(sql.length);
  return statements;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$\u0080-\uffff]/.test(char);
}

/** End of a block comment starting at `from`; PostgreSQL nests them (`/* /* *\/ *\/`). */
function skipBlockComment(sql: string, from: number, nested: boolean): number {
  let depth = 0;
  let index = from;
  while (index < sql.length) {
    if (sql[index] === '/' && sql[index + 1] === '*') {
      if (depth === 0 || nested) depth += 1;
      index += 2;
      continue;
    }
    if (sql[index] === '*' && sql[index + 1] === '/') {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  throw new ConsoleSqlRefusal('refused_statement', 'Unterminated comment');
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

/** Body of a quoted token: doubled closing quotes collapsed, backslash escapes reduced to the escaped character. */
function unquote(body: string, close: string, backslash: boolean): string {
  const collapsed = close === ']' ? body : body.replaceAll(close + close, close);
  return backslash ? collapsed.replace(/\\(.)/gs, '$1') : collapsed;
}

/** Last name part of every `name (` call. */
function calledFunctions(tokens: readonly ConsoleSqlToken[]): string[] {
  const names: string[] = [];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const token = tokens[index]!;
    const following = tokens[index + 1]!;
    if ((token.type === 'word' || token.type === 'quoted') && following.type === 'punct' && following.value === '(') {
      names.push(token.value.toLowerCase());
    }
  }
  return names;
}

/** SQLite PRAGMAs that only report, with or without a table / index argument. */
const READ_PRAGMAS: ReadonlySet<string> = new Set([
  'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list',
  'foreign_key_check', 'integrity_check', 'quick_check', 'database_list', 'collation_list', 'compile_options',
  'function_list', 'module_list', 'pragma_list', 'user_version', 'schema_version', 'application_id', 'page_count',
  'page_size', 'freelist_count', 'encoding', 'journal_mode', 'foreign_keys', 'data_version',
]);

/**
 * Server functions the Console refuses (read and write SQL, owners included), matched against the
 * called name with quotes and schema removed (`"pg_catalog"."set_config"(…)` is `set_config`):
 * effects a read-only transaction does not stop (backend signals, files, large objects, advisory
 * locks, settings — `set_config` would lift `statement_timeout`), and dynamic SQL that runs a
 * query built at run time (`query_to_xml('select … from con' || 'sole_users', …)`), which no text
 * check of the statement could see.
 */
const REFUSED_FUNCTIONS: ReadonlySet<string> = new Set([
  'set_config', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile', 'pg_promote',
  'pg_switch_wal', 'pg_stat_file', 'pg_create_restore_point', 'pg_import_system_collations', 'pg_notify',
  'pg_start_backup', 'pg_stop_backup', 'pg_backup_start', 'pg_backup_stop', 'loread', 'lowrite',
  'query_to_xml', 'query_to_xmlschema', 'query_to_xml_and_xmlschema', 'cursor_to_xml', 'cursor_to_xmlschema',
  'ts_stat', 'ts_rewrite', 'xpath', 'xpath_exists',
  // MySQL / SQLite
  'load_file', 'sys_exec', 'sys_eval', 'load_extension', 'readfile', 'writefile', 'edit', 'fts3_tokenizer',
]);
const REFUSED_FUNCTION_PATTERN = /^(?:dblink\w*|lo_\w+|pg_read_\w+|pg_ls_\w+|pg_file_\w+|pg_(?:try_)?advisory\w*|pg_logical_\w+|pg_\w*replication\w*|pg_\w*_slot\w*|\w*_to_xml\w*|query_to_\w+|xpath\w*)$/;

export function isRefusedConsoleFunction(name: string): boolean {
  const bare = name.toLowerCase();
  return REFUSED_FUNCTIONS.has(bare) || REFUSED_FUNCTION_PATTERN.test(bare);
}

/** First refused function a statement calls, if any. */
export function refusedFunctionIn(statement: ConsoleSqlStatement): string | undefined {
  return statement.functions.find(isRefusedConsoleFunction);
}

/** Statements that control the transaction or run SQL text built at run time (both paths refuse them). */
const TRANSACTION_CONTROL: ReadonlySet<string> = new Set([
  'begin', 'commit', 'rollback', 'savepoint', 'release', 'start', 'end', 'abort', 'set', 'reset', 'xa',
  'prepare', 'execute', 'deallocate', 'lock', 'unlock',
]);

/** SQLite table-valued PRAGMA functions only take literals (`pragma_table_info('t')`), never expressions. */
function nonLiteralPragmaCall(statement: ConsoleSqlStatement): string | undefined {
  const { tokens } = statement;
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const token = tokens[index]!;
    if ((token.type !== 'word' && token.type !== 'quoted') || !token.value.toLowerCase().startsWith('pragma_')) continue;
    if (tokens[index + 1]?.value !== '(' || tokens[index + 1]?.type !== 'punct') continue;
    for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
      const argument = tokens[cursor]!;
      if (argument.type === 'punct' && argument.value === ')') break;
      if (argument.type === 'string') continue;
      if (argument.type === 'punct' && /^[,0-9.\-]$/.test(argument.value)) continue;
      return token.value;
    }
  }
  return undefined;
}

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

/**
 * First protected table a statement mentions, if any: identifiers are compared unquoted, with
 * doubled quotes resolved and lower-cased (schema parts are separate tokens, so `main."console_x"`
 * is `console_x`), string literals by content, and the raw text with escape sequences decoded.
 */
export function protectedTableIn(statement: ConsoleSqlStatement, options: { readonly forRead: boolean }): string | undefined {
  for (const identifier of statement.identifiers) {
    if (isGatewayOwnedTable(identifier)) return identifier;
    if (!options.forRead && isProtectedConsoleTable(identifier)) return identifier;
  }
  // `console_x` can also hide in a string literal (`SELECT * FROM pragma_table_info('console_users')`).
  for (const token of statement.tokens) {
    if (token.type !== 'string') continue;
    const literal = /(?<![A-Za-z0-9_$])console_[A-Za-z0-9_$]*/gi;
    for (const match of token.value.matchAll(literal)) if (isGatewayOwnedTable(match[0])) return match[0].toLowerCase();
  }
  if (referencesGatewayOwnedTable(statement.text)) return 'console_*';
  return undefined;
}

/** `CREATE` / `ALTER` forms that define code running SQL later (functions, rules) or change roles and server settings. */
const REFUSED_DEFINITION = /^(?:create (?:or replace )?(?:definer ?= ?\S+ )?(?:(?:temp|temporary|trusted|procedural|constraint) )*(?:function|procedure|rule|extension|language|server|event|role|user|foreign|aggregate|operator|cast|transform|publication|subscription|access method|text search)\b|alter (?:system|role|user|database|function|procedure|extension|server|default privileges|event|language|foreign|publication|subscription)\b|import foreign\b|security label\b)/;

/** Statements the Console refuses even for an owner (transaction control, engine settings, dynamic SQL). */
export function refusedWriteStatement(statement: ConsoleSqlStatement): string | undefined {
  const first = /^\(*\s*([a-z_]+)/.exec(statement.code)?.[1] ?? '';
  if (TRANSACTION_CONTROL.has(first) || ['attach', 'detach', 'vacuum', 'load', 'grant', 'revoke', 'copy', 'do', 'call', 'handler', 'flush', 'kill', 'shutdown', 'install', 'uninstall', 'listen', 'unlisten', 'notify', 'discard', 'checkpoint'].includes(first)) {
    return first.toUpperCase();
  }
  if (first === 'pragma' && statement.code.includes('=')) return 'PRAGMA … =';
  if (first === 'pragma' && /\b(?:writable_schema|query_only|journal_mode|locking_mode|key|rekey|trusted_schema)\b/.test(statement.code)) return 'PRAGMA';
  if (/\binto (?:outfile|dumpfile)\b/.test(statement.code)) return 'INTO OUTFILE';
  const definition = REFUSED_DEFINITION.exec(statement.code.replace(/^\(+\s*/, ''));
  if (definition) return definition[0].toUpperCase();
  return undefined;
}

/** Checks both paths share: refused functions, non-literal PRAGMA functions, protected tables. */
function assertConsoleStatement(statement: ConsoleSqlStatement, forRead: boolean): void {
  const refusedFunction = refusedFunctionIn(statement);
  if (refusedFunction) throw new ConsoleSqlRefusal('refused_statement', `${refusedFunction}() is not allowed from the Console`);
  // Raw database pages (when compiled in) would expose every table's bytes, the gateway's included.
  if (statement.identifiers.includes('sqlite_dbpage')) throw new ConsoleSqlRefusal('refused_statement', 'sqlite_dbpage is not allowed from the Console');
  const pragma = nonLiteralPragmaCall(statement);
  if (pragma) throw new ConsoleSqlRefusal('refused_statement', `${pragma}() only takes literal arguments from the Console`);
  const table = protectedTableIn(statement, { forRead });
  if (table) {
    throw new ConsoleSqlRefusal('protected_table', forRead || isGatewayOwnedTable(table) || table === 'console_*'
      ? `Table '${table}' is owned by the management gateway and is not accessible from the instance`
      : `Table '${table}' is protected and cannot be changed from the Console`);
  }
}

/** Validates one read-only statement for `db:query`; throws {@link ConsoleSqlRefusal}. */
export function readOnlyConsoleStatement(sql: string, dialect: ConsoleSqlDialect): ConsoleSqlStatement & { readonly kind: ConsoleSqlReadKind } {
  const statements = splitConsoleSql(sql, dialect);
  if (!statements.length) throw new ConsoleSqlRefusal('empty', 'SQL is empty');
  if (statements.length > 1) throw new ConsoleSqlRefusal('multi_statement', 'Only one statement can run as a read-only query');
  const statement = statements[0]!;
  const first = /^\(*\s*([a-z_]+)/.exec(statement.code)?.[1] ?? '';
  if (TRANSACTION_CONTROL.has(first)) throw new ConsoleSqlRefusal('refused_statement', `${first.toUpperCase()} is not allowed from the Console SQL editor`);
  const kind = readStatementKind(statement, dialect);
  if (!kind) throw new ConsoleSqlRefusal('read_only', 'Only read statements (SELECT / WITH / EXPLAIN / SHOW / read PRAGMA) run as a read-only query; use a write run for others');
  assertConsoleStatement(statement, true);
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
    assertConsoleStatement(statement, false);
  }
  return statements;
}

/**
 * SQL text for the audit log with literal values replaced by `'…'` (strings, `E'…'`, `$tag$…$tag$`,
 * MySQL double-quoted strings): statements may carry passwords or tokens that a viewer of the
 * audit log must not read. Keywords, identifiers and numbers stay.
 */
export function redactConsoleSql(sql: string, dialect: ConsoleSqlDialect): string {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === '\'' || (char === '"' && dialect === 'mysql')) {
      const backslash = dialect === 'mysql' || (dialect === 'pg' && /[eE]/.test(sql[index - 1] ?? '') && !isWordChar(sql[index - 2]));
      let end: number;
      try { end = skipQuoted(sql, index, char, backslash); } catch { end = sql.length; }
      out += `${char}…${char}`;
      index = end;
      continue;
    }
    if (char === '$' && dialect === 'pg') {
      const tag = DOLLAR_TAG.exec(sql.slice(index, index + 256));
      if (tag) {
        const end = sql.indexOf(tag[0], index + tag[0].length);
        out += `${tag[0]}…${tag[0]}`;
        index = end === -1 ? sql.length : end + tag[0].length;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}
