import { Registry } from '../src/registry.js';
import { Sqlite, SQLiteDialect } from '../src/dialects/sqlite.js';
import { PostgreSQLDialect } from '../src/dialects/pg.js';
import { MySQLDialect } from '../src/dialects/mysql.js';

Registry.register('sqlite', Sqlite);

describe('identifier quoting', () => {
  it('doubles the quote character so an identifier cannot close its quotes', () => {
    expect(new SQLiteDialect({ filename: ':memory:' }).quoteIdentifier('a"b')).toBe('"a""b"');
    expect(new PostgreSQLDialect({} as never).quoteIdentifier('a"b')).toBe('"a""b"');
    expect(new MySQLDialect({} as never).quoteIdentifier('a`b')).toBe('`a``b`');
  });

  it('keeps a crafted condition key inside the identifier (no subquery against another table)', async () => {
    const db = Registry.create<{ notes: { id: number; body: string }; secrets: { hash: string } }, 'sqlite'>('sqlite', { filename: ':memory:' });
    await db.start();
    try {
      await db.query('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
      await db.query('CREATE TABLE secrets (hash TEXT)');
      await db.query("INSERT INTO notes (id, body) VALUES (1, 'public')");
      await db.query("INSERT INTO secrets (hash) VALUES ('s3cret')");
      const key = 'id" = 1 OR (SELECT hash FROM secrets) = \'s3cret\' OR "id';
      const query = db.select('notes', ['id', 'body']).where({ [key]: 1 } as never);
      await expect(Promise.resolve(query)).rejects.toThrow(/no such column/i);
    } finally {
      await db.stop();
    }
  });
});
