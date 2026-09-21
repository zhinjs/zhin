import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDB } from '../src/dialects/mongodb.js';
import { MySQL } from '../src/dialects/mysql.js';
import { PG } from '../src/dialects/pg.js';
import { Redis } from '../src/dialects/redis.js';

const live = process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1';

interface RelationalSchema extends Record<string, object> {
  zhin_live_users: {
    id: number;
    name: string;
    active: boolean;
  };
}

const relationalDefinition = {
  zhin_live_users: {
    id: { type: 'integer', primary: true, nullable: false },
    name: { type: 'text', nullable: false },
    active: { type: 'boolean', nullable: false },
  },
} as const;

interface DocumentSchema extends Record<string, object> {
  zhin_live_users: {
    id: number;
    name: string;
    active: boolean;
  };
}

interface KeyValueSchema extends Record<string, object> {
  zhin_live_cache: {
    value: string;
  };
}

describe.skipIf(!live)('live database dialects', () => {
  describe.each([
    {
      name: 'mysql',
      create: () => new MySQL<RelationalSchema>({
        host: process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306),
        user: process.env.ZHIN_TEST_MYSQL_USER ?? 'zhin',
        password: process.env.ZHIN_TEST_MYSQL_PASSWORD ?? 'zhin',
        database: process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test',
      }, relationalDefinition),
    },
    {
      name: 'mysql pool',
      create: () => new MySQL<RelationalSchema>({
        host: process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306),
        user: process.env.ZHIN_TEST_MYSQL_USER ?? 'zhin',
        password: process.env.ZHIN_TEST_MYSQL_PASSWORD ?? 'zhin',
        database: process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test',
        pool: { max: 2 },
      }, relationalDefinition),
    },
    {
      name: 'postgresql',
      create: () => new PG<RelationalSchema>({
        host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
        port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
        user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
        password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
        database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
      }, relationalDefinition),
    },
    {
      name: 'postgresql pool',
      create: () => new PG<RelationalSchema>({
        host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
        port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
        user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
        password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
        database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
        pool: { min: 1, max: 2 },
      }, relationalDefinition),
    },
  ])('$name', ({ create }) => {
    const db = create();

    beforeAll(async () => {
      await db.start();
      await db.query('DELETE FROM zhin_live_users');
    });

    afterAll(async () => {
      if (db.isStarted) {
        await db.query('DROP TABLE IF EXISTS zhin_live_users');
        await db.stop();
      }
    });

    it('runs CRUD and rolls back a transaction', async () => {
      const users = db.model('zhin_live_users');
      await users.insert({ id: 1, name: 'first', active: true });
      await users.insertMany([
        { id: 2, name: 'second', active: true },
        { id: 3, name: 'third', active: false },
      ]);

      expect(await users.select().orderBy('id')).toEqual([
        { id: 1, name: 'first', active: true },
        { id: 2, name: 'second', active: true },
        { id: 3, name: 'third', active: false },
      ]);

      await users.update({ active: false }).where({ id: 2 });
      expect(await users.select().where({ id: 2 })).toEqual([
        { id: 2, name: 'second', active: false },
      ]);

      await expect(db.transaction(async (trx) => {
        await trx.insert('zhin_live_users', { id: 4, name: 'rolled-back', active: true });
        throw new Error('rollback');
      })).rejects.toThrow('rollback');
      expect(await users.select().where({ id: 4 })).toEqual([]);

      await users.delete({ id: 3 });
      expect(await users.select().where({ id: 3 })).toEqual([]);
      expect(await db.healthCheck()).toBe(true);
    });
  });

  describe('mongodb', () => {
    const db = new MongoDB<DocumentSchema>({
      url: process.env.ZHIN_TEST_MONGODB_URL ?? 'mongodb://127.0.0.1:37017',
      dbName: process.env.ZHIN_TEST_MONGODB_DATABASE ?? 'zhin_test',
    }, {
      zhin_live_users: {
        id: { type: 'integer' },
        name: { type: 'text' },
        active: { type: 'boolean' },
      },
    });

    beforeAll(async () => {
      await db.start();
      await db.delete('zhin_live_users', {});
    });

    afterAll(async () => {
      if (db.isStarted) {
        await db.query({ collection: 'zhin_live_users', operation: 'dropCollection', filter: {} });
        await db.stop();
      }
    });

    it('runs document CRUD through the model API', async () => {
      const users = db.model('zhin_live_users');
      const created = await users.create({ id: 1, name: 'first', active: true });
      expect(await users.selectById(created._id)).toMatchObject({
        _id: created._id,
        id: 1,
        name: 'first',
        active: true,
      });

      await users.updateById(created._id, { active: false });
      expect(await users.select().where({ _id: created._id } as never)).toEqual([
        { _id: created._id, id: 1, name: 'first', active: false },
      ]);

      await users.deleteById(created._id);
      expect(await users.selectById(created._id)).toBeNull();
      expect(await db.healthCheck()).toBe(true);
    });
  });

  describe('redis', () => {
    const db = new Redis<KeyValueSchema>({
      url: process.env.ZHIN_TEST_REDIS_URL ?? 'redis://127.0.0.1:36379',
    }, {
      zhin_live_cache: {
        value: { type: 'text' },
      },
    });

    beforeAll(async () => {
      await db.start();
      await db.model('zhin_live_cache').clear();
    });

    afterAll(async () => {
      if (db.isStarted) {
        await db.model('zhin_live_cache').clear();
        await db.stop();
      }
    });

    it('runs key-value operations with native Redis semantics', async () => {
      const cache = db.model('zhin_live_cache');
      await cache.set('session:1', { value: 'one' });
      expect(await cache.get('session:1')).toEqual({ value: 'one' });
      expect(await cache.has('session:1')).toBe(true);
      expect(await cache.has('missing')).toBe(false);

      await cache.setMany([
        ['session:2', { value: 'two' }],
        ['other:1', { value: 'three' }],
      ]);
      expect((await cache.keys()).sort()).toEqual(['other:1', 'session:1', 'session:2']);
      expect(await cache.keysByPattern('session:*')).toEqual(expect.arrayContaining(['session:1', 'session:2']));
      expect(await cache.size()).toBe(3);
      expect(await cache.entries()).toEqual(expect.arrayContaining([
        ['session:1', { value: 'one' }],
        ['session:2', { value: 'two' }],
      ]));

      expect(await cache.expire('session:1', 60)).toBe(true);
      expect(await cache.ttl('session:1')).toBeGreaterThan(0);
      expect(await cache.persist('session:1')).toBe(true);
      expect(await cache.ttl('session:1')).toBe(-1);
      expect(await cache.deleteByKey('session:1')).toBe(true);
      expect(await cache.get('session:1')).toBeNull();
      expect(await db.healthCheck()).toBe(true);
    });
  });
});
