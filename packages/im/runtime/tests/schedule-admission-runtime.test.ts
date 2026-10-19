import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  PluginScheduleHost, createToken, definePlugin, rootPluginId, scheduleHostToken, scheduleRootHostToken,
  type ScheduleHost, type ScheduleJobRegistration,
} from '@zhin.js/plugin-runtime';
import scheduleFeature, { defineSchedule, type ScheduleContext } from '../../schedule-feature/src/index.js';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true }))); });

describe('Schedule Feature candidate publication', () => {
  it('supplies each execution with the published owner, config and scoped resources across HMR', async () => {
    const { runtime, jobs, scheduleSource, execute, resourceToken, resource } = await fixture();
    try {
      await runtime.start();
      await jobs[0]!.execute();
      const first = execute.mock.calls[0]![0]!;
      expect(first).toMatchObject({ owner: { id: rootPluginId() }, generation: 1, config: { label: 'daily' } });
      expect(first.use(resourceToken)).toBe(resource);
      const hmr = runtime.createHmrCoordinator({ onError() {}, onRestartRequired() {} });
      try { await hmr.enqueue(scheduleSource); } finally { await hmr.stop(); }
      expect(() => jobs[0]!.execute()).toThrow('inactive generation');
      await jobs[2]!.execute();
      expect(execute.mock.calls[1]![0]!.generation).toBe(2);
      expect(execute.mock.calls[1]![0]!.use(resourceToken)).toBe(resource);
    } finally { await runtime.stop(); }
  });
  it('stages discovered schedules after Scope seal and runs only after publication', async () => {
    const { runtime, jobs, active, captured, execute, duringRegistration } = await fixture();
    try {
      await runtime.start();
      expect(jobs).toHaveLength(2);
      expect(active.size).toBe(2);
      expect(duringRegistration).toEqual(['inactive generation', 'inactive generation']);
      await jobs[0].execute();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(captured()).toBeDefined();
      await runtime.stop();
      expect(active.size).toBe(0);
      expect(() => captured()!.register({ id: 'retired', cron: '* * * * * *', execute })).toThrow('inactive generation');
      expect(() => jobs[0].execute()).toThrow('inactive generation');
    } finally { await runtime.stop(); }
  });

  it('rolls back staged jobs when activation fails and closes failed candidate handles', async () => {
    const { runtime, jobs, active, captured, execute } = await fixture(true);
    try {
      await expect(runtime.start()).rejects.toThrow('schedule activation failed');
      expect(runtime.snapshot.generation).toBe(0);
      expect(jobs).toHaveLength(1);
      expect(active.size).toBe(0);
      expect(() => captured()!.register({ id: 'failed', cron: '* * * * * *', execute })).toThrow('inactive generation');
      expect(() => jobs[0].execute()).toThrow('inactive generation');
    } finally { await runtime.stop(); }
  });

  it('reloads a schedule slot without re-opening its published owner facade', async () => {
    const { runtime, active, scheduleSource, jobs, execute } = await fixture();
    try {
      await runtime.start();
      const hmr = runtime.createHmrCoordinator({ onError() {}, onRestartRequired() {} });
      try { await hmr.enqueue(scheduleSource); }
      finally { await hmr.stop(); }
      expect(active.size).toBe(2);
      expect(() => jobs[0].execute()).toThrow('inactive generation');
      await jobs[2].execute();
      expect(execute).toHaveBeenCalledTimes(1);
    } finally { await runtime.stop(); }
  });
});

async function fixture(failSecond = false) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-schedule-admission-')));
  temporary.push(project);
  const files = new Map<string, unknown>();
  const add = async (relative: string, value: unknown) => {
    const path = join(project, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '');
    files.set(path, value);
  };
  const json = async (relative: string, value: unknown) => {
    const path = join(project, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value));
  };
  await json('package.json', { name: '@test/root', dependencies: { '@test/schedule': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/schedule' }] } });
  await json('packages/schedule/package.json', { name: '@test/schedule', zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
  let host: PluginScheduleHost | undefined;
  const resourceToken = createToken<{ label: string }>('test.schedule.resource');
  const resource = { label: 'owned resource' };
  await add('plugin.ts', { default: definePlugin({ name: 'root',
    config: { toJsonSchema: () => ({ type: 'object', properties: { label: { type: 'string' } } }) },
    setup({ resources }) { host = resources.use(scheduleHostToken); } }) });
  await add('packages/schedule/index.ts', { default: scheduleFeature });
  const execute = vi.fn((_context?: ScheduleContext) => undefined);
  for (const name of ['first', 'second']) await add(`schedules/${name}/index.ts`, { default: defineSchedule({ cron: '* * * * * *', execute }) });
  const jobs: ScheduleJobRegistration[] = [];
  const active = new Set<ScheduleJobRegistration>();
  const duringRegistration: string[] = [];
  const port: ScheduleHost = {
    register(job) {
      if (failSecond && jobs.length === 1) throw new Error('schedule activation failed');
      if (runtime.snapshot.generation === 0) {
        expect(() => host!.register({ id: 'author-candidate', cron: '* * * * * *', execute })).toThrow('inactive generation');
      }
      jobs.push(job);
      active.add(job);
      try { job.execute(); } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('inactive generation')) throw error;
        duringRegistration.push('inactive generation');
      }
      return () => { active.delete(job); };
    },
    list: () => [...active],
  };
  const modules: ModuleRuntime = { async load<T>(source: string): Promise<T> {
    const value = files.get(source);
    if (!value) throw new Error(`Missing test module ${source}`);
    return value as T;
  }, async close() {} };
  const runtime = new RootRuntime({ projectRoot: await realpath(project), modules,
    environment: { name: 'test', mode: 'test', platform: 'node' },
    config: { configVersion: 2, plugins: {}, plugin: { label: 'daily' } },
    installResources({ resources, admission }) {
      resources.provide(resourceToken, resource);
      resources.provide(scheduleRootHostToken, port);
      resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), port, admission));
    } });
  return { runtime, jobs, active, captured: () => host, execute, duringRegistration, resourceToken, resource,
    scheduleSource: join(project, 'schedules/first/index.ts') };
}
