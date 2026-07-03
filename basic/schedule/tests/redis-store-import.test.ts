import { describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => {
  throw new Error('Cannot find module ioredis');
});

describe('RedisJobStore ioredis import', () => {
  it('throws install message when ioredis is unavailable', async () => {
    const { RedisJobStore } = await import('../src/store/redis-store.js');
    const store = new RedisJobStore();
    await expect(store.load()).rejects.toThrow(/ioredis is required/);
  });
});
