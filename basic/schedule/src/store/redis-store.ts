import type { JobStore, StoredJob } from './types.js';
import { migrateStoredJob } from './migrate.js';

export interface RedisStoreOptions {
  url?: string;
  keyPrefix?: string;
}

type RedisClient = import('ioredis').default;

export class RedisJobStore implements JobStore {
  private readonly url: string;
  private readonly prefix: string;
  private client: RedisClient | null = null;

  constructor(options: RedisStoreOptions = {}) {
    this.url = options.url ?? 'redis://127.0.0.1:6379';
    this.prefix = options.keyPrefix ?? 'cn-calendar-schedule:';
  }

  private jobsKey(): string {
    return `${this.prefix}jobs`;
  }

  private dueKey(): string {
    return `${this.prefix}due`;
  }

  private claimKey(id: string): string {
    return `${this.prefix}claim:${id}`;
  }

  private async getClient(): Promise<RedisClient> {
    if (this.client) {
      return this.client;
    }
    let Redis: typeof import('ioredis').default;
    try {
      Redis = (await import('ioredis')).default;
    } catch {
      throw new Error('ioredis is required for Redis store. Install: npm install ioredis');
    }
    this.client = new Redis(this.url, { maxRetriesPerRequest: 1 });
    return this.client;
  }

  async load(): Promise<StoredJob[]> {
    const client = await this.getClient();
    const ids = await client.hkeys(this.jobsKey());
    if (ids.length === 0) {
      return [];
    }
    const values = await client.hmget(this.jobsKey(), ...ids);
    const jobs: StoredJob[] = [];
    for (const raw of values) {
      if (raw) {
        jobs.push(migrateStoredJob(JSON.parse(raw) as StoredJob));
      }
    }
    return jobs;
  }

  async upsert(job: StoredJob): Promise<void> {
    const client = await this.getClient();
    const body = JSON.stringify(job);
    await client.hset(this.jobsKey(), job.id, body);
    if (job.cancelled || job.nextRunAt == null) {
      await client.zrem(this.dueKey(), job.id);
      return;
    }
    await client.zadd(this.dueKey(), new Date(job.nextRunAt).getTime(), job.id);
  }

  async remove(id: string): Promise<void> {
    const client = await this.getClient();
    await client.hdel(this.jobsKey(), id);
    await client.zrem(this.dueKey(), id);
    await client.del(this.claimKey(id));
  }

  async listDue(before: Date, limit = 100): Promise<StoredJob[]> {
    const client = await this.getClient();
    const ids = await client.zrangebyscore(this.dueKey(), 0, before.getTime(), 'LIMIT', 0, limit);
    if (ids.length === 0) {
      return [];
    }
    const values = await client.hmget(this.jobsKey(), ...ids);
    const jobs: StoredJob[] = [];
    for (const raw of values) {
      if (raw) {
        const job = migrateStoredJob(JSON.parse(raw) as StoredJob);
        if (!job.cancelled && job.nextRunAt != null) {
          jobs.push(job);
        }
      }
    }
    return jobs.sort(
      (a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime(),
    );
  }

  async claim(id: string, owner: string, ttlMs: number): Promise<boolean> {
    const client = await this.getClient();
    const result = await client.set(this.claimKey(id), owner, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async release(id: string, owner: string): Promise<void> {
    const client = await this.getClient();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await client.eval(script, 1, this.claimKey(id), owner);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

export function createRedisStore(options?: RedisStoreOptions): RedisJobStore {
  return new RedisJobStore(options);
}
