import { describe, expect, it, vi } from 'vitest';
import {
  childPluginId,
  createPluginDatabaseHost,
  createPluginScheduleHost,
  qualifyPluginResourceName,
  rootPluginId,
  type DatabaseHost,
  type DatabaseHostModel,
  type ScheduleHost,
} from '../src/index.js';

describe('owner-scoped host facades', () => {
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
    const root = createPluginDatabaseHost(rootPluginId(), host);
    const alpha = createPluginDatabaseHost(childPluginId(rootPluginId(), 'alpha'), host);
    const beta = createPluginDatabaseHost(childPluginId(rootPluginId(), 'beta'), host);

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

    expect(createPluginDatabaseHost(games, host).tables()).toEqual(['sessions']);
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
    const alpha = createPluginScheduleHost(childPluginId(rootPluginId(), 'alpha'), host);
    const beta = createPluginScheduleHost(childPluginId(rootPluginId(), 'beta'), host);

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
