import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childPluginId, rootPluginId, PluginDatabaseHost, createDeliveryTarget } from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { createDatabaseState, type StateDatabase } from '../../src/plugin-runtime/database-state.js';

const ownerA = childPluginId(rootPluginId(), 'reminder');
const ownerB = childPluginId(rootPluginId(), 'welcome');
const target = createDeliveryTarget({ conversation: { endpoint: { adapter: 'root/icqq', id: 'root/icqq\0adapter\0main' },
  kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' } });

describe('plugin persistent state', () => {
  it('atomically increments across independent database connections and plugin instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-state-'));
    const config = { dialect: 'sqlite', filename: join(dir, 'state.sqlite') } as const;
    const dbA = createDatabaseHost(config);
    const dbB = createDatabaseHost(config);
    try {
      await dbA.start();
      await dbB.start();
      const reminder = new PluginDatabaseHost(ownerA, dbA).state;
      const reminderSecondProcess = new PluginDatabaseHost(ownerA, dbB).state;
      const welcome = new PluginDatabaseHost(ownerB, dbB).state;
      await Promise.all(Array.from({ length: 30 }, (_, i) =>
        (i % 2 ? reminder : reminderSecondProcess).update<number>('count', (current) => (current ?? 0) + 1)));
      expect(await reminder.get('count')).toBe(30);
      expect(await welcome.get('count')).toBeUndefined();
      await welcome.set('count', 5);
      expect(await reminderSecondProcess.get('count')).toBe(30);
      expect(await welcome.get('count')).toBe(5);
      // New generation facade retains only the durable owner key, not old closures.
      const reloaded = new PluginDatabaseHost(ownerA, dbB).state;
      expect(await reloaded.get('count')).toBe(30);
    } finally {
      await dbA.stop();
      await dbB.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('isolates users, exact endpoints, parent channels and threads, and survives restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-state-scope-'));
    const config = { dialect: 'sqlite', filename: join(dir, 'state.sqlite') } as const;
    let db = createDatabaseHost(config);
    try {
      await db.start();
      const store = new PluginDatabaseHost(ownerA, db).state;
      const alice = store.forUser(target.endpoint, 'alice');
      const bob = store.forUser(target.endpoint, 'bob');
      await Promise.all([alice.set('preferences', { enabled: true }), bob.set('preferences', { enabled: false })]);
      await store.forConversation(target).set('subscription', { url: 'https://example.org/feed' });
      expect(await alice.get('preferences')).toEqual({ enabled: true });
      expect(await bob.get('preferences')).toEqual({ enabled: false });
      expect(await store.forUser({ ...target.endpoint, id: 'another-bot' }, 'alice').get('preferences')).toBeUndefined();
      expect(await store.forConversation({ ...target, threadId: 'another-topic' }).get('subscription')).toBeUndefined();
      expect(await store.forConversation({ ...target, parent: { kind: 'channel', id: 'another-guild' } }).get('subscription')).toBeUndefined();
      await db.stop();
      db = createDatabaseHost(config);
      await db.start();
      const reopened = new PluginDatabaseHost(ownerA, db).state;
      expect(await reopened.forUser(target.endpoint, 'alice').get('preferences')).toEqual({ enabled: true });
      expect(await reopened.forConversation(JSON.parse(JSON.stringify(target))).get('subscription')).toEqual({ url: 'https://example.org/feed' });
    } finally {
      await db.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('expires values and atomically replaces expired rows; supports deletion and detached copies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-state-ttl-'));
    const db = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 'state.sqlite') });
    try {
      await db.start();
      const store = new PluginDatabaseHost(ownerA, db).state;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
      try {
        const value = { nested: { count: 1 } };
        await store.set('value', value, { ttlMs: 100 });
        value.nested.count = 99;
        expect(await store.get('value')).toEqual({ nested: { count: 1 } });
        clock.mockReturnValue(1100);
        expect(await store.get('value')).toBeUndefined();
        const updated = await store.update('value', (current) => {
          expect(current).toBeUndefined();
          return { replaced: true };
        });
        expect(updated).toEqual({ replaced: true });
        await store.delete('value');
        expect(await store.get('value')).toBeUndefined();
        await expect(store.set('invalid', NaN)).rejects.toThrow('JSON-safe');
        await expect(store.set('invalid', 1, { ttlMs: 0 })).rejects.toThrow('ttlMs');
      } finally { clock.mockRestore(); }
    } finally {
      await db.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects absent, stopped or unsupported persistence rather than claiming to save', async () => {
    const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
    await expect(new PluginDatabaseHost(ownerA, db).state.get('key')).rejects.toThrow('not connected');
    const noState = { ...db, state: undefined };
    expect(() => new PluginDatabaseHost(ownerA, noState).state).toThrow('configured database');
    const fake: StateDatabase = { define: vi.fn(), buildQuery: vi.fn(), query: vi.fn() };
    const unsupported = createDatabaseState(fake, 'redis', () => true);
    await expect(unsupported.read(ownerA, { kind: 'plugin' }, 'key')).rejects.toThrow("dialect 'redis'");
    expect(fake.define).not.toHaveBeenCalled();
  });

  it('uses PostgreSQL RETURNING for update/delete CAS and only retries unique insertion conflicts', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'key' }]);
    const fake: StateDatabase = { define: vi.fn(), buildQuery: vi.fn().mockReturnValue({ query: 'UPDATE state SET value=$1', params: ['v'] }), query };
    const port = createDatabaseState(fake, 'pg', () => true);
    expect(await port.compareExchange(ownerA, { kind: 'plugin' }, 'key', 'revision', 1, null)).toBe(true);
    expect(query).toHaveBeenLastCalledWith('UPDATE state SET value=$1 RETURNING "id"', ['v']);
    query.mockResolvedValueOnce([]);
    expect(await port.compareExchange(ownerA, { kind: 'plugin' }, 'key', 'revision', undefined, null)).toBe(false);
    query.mockRejectedValueOnce({ code: '23505' });
    expect(await port.compareExchange(ownerA, { kind: 'plugin' }, 'key', undefined, 1, null)).toBe(false);
    query.mockRejectedValueOnce(new Error('connection lost'));
    await expect(port.compareExchange(ownerA, { kind: 'plugin' }, 'key', undefined, 1, null)).rejects.toThrow('connection lost');
  });
});
