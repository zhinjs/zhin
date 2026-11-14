import { describe, expect, it, vi } from 'vitest';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  rootPluginId,
  scheduleHostToken,
  scheduleRootHostToken,
} from '@zhin.js/plugin-runtime';
import type { RootResourceContext } from '@zhin.js/runtime';
import {
  createScheduleHost,
  installScheduleHost,
  resolveScheduleTimezone,
} from '../../src/instance/schedule-host-installer.js';

describe('ScheduleHost', () => {
  it('registers and lists solar cron jobs', () => {
    const host = createScheduleHost();
    const execute = vi.fn();
    const dispose = host.register({
      id: 'test/job',
      cron: '0 0 9 * * *',
      description: 'morning',
      execute,
    });
    const listed = host.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: 'test/job',
      cron: '0 0 9 * * *',
      description: 'morning',
      expression: '0 0 9 * * *',
      running: true,
      plugin: 'test',
    });
    expect(typeof listed[0]!.nextExecution).toBe('number');
    dispose();
    expect(host.list()).toEqual([]);
    host.stop();
  });

  it('lists title, kind and the last real run of each job (#1250)', async () => {
    let now = 1_000;
    const host = createScheduleHost(() => now);
    let fail = false;
    const dispose = host.register({
      id: 'rss/poll_feeds', cron: '* * * * * *', description: 'Poll RSS subscriptions',
      title: '轮询 RSS 订阅', titleI18n: { en: 'Poll RSS feeds' },
      execute: async () => { now += 40; if (fail) throw new Error('feed timeout'); },
    });
    const userTask = host.register({ id: 'reminder/poll', cron: '0 0 9 * * *', kind: 'user-task', execute: vi.fn() });
    try {
      expect(host.list()[0]).toMatchObject({ title: '轮询 RSS 订阅', titleI18n: { en: 'Poll RSS feeds' }, kind: 'plugin-internal' });
      expect(host.list()[0]).not.toHaveProperty('lastRun');
      expect(host.list()[1]).toMatchObject({ kind: 'user-task' });
      await vi.waitFor(() => expect(host.list()[0]!.lastRun).toMatchObject({ status: 'succeeded', finishedAt: expect.any(Number) }), { timeout: 3_000, interval: 50 });
      const first = host.list()[0]!.lastRun!;
      expect(first.finishedAt - first.startedAt).toBe(40);
      fail = true;
      await vi.waitFor(() => expect(host.list()[0]!.lastRun).toMatchObject({ status: 'failed', error: 'feed timeout' }), { timeout: 3_000, interval: 50 });
    } finally {
      dispose(); userTask();
      host.stop();
    }
    expect(host.list()).toEqual([]);
  });

  it('does not let a retired generation cancel its replacement', () => {
    const host = createScheduleHost();
    const disposePrevious = host.register({
      id: 'test/job',
      cron: '0 0 9 * * *',
      execute: vi.fn(),
    });
    const disposeCurrent = host.register({
      id: 'test/job',
      cron: '0 30 9 * * *',
      execute: vi.fn(),
    });

    disposePrevious();
    expect(host.list()).toMatchObject([{
      id: 'test/job',
      cron: '0 30 9 * * *',
    }]);

    disposeCurrent();
    expect(host.list()).toEqual([]);
    host.stop();
  });

  it('does not stop a borrowed process host with a generation lifecycle', async () => {
    const host = createScheduleHost();
    const context = createInstallContext();

    installScheduleHost(host)(context);
    expect(context.resources.use(scheduleRootHostToken)).toBe(host);
    expect(context.resources.use(scheduleHostToken)).toMatchObject({ owner: rootPluginId() });
    await context.lifecycle.dispose();

    const dispose = host.register({
      id: 'test/after-generation-retire',
      cron: '0 0 9 * * *',
      execute: vi.fn(),
    });
    dispose();
    host.stop();
  });

  it('stops a host owned by the generation lifecycle', async () => {
    const context = createInstallContext();

    installScheduleHost()(context);
    const host = context.resources.use(scheduleHostToken);
    await context.lifecycle.dispose();

    expect(() => host.register({
      id: 'test/after-stop',
      cron: '0 0 9 * * *',
      execute: vi.fn(),
    })).toThrow('Scheduler has been stopped');
  });
});

function createInstallContext(): RootResourceContext {
  return {
    resources: new Scope(rootPluginId()),
    lifecycle: new DisposeStack(),
    handoff: new GenerationHandoffStack(),
    // The installer does not consume config; keep this fixture focused on
    // concrete resource and lifecycle implementations.
    config: {} as RootResourceContext['config'],
  };
}

describe('resolveScheduleTimezone', () => {
  it('prefers TZ, then the system zone, then UTC', () => {
    expect(resolveScheduleTimezone({ TZ: 'Europe/Berlin' }, () => 'America/New_York')).toBe('Europe/Berlin');
    expect(resolveScheduleTimezone({}, () => 'America/New_York')).toBe('America/New_York');
    expect(resolveScheduleTimezone({ TZ: '' }, () => undefined)).toBe('UTC');
  });

  it('reads the real system zone by default', () => {
    expect(resolveScheduleTimezone({})).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
