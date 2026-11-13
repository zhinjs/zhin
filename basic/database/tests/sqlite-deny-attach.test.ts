import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Sqlite, SQLiteDialect, SqliteAttachRefusedError } from '../src/dialects/sqlite.js';

/**
 * ADR 0059 §2: the instance's SQLite connection refuses ATTACH, so raw SQL (plugins, the Console
 * SQL editor) cannot open `.zhin/gateway.db` beside the project database — also inside a
 * transaction whose caller swallows the error, and on the isolated read process.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Schema extends Record<string, object> {
  notes: { id: number; body: string };
}

async function open(denyAttach: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-deny-attach-'));
  dirs.push(dir);
  const secret = new Sqlite({ filename: join(dir, 'gateway.db') });
  await secret.start();
  await secret.query('CREATE TABLE console_users (id TEXT PRIMARY KEY, password_hash TEXT)');
  await secret.query("INSERT INTO console_users VALUES ('u1', 'scrypt$secret')");
  await secret.stop();
  const db = new Sqlite<Schema>({ filename: join(dir, 'data.sqlite'), denyAttach }, {
    notes: { id: { type: 'integer', primary: true }, body: { type: 'text' } },
  });
  await db.start();
  return { db, dir, gateway: join(dir, 'gateway.db') };
}

const schemas = async (db: Sqlite<Schema>) => ((await db.query('PRAGMA database_list')) as Array<{ name: string }>).map(row => row.name);

describe('SQLite denyAttach', () => {
  it('refuses a direct ATTACH and leaves no schema attached', async () => {
    const { db, gateway } = await open(true);
    try {
      await expect(db.query(`ATTACH DATABASE '${gateway}' AS g`)).rejects.toBeInstanceOf(SqliteAttachRefusedError);
      expect(await schemas(db)).toEqual(['main']);
      await expect(db.query('SELECT password_hash FROM g.console_users')).rejects.toThrow(/no such table/);
      // The connection stays usable.
      await db.query("INSERT INTO notes (id, body) VALUES (1, 'kept')");
      expect(await db.query('SELECT body FROM notes')).toEqual([{ body: 'kept' }]);
    } finally {
      await db.stop();
    }
  });

  it('rolls back and poisons a transaction whose caller swallowed the ATTACH error', async () => {
    const { db, gateway } = await open(true);
    try {
      let afterAttach: unknown;
      const result = db.transaction(async trx => {
        await trx.query("INSERT INTO notes (id, body) VALUES (2, 'inside')");
        await trx.query(`ATTACH DATABASE '${gateway}' AS g`).catch(() => undefined);
        afterAttach = await trx.query('SELECT password_hash FROM g.console_users').catch((error: unknown) => error);
        return 'swallowed';
      });
      // COMMIT is refused: the transaction was rolled back when the ATTACH was found.
      await expect(result).rejects.toBeInstanceOf(SqliteAttachRefusedError);
      expect(afterAttach).toBeInstanceOf(SqliteAttachRefusedError);
      expect(await schemas(db)).toEqual(['main']);
      expect(await db.query('SELECT body FROM notes')).toEqual([]);
      // Next transactions are not poisoned.
      await db.transaction(async trx => { await trx.query("INSERT INTO notes (id, body) VALUES (3, 'next')"); });
      expect(await db.query('SELECT body FROM notes')).toEqual([{ body: 'next' }]);
    } finally {
      await db.stop();
    }
  });

  it('refuses ATTACH through single statements of a transaction and on the isolated read process', async () => {
    const { db, gateway } = await open(true);
    try {
      await expect(db.transaction(trx => trx.queryStatement!(`ATTACH DATABASE '${gateway}' AS g`, { maxRows: 10 })))
        .rejects.toBeInstanceOf(SqliteAttachRefusedError);
      expect(await schemas(db)).toEqual(['main']);
      const dialect = (db as unknown as { dialect: SQLiteDialect }).dialect;
      await expect(dialect.queryReadOnlyIsolated(`ATTACH DATABASE '${gateway}' AS g`, { maxRows: 10, timeoutMs: 10_000 }))
        .rejects.toBeInstanceOf(SqliteAttachRefusedError);
      expect(await dialect.queryReadOnlyIsolated('SELECT 1 AS one', { maxRows: 10, timeoutMs: 10_000 })).toMatchObject({ rows: [{ one: 1 }] });
    } finally {
      await db.stop();
    }
  });

  it('allows ATTACH when off (the default)', async () => {
    const { db, gateway } = await open(false);
    try {
      await db.query(`ATTACH DATABASE '${gateway}' AS g`);
      expect(await db.query('SELECT id FROM g.console_users')).toEqual([{ id: 'u1' }]);
      await db.query('DETACH DATABASE g');
    } finally {
      await db.stop();
    }
  });

  it('backs a database up to an owner-only file', async () => {
    const { db, dir } = await open(true);
    try {
      await db.query("INSERT INTO notes (id, body) VALUES (9, 'backed up')");
      const dialect = (db as unknown as { dialect: SQLiteDialect }).dialect;
      const target = join(dir, 'backups', 'copy.sqlite');
      await dialect.backupTo(target);
      if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o600);
      await expect(dialect.backupTo(target)).rejects.toThrow(/already exists/);
      const copy = new Sqlite({ filename: target });
      await copy.start();
      expect(await copy.query('SELECT body FROM notes')).toEqual([{ body: 'backed up' }]);
      await copy.stop();
    } finally {
      await db.stop();
    }
  });
});
