import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childPluginId, rootPluginId, PluginDatabaseHost, createDeliveryTarget, Scope, userLocalePreferencesToken } from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { installLocaleHost } from '../../src/plugin-runtime/locale-host-installer.js';
import type { DatabaseHostConfig } from '../../src/plugin-runtime/database-config.js';

const dialects = ['sqlite', ...(process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1' ? ['pg', 'mysql'] : [])];
describe('persistent state database CAS', () => {
  it.each(dialects)('persists atomically across two independent %s connections', async (dialect) => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-live-state-'));
    const config: DatabaseHostConfig = dialect === 'sqlite' ? {
      dialect, filename: join(directory, 'state.sqlite'),
    } : dialect === 'pg' ? {
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
    const preferences = (database: ReturnType<typeof createDatabaseHost>) => {
      const resources = new Scope(rootPluginId());
      installLocaleHost(database)({ resources } as Parameters<ReturnType<typeof installLocaleHost>>[0]);
      return resources.use(userLocalePreferencesToken);
    };
    const firstPreferences = preferences(first), secondPreferences = preferences(second);
    try {
      await first.start();
      await second.start();
      await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b)
        .update<number>(key, (count) => (count ?? 0) + 1)));
      expect(await a.get(key)).toBe(20);
      await a.set(`${key}-target`, target);
      expect(await b.get(`${key}-target`)).toEqual(target);
      // Use the real locale installer and its endpoint + sender storage scope.
      await firstPreferences.set(target.endpoint, key, 'en');
      expect(await secondPreferences.get(target.endpoint, key)).toBe('en');
      expect(await secondPreferences.get(target.endpoint, `${key}-other-sender`)).toBeUndefined();
      expect(await secondPreferences.get({ ...target.endpoint, id: `${target.endpoint.id}-other` }, key)).toBeUndefined();
      expect(await secondPreferences.get({ ...target.endpoint, adapter: 'root/other' }, key)).toBeUndefined();
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
        expect(await preferences(restarted).get(target.endpoint, key)).toBe('en');
        await preferences(restarted).set(target.endpoint, key, 'zh-CN');
        expect(await secondPreferences.get(target.endpoint, key)).toBe('zh-CN');
        await new PluginDatabaseHost(rootPluginId(), restarted).state.forUser(target.endpoint, key).delete('locale');
        await state.delete(key);
        await state.delete(`${key}-target`);
        await state.delete(`${key}-ttl`);
        expect(await b.get(key)).toBeUndefined();
      } finally { await restarted.stop(); }
    } finally {
      await first.stop();
      await second.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
