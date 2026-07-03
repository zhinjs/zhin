import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RedisJobStore } from '../src/store/redis-store.js';
import { createSqliteStore } from '../src/store/sqlite-store.js';

const TMP = join(process.cwd(), 'tests', '.tmp');

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

function injectClient(store: RedisJobStore, memory: MemoryRedis): void {
  (store as unknown as { client: MemoryRedis | null }).client = memory;
}

const baseJob = {
  schemaVersion: 2 as const,
  resolved: { kind: 'solar' as const, cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
  handlerKey: 'daily',
  cancelled: false,
  updatedAt: '2024-09-23T00:00:00.000Z',
};

describe('RedisJobStore extra coverage', () => {
  it('sorts listDue and handles release edge cases', async () => {
    const store = new RedisJobStore();
    injectClient(store, new MemoryRedis());

    await store.upsert({
      ...baseJob,
      id: 'late',
      nextRunAt: '2024-09-23T03:00:00.000Z',
    });
    await store.upsert({
      ...baseJob,
      id: 'early',
      nextRunAt: '2024-09-23T01:00:00.000Z',
    });

    const due = await store.listDue(new Date('2024-09-23T04:00:00.000Z'));
    expect(due.map((job) => job.id)).toEqual(['early', 'late']);

    expect(await store.claim!('early', 'worker-a', 1000)).toBe(true);
    await store.release!('early', 'wrong-owner');
    expect(await store.claim!('early', 'worker-b', 1000)).toBe(false);
  });

  it('filters cancelled jobs from listDue results', async () => {
    const store = new RedisJobStore();
    injectClient(store, new MemoryRedis());

    await store.upsert({
      ...baseJob,
      id: 'ghost',
      nextRunAt: '2024-09-23T01:00:00.000Z',
      cancelled: true,
    });

    expect(await store.listDue(new Date('2024-09-23T04:00:00.000Z'))).toHaveLength(0);
  });
});

describe('SqliteJobStore extra coverage', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('persists to file path and reuses open connection', async () => {
    let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
    try {
      ({ DatabaseSync } = await import('node:sqlite'));
      new DatabaseSync(':memory:');
    } catch {
      return;
    }

    tmpDir = join(TMP, `sqlite-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const dbPath = join(tmpDir, 'nested', 'jobs.db');

    const store = createSqliteStore({ path: dbPath });
    await store.upsert({
      ...baseJob,
      id: 'file-1',
      nextRunAt: '2024-09-23T01:00:00.000Z',
    });
    await store.load();
    expect((await store.load()).map((job) => job.id)).toEqual(['file-1']);
  });
});
