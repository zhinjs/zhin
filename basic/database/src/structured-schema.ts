import type { Database } from './base/database.js';
export type StructuredDatabase = Database<unknown, Record<string, Record<string, unknown>>, string>;
import type { Column } from './types.js';

/** Explicit additive migrations for a declared table; never removes old columns/data. */
export async function ensureDatabaseColumns(database: StructuredDatabase, table: string, columns: Record<string, Column>): Promise<void> {
  const dialect = database.dialectName;
  if (!['sqlite', 'mysql', 'pg'].includes(dialect)) return;
  const quote = (name: string) => dialect === 'mysql' ? `\`${name.replaceAll('`', '``')}\`` : `"${name.replaceAll('"', '""')}"`;
  const rows: Record<string, unknown>[] = dialect === 'sqlite'
    ? await database.query(`PRAGMA table_info(${quote(table)})`)
    : dialect === 'mysql' ? await database.query(`SHOW COLUMNS FROM ${quote(table)}`)
      : await database.query('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table]);
  if (!rows.length) throw new Error(`Cannot migrate missing table '${table}'`);
  const existing = new Set(rows.map(row => String(row.name ?? row.Field ?? row.column_name)));
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) await database.alter(table, { [name]: { action: 'add', ...definition } });
  }
}

/** Index migration with exact identifier quoting; MySQL TEXT needs a bounded prefix. */
export async function ensureDatabaseIndex(database: StructuredDatabase, table: string, name: string, columns: readonly { name: string; text?: boolean }[]): Promise<void> {
  const dialect = database.dialectName;
  if (!['sqlite', 'mysql', 'pg'].includes(dialect)) return;
  const quote = (value: string) => dialect === 'mysql' ? `\`${value.replaceAll('`', '``')}\`` : `"${value.replaceAll('"', '""')}"`;
  if (dialect === 'mysql') {
    const rows = await database.query<Record<string, unknown>[]>(`SHOW INDEX FROM ${quote(table)} WHERE Key_name = ?`, [name]);
    if (rows.length) return;
  }
  const fields = columns.map(column => quote(column.name) + (dialect === 'mysql' && column.text ? '(128)' : '')).join(', ');
  await database.query(`CREATE INDEX ${dialect === 'mysql' ? '' : 'IF NOT EXISTS '}${quote(name)} ON ${quote(table)} (${fields})`);
}
