import { randomUUID } from 'node:crypto';
import { childPluginId, rootPluginId, PluginDatabaseHost, createDeliveryTarget } from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import type { DatabaseHostConfig } from '../../src/plugin-runtime/database-config.js';

describe.skipIf(process.env.ZHIN_TEST_EXTERNAL_DATABASES !== '1')('persistent state database CAS', () => {
  it.each(['pg', 'mysql'] as const)('persists atomically across two independent %s connections', async (dialect) => {
    const config: DatabaseHostConfig = dialect === 'pg' ? {
      dialect, host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
      port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
      user: process.env.ZHIN_TEST_PG_USER ?? 'zhin', password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
      database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
      pool: { max: 2 },
    } : {
      dialect, host: process.env.ZHIN_TEST_MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.ZHIN_TEST_MYSQL_PORT ?? 33306),
      user: process.env.ZHIN_TEST_MYSQL_USER ?? 'zhin', password: process.env.ZHIN_TEST_MYSQL_PASSWORD ?? 'zhin',
      database: process.env.ZHIN_TEST_MYSQL_DATABASE ?? 'zhin_test',
      pool: { max: 2 },
    };
    const first = createDatabaseHost(config);
    const second = createDatabaseHost(config);
    const owner = childPluginId(rootPluginId(), 'state-fixture');
    const key = randomUUID();
    const target = createDeliveryTarget({ conversation: {
      endpoint: { adapter: 'root/icqq', id: 'root/icqq\0adapter\0main' }, kind: 'channel',
      id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'thread',
    } });
    const a = new PluginDatabaseHost(owner, first).state.forConversation(target);
    const b = new PluginDatabaseHost(owner, second).state.forConversation(target);
    try {
      await first.start();
      await second.start();
      await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b)
        .update<number>(key, (count) => (count ?? 0) + 1)));
      expect(await a.get(key)).toBe(20);
      await a.set(`${key}-target`, target);
      expect(await b.get(`${key}-target`)).toEqual(target);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
      try {
        await a.set(`${key}-ttl`, 'expires', { ttlMs: 10 });
        clock.mockReturnValue(1_800_000_000_010);
        expect(await b.get(`${key}-ttl`)).toBeUndefined();
        expect(await b.update(`${key}-ttl`, (value) => value ?? 'replaced')).toBe('replaced');
      } finally { clock.mockRestore(); }
      await first.stop();
      const restarted = createDatabaseHost(config);
      try {
        await restarted.start();
        const state = new PluginDatabaseHost(owner, restarted).state.forConversation(target);
        expect(await state.get(key)).toBe(20);
        await state.delete(key);
        await state.delete(`${key}-target`);
        await state.delete(`${key}-ttl`);
        expect(await b.get(key)).toBeUndefined();
      } finally { await restarted.stop(); }
    } finally {
      await first.stop();
      await second.stop();
    }
  }, 30_000);
});
