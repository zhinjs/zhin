import { describe, expect, it, vi } from 'vitest';
import {
  childPluginId,
  PluginDatabaseHost,
  PluginScheduleHost,
  PluginOutboundHost,
  PluginStateStore,
  qualifyPluginResourceName,
  rootPluginId,
  type DatabaseHost,
  type DatabaseHostModel,
  type ScheduleHost,
  type PersistentStatePort,
} from '../src/index.js';

describe('owner-scoped host facades', () => {
  it('hides process ports and keeps authority private even if public owner is shadowed', async () => {
    const owner = childPluginId(rootPluginId(), 'alpha');
    const other = childPluginId(rootPluginId(), 'beta');
    const port: PersistentStatePort = {
      read: vi.fn().mockResolvedValue(undefined),
      compareExchange: vi.fn().mockResolvedValue(true),
    };
    const database: DatabaseHost = {
      state: port, dialect: 'sqlite', started: true,
      define: vi.fn(), tables: () => [], models: { get: vi.fn() },
      getRawDatabase: () => undefined, start: async () => undefined, stop: async () => undefined,
    };
    const outbound = { send: vi.fn().mockResolvedValue(null), sendTarget: vi.fn().mockResolvedValue('message') };
    const schedule: ScheduleHost = { register: vi.fn().mockReturnValue(() => undefined), list: () => [] };
    const state = new PluginStateStore(owner, port);
    const db = new PluginDatabaseHost(owner, database);
    const sender = new PluginOutboundHost(owner, outbound);
    const scheduler = new PluginScheduleHost(owner, schedule);
    for (const facade of [state, db, sender, scheduler]) {
      expect(facade.owner).toBe(owner);
      expect(Reflect.set(facade, 'owner', other)).toBe(false);
      for (const field of ['host', 'port', 'scope', 'admission']) {
        expect(Reflect.get(facade, field)).toBeUndefined();
        expect(Reflect.ownKeys(facade)).not.toContain(field);
      }
      // A reflective public shadow must not change the private authority used by operations.
      Object.defineProperty(facade, 'owner', { value: other });
    }
    const target = { endpoint: { adapter: 'root/icqq', id: 'endpoint' }, kind: 'group' as const, id: 'room' };
    await state.forUser(target.endpoint, 'alice').set('preference', true);
    await db.state.forConversation(target).set('target', target);
    db.define('sessions', {});
    await sender.sendTarget?.(target, 'hello');
    scheduler.register({ id: 'cleanup', cron: '0 0 * * * *', execute: () => undefined });
    expect(port.compareExchange).toHaveBeenNthCalledWith(1, owner,
      { kind: 'user', endpoint: target.endpoint, senderId: 'alice' }, 'preference', undefined, true, null);
    expect(port.compareExchange).toHaveBeenNthCalledWith(2, owner,
      { kind: 'conversation', target }, 'target', undefined, target, null);
    expect(database.define).toHaveBeenCalledWith(qualifyPluginResourceName(owner, 'sessions'), {});
    expect(outbound.sendTarget).toHaveBeenCalledWith(target, 'hello', owner);
    expect(schedule.register).toHaveBeenCalledWith(expect.objectContaining({
      owner, id: qualifyPluginResourceName(owner, 'cleanup'),
    }));
  });

  it('keeps every plugin database namespace private, including the root plugin', () => {
    const defined: string[] = [];
    const models = new Map<string, DatabaseHostModel>();
    const host = {
      dialect: 'memory',
      started: false,
      define: (name: string) => { defined.push(name); },
      tables: () => [...defined],
      models: { get: (name: string) => models.get(name) },
      getRawDatabase: () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
    } satisfies DatabaseHost;
    const root = new PluginDatabaseHost(rootPluginId(), host);
    const alpha = new PluginDatabaseHost(childPluginId(rootPluginId(), 'alpha'), host);
    const beta = new PluginDatabaseHost(childPluginId(rootPluginId(), 'beta'), host);

    root.define('sessions', {});
    alpha.define('sessions', {});
    beta.define('sessions', {});

    expect(defined).toEqual([
      '__zhin_plugin__4_root___sessions',
      '__zhin_plugin__4_root_5_alpha___sessions',
      '__zhin_plugin__4_root_4_beta___sessions',
    ]);
    expect(root.tables()).toEqual(['sessions']);
    expect(alpha.tables()).toEqual(['sessions']);
    expect(beta.tables()).toEqual(['sessions']);
  });

  it('does not let a parent namespace match a descendant owner', () => {
    const root = rootPluginId();
    const games = childPluginId(root, 'games');
    const daily = childPluginId(games, 'daily');
    const host = {
      dialect: 'memory',
      started: false,
      define: () => undefined,
      tables: () => [
        qualifyPluginResourceName(games, 'sessions'),
        qualifyPluginResourceName(daily, 'sessions'),
      ],
      models: { get: () => undefined },
      getRawDatabase: () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
    } satisfies DatabaseHost;

    expect(new PluginDatabaseHost(games, host).tables()).toEqual(['sessions']);
  });

  it('isolates schedule ids and only lists jobs owned by the calling plugin', () => {
    const jobs = new Map<string, { readonly id: string; readonly cron: string }>();
    const host = {
      register(job) {
        jobs.set(job.id, job);
        return () => { jobs.delete(job.id); };
      },
      list: () => [...jobs.values()],
    } satisfies ScheduleHost;
    const alpha = new PluginScheduleHost(childPluginId(rootPluginId(), 'alpha'), host);
    const beta = new PluginScheduleHost(childPluginId(rootPluginId(), 'beta'), host);

    const disposeAlpha = alpha.register({ id: 'cleanup', cron: '0 0 * * * *', execute: vi.fn() });
    beta.register({ id: 'cleanup', cron: '0 30 * * * *', execute: vi.fn() });

    expect([...jobs.keys()]).toEqual([
      '__zhin_plugin__4_root_5_alpha___cleanup',
      '__zhin_plugin__4_root_4_beta___cleanup',
    ]);
    expect(alpha.list()).toEqual([{ id: 'cleanup', cron: '0 0 * * * *' }]);
    expect(beta.list()).toEqual([{ id: 'cleanup', cron: '0 30 * * * *' }]);

    disposeAlpha();
    expect(beta.list()).toEqual([{ id: 'cleanup', cron: '0 30 * * * *' }]);
  });

});
