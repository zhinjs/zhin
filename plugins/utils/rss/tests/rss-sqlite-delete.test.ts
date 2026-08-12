/**
 * Regression tests for the "no such column: id" bug: the real sqlite tables
 * defined in plugin.ts have no id column, so delete-by-id fails outside the
 * in-memory store. These tests back the RssModel interface with node:sqlite
 * (no id column) to reproduce the production shape.
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import removeCommand from '../commands/rss-remove/[url].ts';
import { RSS_SEEN_TABLE, RSS_SUBS_TABLE, resetRssDb, setRssDb, type RssModel } from '../src/db-store.js';
import type { RssRow } from '../src/memory-store.js';
import { cleanOldSeen } from '../src/poll.js';
import { SMOKE_CHANNEL } from '../src/channel.js';

const require = createRequire(import.meta.url);
let DatabaseSync: (new (filename: string) => any) | null = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // node:sqlite 需要 Node.js 22.5+，版本不足时跳过
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): void;
  };
  close(): void;
}

function createSqliteModel(db: SqliteDb, table: string): RssModel {
  const keys = (query: Record<string, unknown>) => Object.keys(query);
  const whereSql = (query: Record<string, unknown>) =>
    keys(query).map((k) => `${k} = ?`).join(' AND ');
  const params = (query: Record<string, unknown>) => keys(query).map((k) => query[k]);

  return {
    select: () => {
      const promise = Promise.resolve(
        db.prepare(`SELECT * FROM ${table}`).all() as RssRow[],
      );
      return {
        where: async (query) =>
          db.prepare(`SELECT * FROM ${table} WHERE ${whereSql(query)}`).all(...params(query)) as RssRow[],
        then: (onfulfilled, onrejected) => promise.then(onfulfilled, onrejected),
      };
    },
    insert: async (row) => {
      const cols = keys(row);
      db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ).run(...params(row));
      return row as RssRow;
    },
    delete: () => ({
      where: async (query) => {
        db.prepare(`DELETE FROM ${table} WHERE ${whereSql(query)}`).run(...params(query));
      },
    }),
    update: (patch) => ({
      where: async (query) => {
        const setSql = keys(patch).map((k) => `${k} = ?`).join(', ');
        db.prepare(`UPDATE ${table} SET ${setSql} WHERE ${whereSql(query)}`)
          .run(...params(patch), ...params(query));
      },
    }),
  };
}

function createSqliteRssDb() {
  const db = new DatabaseSync!(':memory:') as SqliteDb;
  // 与 plugin.ts defineRssTables 一致：没有 id 列。
  db.exec(`CREATE TABLE ${RSS_SUBS_TABLE} (
    url TEXT NOT NULL,
    feed_title TEXT DEFAULT '',
    adapter_name TEXT NOT NULL,
    endpoint_id TEXT DEFAULT '',
    channel_type TEXT DEFAULT 'private',
    channel_id TEXT NOT NULL,
    creator_id TEXT DEFAULT '',
    creator_name TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  )`);
  db.exec(`CREATE TABLE ${RSS_SEEN_TABLE} (
    feed_url TEXT NOT NULL,
    item_guid TEXT NOT NULL,
    item_title TEXT DEFAULT '',
    seen_at TEXT DEFAULT ''
  )`);
  const models = new Map<string, RssModel>([
    [RSS_SUBS_TABLE, createSqliteModel(db, RSS_SUBS_TABLE)],
    [RSS_SEEN_TABLE, createSqliteModel(db, RSS_SEEN_TABLE)],
  ]);
  return { db, store: { models: { get: (name: string) => models.get(name) } } };
}

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => {
    throw new Error('unused');
  },
  args: [],
  params: {},
  input: undefined,
};

describe.skipIf(!DatabaseSync)('rss against real sqlite (no id column)', () => {
  afterEach(() => {
    resetRssDb();
  });

  it('rss-remove deletes by business keys, not id', async () => {
    const { db, store } = createSqliteRssDb();
    try {
      setRssDb(store);
      const Subs = store.models.get(RSS_SUBS_TABLE)!;
      await Subs.insert({
        url: 'https://example.com/feed.xml',
        feed_title: 'Example',
        adapter_name: SMOKE_CHANNEL.adapterName,
        endpoint_id: SMOKE_CHANNEL.endpointKey,
        channel_type: SMOKE_CHANNEL.channelType,
        channel_id: SMOKE_CHANNEL.channelId,
        creator_id: '',
        creator_name: '',
        created_at: new Date().toISOString(),
      });

      const result = await removeCommand.execute({
        ...emptyCtx,
        params: { url: 'https://example.com/feed.xml' },
      });
      expect(String(result)).toContain('已取消订阅');
      expect(await Subs.select().where({ url: 'https://example.com/feed.xml' })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('cleanOldSeen deletes expired rows by feed_url + item_guid', async () => {
    const { db, store } = createSqliteRssDb();
    try {
      setRssDb(store);
      const Seen = store.models.get(RSS_SEEN_TABLE)!;
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fresh = new Date().toISOString();
      await Seen.insert({ feed_url: 'https://a.com/f', item_guid: 'old-1', item_title: 't', seen_at: old });
      await Seen.insert({ feed_url: 'https://a.com/f', item_guid: 'new-1', item_title: 't', seen_at: fresh });

      await cleanOldSeen();

      const remaining = await Seen.select();
      expect(remaining.map((r) => r.item_guid)).toEqual(['new-1']);
    } finally {
      db.close();
    }
  });
});
