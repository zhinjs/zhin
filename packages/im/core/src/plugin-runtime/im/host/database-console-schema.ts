/**
 * Console schema editor (`db:schema:*`): validates a structured change and renders the DDL the
 * Host will run, so the Console previews exactly what is applied. Identifiers of new objects are
 * restricted to `[A-Za-z_][A-Za-z0-9_]*`; existing names are quoted with their quotes escaped.
 */
import type {
  DatabaseHostColumnSpec,
  DatabaseHostSchemaChange,
  DatabaseHostSchemaPlan,
  DatabaseHostTableSchema,
} from '@zhin.js/plugin-runtime';
import { isProtectedConsoleTable, type ConsoleSqlDialect } from './database-console-sql.js';

export class ConsoleSchemaRefusal extends Error {
  constructor(readonly code: 'invalid' | 'unsupported' | 'protected_table' | 'not_found' | 'confirm_required', message: string) {
    super(message);
    this.name = 'ConsoleSchemaRefusal';
  }
}

const COLUMN_TYPES = new Set(['text', 'integer', 'bigint', 'float', 'boolean', 'date', 'json']);
const NEW_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** The subset of a `@zhin.js/database` dialect the renderer needs. */
export interface SchemaDialect {
  readonly name: string;
  mapColumnType(type: string): string;
  formatDefaultValue(value: unknown): string;
}

export function quoteConsoleIdentifier(dialect: ConsoleSqlDialect, name: string): string {
  return dialect === 'mysql' ? `\`${name.replaceAll('`', '``')}\`` : `"${name.replaceAll('"', '""')}"`;
}

function newName(value: unknown, what: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!NEW_NAME.test(name)) throw new ConsoleSchemaRefusal('invalid', `${what} must match [A-Za-z_][A-Za-z0-9_]* (max 63 characters)`);
  if (isProtectedConsoleTable(name) || name.toLowerCase().startsWith('__zhin_')) {
    throw new ConsoleSchemaRefusal('protected_table', `Name '${name}' is reserved`);
  }
  return name;
}

function existingName(value: unknown, what: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 256 || /[\u0000-\u001f]/.test(name)) throw new ConsoleSchemaRefusal('invalid', `${what} is required`);
  return name;
}

function columnSpec(value: unknown, forCreate: boolean): DatabaseHostColumnSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConsoleSchemaRefusal('invalid', 'column is required');
  const raw = value as Record<string, unknown>;
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  if (!COLUMN_TYPES.has(type)) throw new ConsoleSchemaRefusal('invalid', `Column type must be one of ${[...COLUMN_TYPES].join(', ')}`);
  const spec: DatabaseHostColumnSpec = {
    name: newName(raw.name, 'Column name'),
    type: type as DatabaseHostColumnSpec['type'],
    ...(typeof raw.nullable === 'boolean' ? { nullable: raw.nullable } : {}),
    ...(Object.hasOwn(raw, 'default') && raw.default !== undefined ? { default: defaultValue(raw.default) } : {}),
    ...(forCreate && raw.primary === true ? { primary: true } : {}),
    ...(forCreate && raw.autoIncrement === true ? { autoIncrement: true } : {}),
    ...(forCreate && raw.unique === true ? { unique: true } : {}),
    ...(typeof raw.length === 'number' && Number.isSafeInteger(raw.length) && raw.length > 0 && raw.length <= 65535 ? { length: raw.length } : {}),
  };
  if (spec.autoIncrement && (!spec.primary || (spec.type !== 'integer' && spec.type !== 'bigint'))) {
    throw new ConsoleSchemaRefusal('invalid', 'autoIncrement needs an integer primary key');
  }
  return Object.freeze(spec);
}

function defaultValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new ConsoleSchemaRefusal('invalid', 'default must be text, a number, a boolean or null');
}

function columnSql(dialect: ConsoleSqlDialect, host: SchemaDialect, spec: DatabaseHostColumnSpec): string {
  const name = quoteConsoleIdentifier(dialect, spec.name);
  let type = host.mapColumnType(spec.type);
  if (spec.autoIncrement && dialect === 'pg') type = spec.type === 'bigint' ? 'BIGSERIAL' : 'SERIAL';
  if (spec.autoIncrement && dialect === 'sqlite') type = 'INTEGER';
  const length = spec.length && !spec.autoIncrement && !/\(/.test(type) && /CHAR|TEXT/i.test(type) && dialect !== 'sqlite' && !(dialect === 'pg' && type === 'TEXT') ? `(${spec.length})` : '';
  const parts = [`${name} ${type}${length}`];
  if (spec.primary) parts.push('PRIMARY KEY');
  if (spec.autoIncrement && dialect === 'sqlite') parts.push('AUTOINCREMENT');
  if (spec.autoIncrement && dialect === 'mysql') parts.push('AUTO_INCREMENT');
  if (spec.unique) parts.push('UNIQUE');
  if (spec.nullable === false && !spec.primary) parts.push('NOT NULL');
  if (spec.default !== undefined) parts.push(`DEFAULT ${host.formatDefaultValue(spec.default)}`);
  return parts.join(' ');
}

export interface SchemaPlanContext {
  readonly dialect: ConsoleSqlDialect;
  readonly host: SchemaDialect;
  /** True when the table exists (declared, discovered or physical). */
  hasTable(table: string): boolean;
  /** Current columns of an existing table, for checks and MySQL `MODIFY`. */
  describe(table: string): Promise<DatabaseHostTableSchema>;
}

/** Validates a change and renders its DDL; throws {@link ConsoleSchemaRefusal}. */
export async function planConsoleSchemaChange(input: unknown, context: SchemaPlanContext): Promise<DatabaseHostSchemaPlan> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConsoleSchemaRefusal('invalid', 'change is required');
  const raw = input as Record<string, unknown>;
  const { dialect, host } = context;
  const q = (name: string) => quoteConsoleIdentifier(dialect, name);
  const warnings: string[] = [];

  if (raw.kind === 'create-table') {
    const table = newName(raw.table, 'Table name');
    if (context.hasTable(table)) throw new ConsoleSchemaRefusal('invalid', `Table '${table}' already exists`);
    if (!Array.isArray(raw.columns) || !raw.columns.length || raw.columns.length > 200) throw new ConsoleSchemaRefusal('invalid', 'A table needs 1–200 columns');
    const columns = raw.columns.map(column => columnSpec(column, true));
    const names = new Set<string>();
    for (const column of columns) {
      if (names.has(column.name.toLowerCase())) throw new ConsoleSchemaRefusal('invalid', `Duplicate column '${column.name}'`);
      names.add(column.name.toLowerCase());
    }
    if (columns.filter(column => column.primary).length > 1) throw new ConsoleSchemaRefusal('invalid', 'Only one primary key column is supported');
    if (!columns.some(column => column.primary)) warnings.push('no_primary_key');
    const change: DatabaseHostSchemaChange = Object.freeze({ kind: 'create-table', table, columns: Object.freeze(columns) });
    return plan(change, [`CREATE TABLE ${q(table)} (${columns.map(column => columnSql(dialect, host, column)).join(', ')})`], false, undefined, warnings);
  }

  const table = existingName(raw.table, 'table');
  if (isProtectedConsoleTable(table)) throw new ConsoleSchemaRefusal('protected_table', `Table '${table}' is protected and cannot be changed from the Console`);
  if (!context.hasTable(table)) throw new ConsoleSchemaRefusal('not_found', `Table '${table}' not found`);
  const current = await context.describe(table);
  const column = (name: string) => current.columns.find(entry => entry.name === name);

  switch (raw.kind) {
    case 'add-column': {
      const spec = columnSpec(raw.column, false);
      if (column(spec.name)) throw new ConsoleSchemaRefusal('invalid', `Column '${spec.name}' already exists`);
      if (dialect === 'sqlite' && spec.nullable === false && spec.default === undefined) {
        throw new ConsoleSchemaRefusal('unsupported', 'SQLite can only add a NOT NULL column with a default value');
      }
      if (dialect !== 'sqlite' && spec.nullable === false && spec.default === undefined) warnings.push('not_null_without_default');
      const change: DatabaseHostSchemaChange = Object.freeze({ kind: 'add-column', table, column: spec });
      return plan(change, [`ALTER TABLE ${q(table)} ADD COLUMN ${columnSql(dialect, host, spec)}`], false, undefined, warnings);
    }
    case 'rename-column': {
      const from = existingName(raw.column, 'column');
      if (!column(from)) throw new ConsoleSchemaRefusal('not_found', `Column '${from}' not found`);
      const to = newName(raw.to, 'New column name');
      if (column(to)) throw new ConsoleSchemaRefusal('invalid', `Column '${to}' already exists`);
      warnings.push('code_may_reference_column');
      const change: DatabaseHostSchemaChange = Object.freeze({ kind: 'rename-column', table, column: from, to });
      return plan(change, [`ALTER TABLE ${q(table)} RENAME COLUMN ${q(from)} TO ${q(to)}`], false, undefined, warnings);
    }
    case 'drop-column': {
      const name = existingName(raw.column, 'column');
      const existing = column(name);
      if (!existing) throw new ConsoleSchemaRefusal('not_found', `Column '${name}' not found`);
      if (existing.primary) throw new ConsoleSchemaRefusal('unsupported', 'The primary key column cannot be dropped');
      if (current.columns.length < 2) throw new ConsoleSchemaRefusal('unsupported', 'A table must keep at least one column');
      const change: DatabaseHostSchemaChange = Object.freeze({ kind: 'drop-column', table, column: name });
      return plan(change, [`ALTER TABLE ${q(table)} DROP COLUMN ${q(name)}`], true, name, ['data_loss']);
    }
    case 'alter-column': {
      const name = existingName(raw.column, 'column');
      const existing = column(name);
      if (!existing) throw new ConsoleSchemaRefusal('not_found', `Column '${name}' not found`);
      if (dialect === 'sqlite') {
        throw new ConsoleSchemaRefusal('unsupported', 'SQLite cannot change a column’s type, nullability or default in place (the table would have to be rebuilt)');
      }
      const type = raw.type === undefined ? undefined : String(raw.type).toLowerCase();
      if (type !== undefined && !COLUMN_TYPES.has(type)) throw new ConsoleSchemaRefusal('invalid', `Column type must be one of ${[...COLUMN_TYPES].join(', ')}`);
      const nullable = typeof raw.nullable === 'boolean' ? raw.nullable : undefined;
      const dropDefault = raw.dropDefault === true;
      const hasDefault = Object.hasOwn(raw, 'default') && raw.default !== undefined;
      const value = hasDefault ? defaultValue(raw.default) : undefined;
      if (type === undefined && nullable === undefined && !hasDefault && !dropDefault) throw new ConsoleSchemaRefusal('invalid', 'Nothing to change');
      if (hasDefault && dropDefault) throw new ConsoleSchemaRefusal('invalid', 'Set a default or drop it, not both');
      const change: DatabaseHostSchemaChange = Object.freeze({
        kind: 'alter-column', table, column: name,
        ...(type ? { type: type as DatabaseHostColumnSpec['type'] } : {}),
        ...(nullable !== undefined ? { nullable } : {}),
        ...(hasDefault ? { default: value } : {}),
        ...(dropDefault ? { dropDefault: true } : {}),
      });
      if (type) warnings.push('type_change_may_fail');
      if (nullable === false) warnings.push('not_null_requires_values');
      if (dialect === 'pg') {
        const clauses: string[] = [];
        if (type) {
          const native = host.mapColumnType(type);
          clauses.push(`ALTER COLUMN ${q(name)} TYPE ${native} USING ${q(name)}::${native}`);
        }
        if (nullable !== undefined) clauses.push(`ALTER COLUMN ${q(name)} ${nullable ? 'DROP' : 'SET'} NOT NULL`);
        if (hasDefault) clauses.push(`ALTER COLUMN ${q(name)} SET DEFAULT ${host.formatDefaultValue(value)}`);
        if (dropDefault) clauses.push(`ALTER COLUMN ${q(name)} DROP DEFAULT`);
        return plan(change, [`ALTER TABLE ${q(table)} ${clauses.join(', ')}`], !!type, type ? name : undefined, warnings);
      }
      // MySQL MODIFY restates the whole column: unchanged parts come from the current definition.
      if (existing.primary) throw new ConsoleSchemaRefusal('unsupported', 'Change the primary key column with a SQL statement instead');
      const nativeType = type ? host.mapColumnType(type) : existing.nativeType;
      const keepNull = nullable ?? existing.nullable;
      const keepDefault = dropDefault ? undefined : hasDefault ? host.formatDefaultValue(value) : existing.defaultSql;
      warnings.push('mysql_modify_restates_column');
      const definition = [`${q(name)} ${nativeType}`, keepNull ? 'NULL' : 'NOT NULL', ...(keepDefault !== undefined ? [`DEFAULT ${keepDefault}`] : [])].join(' ');
      return plan(change, [`ALTER TABLE ${q(table)} MODIFY COLUMN ${definition}`], !!type, type ? name : undefined, warnings);
    }
    case 'create-index': {
      const name = newName(raw.name, 'Index name');
      if (current.indexes.some(index => index.name === name)) throw new ConsoleSchemaRefusal('invalid', `Index '${name}' already exists`);
      if (!Array.isArray(raw.columns) || !raw.columns.length || raw.columns.length > 16) throw new ConsoleSchemaRefusal('invalid', 'An index needs 1–16 columns');
      const columns = raw.columns.map(entry => existingName(entry, 'column'));
      for (const entry of columns) if (!column(entry)) throw new ConsoleSchemaRefusal('not_found', `Column '${entry}' not found`);
      const unique = raw.unique === true;
      const fields = columns.map(entry => {
        const text = dialect === 'mysql' && /text|blob|json/i.test(column(entry)!.nativeType);
        return q(entry) + (text ? '(128)' : '');
      }).join(', ');
      const change: DatabaseHostSchemaChange = Object.freeze({ kind: 'create-index', table, name, columns: Object.freeze(columns), ...(unique ? { unique } : {}) });
      return plan(change, [`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${q(name)} ON ${q(table)} (${fields})`], false, undefined, warnings);
    }
    case 'drop-index': {
      const name = existingName(raw.name, 'index');
      const index = current.indexes.find(entry => entry.name === name);
      if (!index) throw new ConsoleSchemaRefusal('not_found', `Index '${name}' not found`);
      if (index.primary || /^sqlite_autoindex_/i.test(name)) throw new ConsoleSchemaRefusal('unsupported', 'Primary key and constraint indexes cannot be dropped here');
      const change: DatabaseHostSchemaChange = Object.freeze({ kind: 'drop-index', table, name });
      return plan(change, [dialect === 'mysql' ? `DROP INDEX ${q(name)} ON ${q(table)}` : `DROP INDEX ${q(name)}`], true, name, warnings);
    }
    default:
      throw new ConsoleSchemaRefusal('invalid', 'Unknown schema change kind');
  }
}

function plan(change: DatabaseHostSchemaChange, statements: string[], destructive: boolean, confirm: string | undefined, warnings: string[]): DatabaseHostSchemaPlan {
  return Object.freeze({
    change,
    statements: Object.freeze(statements),
    destructive,
    ...(confirm ? { confirm } : {}),
    warnings: Object.freeze([...new Set(warnings)]),
  });
}

/** Zhin column type of a native SQL type (best effort, for filters and the schema form). */
export function zhinColumnType(native: string): string {
  const type = native.toLowerCase();
  if (/^(?:tinyint\(1\)|bool|boolean)/.test(type)) return 'boolean';
  if (/bigint|int8|bigserial/.test(type)) return 'bigint';
  if (/int|serial/.test(type)) return 'integer';
  if (/real|float|double|numeric|decimal/.test(type)) return 'float';
  if (/json/.test(type)) return 'json';
  if (/date|time/.test(type)) return 'date';
  if (/char|text|clob|string|uuid/.test(type) || !type) return 'text';
  return type;
}

/** Reads the physical columns and indexes of a table. */
export async function introspectConsoleTable(
  dialect: ConsoleSqlDialect,
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  table: string,
): Promise<DatabaseHostTableSchema> {
  const q = (name: string) => quoteConsoleIdentifier(dialect, name);
  const rows = async (sql: string, params?: unknown[]) => (await query(sql, params) as Record<string, unknown>[]) ?? [];
  if (dialect === 'sqlite') {
    const columns = (await rows(`PRAGMA table_info(${q(table)})`)).map(row => ({
      name: String(row.name),
      nativeType: String(row.type ?? ''),
      type: zhinColumnType(String(row.type ?? '')),
      nullable: Number(row.notnull) === 0 && Number(row.pk) === 0,
      primary: Number(row.pk) > 0,
      ...(row.dflt_value != null ? { defaultSql: String(row.dflt_value) } : {}),
    }));
    const indexes = [];
    for (const index of await rows(`PRAGMA index_list(${q(table)})`)) {
      const name = String(index.name);
      const info = await rows(`PRAGMA index_info(${q(name)})`);
      indexes.push({ name, columns: info.map(row => String(row.name)), unique: Number(index.unique) === 1, primary: index.origin === 'pk' });
    }
    return Object.freeze({ table, columns, indexes });
  }
  if (dialect === 'mysql') {
    const columns = (await rows(`SHOW COLUMNS FROM ${q(table)}`)).map(row => ({
      name: String(row.Field),
      nativeType: String(row.Type ?? ''),
      type: zhinColumnType(String(row.Type ?? '')),
      nullable: row.Null === 'YES',
      primary: row.Key === 'PRI',
      ...(row.Default != null ? { defaultSql: `'${String(row.Default).replaceAll('\'', '\'\'')}'` } : {}),
    }));
    const byName = new Map<string, { name: string; columns: string[]; unique: boolean; primary: boolean }>();
    for (const row of await rows(`SHOW INDEX FROM ${q(table)}`)) {
      const name = String(row.Key_name);
      const entry = byName.get(name) ?? { name, columns: [], unique: Number(row.Non_unique) === 0, primary: name === 'PRIMARY' };
      entry.columns.push(String(row.Column_name));
      byName.set(name, entry);
    }
    return Object.freeze({ table, columns, indexes: [...byName.values()] });
  }
  const primary = new Set((await rows(
    `SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = to_regclass($1) AND i.indisprimary`, [q(table)],
  )).map(row => String(row.name)));
  const columns = (await rows(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, [table],
  )).map(row => ({
    name: String(row.column_name),
    nativeType: String(row.data_type ?? ''),
    type: zhinColumnType(String(row.data_type ?? '')),
    nullable: row.is_nullable === 'YES',
    primary: primary.has(String(row.column_name)),
    ...(row.column_default != null ? { defaultSql: String(row.column_default) } : {}),
  }));
  const indexes = (await rows(
    'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1', [table],
  )).map(row => {
    const definition = String(row.indexdef ?? '');
    const list = /\(([^)]*)\)\s*$/.exec(definition)?.[1] ?? '';
    return {
      name: String(row.indexname),
      columns: list.split(',').map(part => part.trim().replace(/^"|"$/g, '').replaceAll('""', '"')).filter(Boolean),
      unique: /^CREATE UNIQUE/i.test(definition),
      primary: [...primary].length > 0 && /_pkey$/.test(String(row.indexname)),
    };
  });
  return Object.freeze({ table, columns, indexes });
}

/** Physical base tables of the current database / schema. */
export async function listPhysicalTables(
  dialect: ConsoleSqlDialect,
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
): Promise<string[]> {
  const sql = dialect === 'sqlite'
    ? 'SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name'
    : dialect === 'mysql'
      ? 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = \'BASE TABLE\' ORDER BY table_name'
      : 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = \'BASE TABLE\' ORDER BY table_name';
  return ((await query(sql)) as Record<string, unknown>[]).map(row => String(row.name ?? row.NAME ?? row.TABLE_NAME));
}
