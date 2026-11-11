import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLiteDialect, isSqliteBusyError } from '../src/dialects/sqlite.js';

// Two connections on one WAL file, as the gateway (console_* tables) and the instance (the rest)
// hold the project database (ADR 0054 §7): the instance's connection has no busy_timeout and
// must not surface SQLITE_BUSY while the gateway holds its short write lock.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const dirs: string[] = [];
const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(config: { busyRetryMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'zhin-sqlite-busy-'));
  dirs.push(dir);
  const filename = join(dir, 'data.sqlite');
  const instance = new SQLiteDialect({ filename, ...config });
  await instance.connect();
  closers.push(() => instance.disconnect());
  await instance.query('CREATE TABLE IF NOT EXISTS bot_state (id INTEGER PRIMARY KEY, value TEXT)');
  await instance.query('CREATE TABLE IF NOT EXISTS console_audit (id INTEGER PRIMARY KEY, action TEXT)');
  // Gateway-style writer: its own connection, WAL, a busy timeout (it waits synchronously).
  const gateway = new DatabaseSync(filename);
  closers.push(() => gateway.close());
  gateway.exec('PRAGMA busy_timeout = 2000');
  gateway.exec('PRAGMA journal_mode = WAL');
  return { instance, gateway };
}

/** Holds the gateway's write lock for `ms`, then commits. */
function holdWriteLock(gateway: InstanceType<typeof DatabaseSync>, ms: number): Promise<void> {
  gateway.exec('BEGIN IMMEDIATE');
  gateway.prepare('INSERT INTO console_audit (action) VALUES (?)').run('login');
  return new Promise((resolve) => setTimeout(() => { gateway.exec('COMMIT'); resolve(); }, ms));
}

describe('SQLite dialect: SQLITE_BUSY from another connection', () => {
  it('retries the instance write asynchronously while the gateway holds a write transaction', async () => {
    const { instance, gateway } = await setup();
    const released = holdWriteLock(gateway, 80);
    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 5);
    try {
      // Autocommit statements and a whole transaction both wait for the lock without throwing.
      const insert = instance.query('INSERT INTO bot_state (id, value) VALUES (?, ?)', [1, 'a']);
      const update = instance.query('UPDATE bot_state SET value = ? WHERE id = ?', ['b', 1]);
      await Promise.all([insert, update, released]);
      const tx = await (async () => {
        const second = holdWriteLock(gateway, 40);
        const transaction = await instance.beginTransaction();
        await transaction.query('INSERT INTO bot_state (id, value) VALUES (?, ?)', [2, 'c']);
        await transaction.commit();
        await second;
      })();
      expect(tx).toBeUndefined();
    } finally {
      clearInterval(ticker);
    }
    // The wait was asynchronous: the event loop kept running.
    expect(ticks).toBeGreaterThan(3);
    expect(await instance.query('SELECT id, value FROM bot_state ORDER BY id')).toEqual([
      { id: 1, value: 'b' },
      { id: 2, value: 'c' },
    ]);
    expect(gateway.prepare('SELECT COUNT(*) AS n FROM console_audit').get()).toEqual({ n: 2 });
  });

  it('surfaces SQLITE_BUSY without the retry (the contention is real)', async () => {
    const { instance, gateway } = await setup({ busyRetryMs: 0 });
    const released = holdWriteLock(gateway, 30);
    const error = await instance.query('INSERT INTO bot_state (id, value) VALUES (1, ?)', ['a']).catch((caught: unknown) => caught);
    await released;
    expect(isSqliteBusyError(error)).toBe(true);
  });

  it('gives up after the retry budget', async () => {
    const { instance, gateway } = await setup({ busyRetryMs: 30 });
    const released = holdWriteLock(gateway, 200);
    const error = await instance.query('INSERT INTO bot_state (id, value) VALUES (1, ?)', ['a']).catch((caught: unknown) => caught);
    await released;
    expect(isSqliteBusyError(error)).toBe(true);
  });
});
