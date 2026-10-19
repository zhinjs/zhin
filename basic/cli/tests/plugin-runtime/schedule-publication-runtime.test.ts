import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  PluginScheduleHost, definePlugin, rootPluginId, scheduleHostToken, scheduleRootHostToken,
  type ScheduleHost,
} from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import scheduleFeature, { defineSchedule } from '../../../../packages/im/schedule-feature/src/index.js';
import { createScheduleHost } from '../../src/plugin-runtime/schedule-host-installer.js';

it('keeps real process schedules alive through failed HMR and switches callbacks only at publication', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-real-schedule-')));
  const host = createScheduleHost();
  const tick = async () => {
    const next = Math.max(...host.list().map(job => Number('nextExecution' in job ? job.nextExecution : undefined)));
    expect(next).toBeGreaterThan(Date.now());
    // TimerWheel admits equal-time jobs sequentially; the next zero-delay
    // timer is scheduled one clock tick later by the fake timer runtime.
    await vi.advanceTimersByTimeAsync(next - Date.now() + 1);
  };
  let runtime: RootRuntime | undefined;
  let hmr: ReturnType<RootRuntime['createHmrCoordinator']> | undefined;
  try {
    const modules = new Map<string, unknown>();
    const add = async (relative: string, value: unknown) => {
      const path = join(project, relative);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, '');
      modules.set(path, value);
    };
    const json = async (relative: string, value: unknown) => {
      const path = join(project, relative);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value));
    };
    await json('package.json', { name: '@test/root', dependencies: { '@test/schedule': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/schedule' }] } });
    await json('packages/schedule/package.json', { name: '@test/schedule', zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
    await add('plugin.ts', { default: definePlugin({ name: 'root' }) });
    await add('packages/schedule/index.ts', { default: scheduleFeature });
    const oldExecute = vi.fn();
    const newExecute = vi.fn();
    const secondExecute = vi.fn();
    await add('schedules/first/index.ts', { default: defineSchedule({ cron: '* * * * * *', description: 'old', execute: oldExecute }) });
    await add('schedules/second/index.ts', { default: defineSchedule({ cron: '* * * * * *', execute: secondExecute }) });
    let failAfter = -1;
    const visibleDuringPrepare: number[] = [];
    const port: ScheduleHost = {
      register(job) {
        if (failAfter === 0) { failAfter = -1; throw new Error('second schedule activation failed'); }
        if (failAfter > 0) failAfter--;
        const dispose = host.register(job);
        visibleDuringPrepare.push(host.list().length);
        return dispose;
      },
      list: () => host.list(),
    };
    const loader: ModuleRuntime = { async load<T>(source: string): Promise<T> {
      const value = modules.get(source);
      if (!value) throw new Error(`Missing test module ${source}`);
      return value as T;
    }, async close() {} };
    runtime = new RootRuntime({ projectRoot: project, modules: loader, config: { configVersion: 2 },
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources, admission }) {
        resources.provide(scheduleRootHostToken, port);
        resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), port, admission));
      } });
    await runtime.start();
    expect(visibleDuringPrepare).toEqual([0, 0]);
    expect(host.list()).toHaveLength(2);
    await tick();
    expect(oldExecute).toHaveBeenCalledTimes(1);
    expect(secondExecute).toHaveBeenCalledTimes(1);

    const first = runtime.snapshot;
    modules.set(join(project, 'schedules/first/index.ts'), { default: defineSchedule({ cron: '* * * * * *', description: 'new', execute: newExecute }) });
    hmr = runtime.createHmrCoordinator({ onError() {}, onRestartRequired() {} });
    failAfter = 1;
    await expect(hmr.enqueue(join(project, 'schedules/first/index.ts'))).rejects.toThrow('second schedule activation failed');
    expect(runtime.snapshot).toBe(first);
    expect(visibleDuringPrepare).toEqual([0, 0, 2]);
    expect(host.list()).toHaveLength(2);
    expect(host.list().find(job => job.description)?.description).toBe('old');
    await tick();
    expect(oldExecute).toHaveBeenCalledTimes(2);
    expect(secondExecute).toHaveBeenCalledTimes(2);
    expect(newExecute).not.toHaveBeenCalled();

    await hmr.enqueue(join(project, 'schedules/first/index.ts'));
    expect(host.list()).toHaveLength(2);
    expect(host.list().find(job => job.description)?.description).toBe('new');
    await tick();
    expect(oldExecute).toHaveBeenCalledTimes(2);
    expect(newExecute).toHaveBeenCalledTimes(1);
    expect(secondExecute).toHaveBeenCalledTimes(3);
    await hmr.stop();
    await runtime.stop();
    expect(host.list()).toEqual([]);
  } finally {
    try { await hmr?.stop(); await runtime?.stop(); }
    finally { host.stop(); vi.useRealTimers(); await rm(project, { recursive: true }); }
  }
});
