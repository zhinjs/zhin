import { describe, expect, it } from 'vitest';
import { createRedisStore, RedisJobStore } from '../src/store/redis-store.js';

class MemoryRedis {
  private strings = new Map<string, string>();
  private hash = new Map<string, Map<string, string>>();
  private zset = new Map<string, Map<string, number>>();

  async hkeys(key: string): Promise<string[]> {
    return [...(this.hash.get(key)?.keys() ?? [])];
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const map = this.hash.get(key);
    return fields.map((field) => map?.get(field) ?? null);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.hash.has(key)) {
      this.hash.set(key, new Map());
    }
    this.hash.get(key)!.set(field, value);
    return 1;
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.hash.get(key)?.delete(field) ? 1 : 0;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.zset.has(key)) {
      this.zset.set(key, new Map());
    }
    this.zset.get(key)!.set(member, score);
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.zset.get(key)?.delete(member) ? 1 : 0;
  }

  async zrangebyscore(
    key: string,
    _min: number,
    max: number,
    ...args: Array<string | number>
  ): Promise<string[]> {
    const limitIndex = args.indexOf('LIMIT');
    const limit = limitIndex >= 0 ? Number(args[limitIndex + 2]) : Infinity;
    return [...(this.zset.get(key)?.entries() ?? [])]
      .filter(([, score]) => score <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([member]) => member);
  }

  async set(key: string, value: string, ...args: string[]): Promise<string | null> {
    const nx = args.includes('NX');
    if (nx && this.strings.has(key)) {
      return null;
    }
    this.strings.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.strings.delete(key) ? 1 : 0;
  }

  async eval(_script: string, _numKeys: number, key: string, owner: string): Promise<number> {
    if (this.strings.get(key) === owner) {
      this.strings.delete(key);
      return 1;
    }
    return 0;
  }

  async quit(): Promise<void> {
    return;
  }
}

function patchStore(store: RedisJobStore, memory: MemoryRedis): void {
  (store as unknown as { getClient: () => Promise<MemoryRedis> }).getClient = async () => memory;
}

function injectClient(store: RedisJobStore, memory: MemoryRedis): void {
  (store as unknown as { client: MemoryRedis | null }).client = memory;
}

describe('RedisJobStore with in-memory client', () => {
  it('creates store via factory with custom options', () => {
    expect(createRedisStore({ keyPrefix: 'custom:' })).toBeInstanceOf(RedisJobStore);
  });

  it('upserts, loads, lists due, removes and manages claims', async () => {
    const store = new RedisJobStore();
    const memory = new MemoryRedis();
    patchStore(store, memory);

    const job = {
      schemaVersion: 2,
      id: 'redis-1',
      resolved: { kind: 'solar' as const, cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      handlerKey: 'daily',
      nextRunAt: '2024-09-23T01:00:00.000Z',
      cancelled: false,
      updatedAt: '2024-09-23T00:00:00.000Z',
    };

    await store.upsert(job);
    expect((await store.load()).map((item) => item.id)).toEqual(['redis-1']);

    const due = await store.listDue(new Date('2024-09-23T02:00:00.000Z'));
    expect(due).toHaveLength(1);

    expect(await store.claim!('redis-1', 'worker-a', 1000)).toBe(true);
    expect(await store.claim!('redis-1', 'worker-b', 1000)).toBe(false);
    await store.release!('redis-1', 'worker-a');
    expect(await store.claim!('redis-1', 'worker-b', 1000)).toBe(true);

    await store.upsert({ ...job, cancelled: true, nextRunAt: null });
    expect(await store.listDue(new Date('2024-09-23T02:00:00.000Z'))).toHaveLength(0);

    await store.remove('redis-1');
    expect(await store.load()).toHaveLength(0);
  });

  it('reuses cached client and disconnect clears connection', async () => {
    const store = new RedisJobStore({ url: 'redis://custom:6379', keyPrefix: 'app:' });
    const memory = new MemoryRedis();
    injectClient(store, memory);

    await store.load();
    await store.load();

    await store.disconnect();
    await store.disconnect();
  });

  it('skips missing hash values and handles null nextRunAt upsert', async () => {
    class BrokenRedis extends MemoryRedis {
      async hkeys(): Promise<string[]> {
        return ['ghost'];
      }
      async hmget(): Promise<(string | null)[]> {
        return [null];
      }
    }

    const store = new RedisJobStore();
    injectClient(store, new BrokenRedis());
    expect(await store.load()).toEqual([]);
    expect(await store.listDue(new Date())).toEqual([]);

    injectClient(store, new MemoryRedis());
    await store.upsert({
      schemaVersion: 2,
      id: 'no-run',
      resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      handlerKey: 'daily',
      nextRunAt: null,
      cancelled: false,
      updatedAt: '2024-09-23T00:00:00.000Z',
    });
    expect(await store.listDue(new Date('2024-09-23T04:00:00.000Z'))).toHaveLength(0);
  });

  it('claim returns false when lock already held', async () => {
    const store = new RedisJobStore();
    injectClient(store, new MemoryRedis());
    expect(await store.claim!('job-1', 'a', 1000)).toBe(true);
    expect(await store.claim!('job-1', 'b', 1000)).toBe(false);
  });
});
