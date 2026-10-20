import { describe, expect, it } from 'vitest';
import { createSqliteStore } from '../src/store/sqlite-store.js';

describe('SqliteJobStore', () => {
  it('creates store factory', () => {
    expect(createSqliteStore({ path: ':memory:' })).toBeDefined();
  });

  it('loads and persists jobs with node:sqlite', async () => {
    let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
    try {
      ({ DatabaseSync } = await import('node:sqlite'));
      new DatabaseSync(':memory:');
    } catch {
      return;
    }

    const store = createSqliteStore({ path: ':memory:' });
    const job = {
      schemaVersion: 2,
      id: 'sqlite-1',
      resolved: { kind: 'solar' as const, cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      handlerKey: 'daily',
      nextRunAt: '2024-09-23T01:00:00.000Z',
      cancelled: false,
      updatedAt: '2024-09-23T00:00:00.000Z',
    };

    await store.upsert(job);
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('sqlite-1');

    const due = await store.listDue(new Date('2024-09-23T02:00:00.000Z'));
    expect(due).toHaveLength(1);

    await store.remove('sqlite-1');
    expect(await store.load()).toHaveLength(0);
  });
});
