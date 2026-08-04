import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPluginDatabaseHost,
  createPluginScheduleHost,
  childPluginId,
  databaseHostToken,
  databaseRootHostToken,
  definePlugin,
  rootPluginId,
  qualifyPluginResourceName,
  qualifyPluginScheduleId,
  scheduleHostToken,
  scheduleRootHostToken,
  type DatabaseHost,
  type ScheduleHost,
} from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('PluginScopeAssembler owner-scoped hosts', () => {
  it('rebinds inherited host tokens to each child plugin owner', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const tables: string[] = [];
    const jobs: string[] = [];
    const alpha = childPluginId(rootPluginId(), 'alpha');
    const beta = childPluginId(rootPluginId(), 'beta');
    const database = {
      dialect: 'memory',
      started: false,
      define: (name: string) => { tables.push(name); },
      tables: () => [...tables],
      models: { get: () => undefined },
      getRawDatabase: () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
    } satisfies DatabaseHost;
    const schedule = {
      register(job) {
        jobs.push(job.id);
        return () => undefined;
      },
      list: () => [],
    } satisfies ScheduleHost;

    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({
        name: 'root',
        setup({ resources }) {
          resources.use(databaseHostToken).define('sessions', {});
          resources.use(scheduleHostToken).register({
            id: 'cleanup', cron: '0 0 * * * *', execute: () => undefined,
          });
        },
      }),
    });
    modules.set(join(project, 'plugins/alpha/plugin.ts'), {
      default: definePlugin({
        name: 'alpha',
        setup({ resources }) {
          resources.use(databaseHostToken).define('sessions', {});
          resources.use(scheduleHostToken).register({
            id: 'cleanup', cron: '0 0 * * * *', execute: () => undefined,
          });
        },
      }),
    });
    modules.set(join(project, 'plugins/beta/plugin.ts'), {
      default: definePlugin({
        name: 'beta',
        setup({ resources }) {
          resources.use(databaseHostToken).define('sessions', {});
          resources.use(scheduleHostToken).register({
            id: 'cleanup', cron: '0 0 * * * *', execute: () => undefined,
          });
        },
      }),
    });

    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources }) {
        resources.provide(databaseRootHostToken, database);
        resources.provide(databaseHostToken, createPluginDatabaseHost(rootPluginId(), database));
        resources.provide(scheduleRootHostToken, schedule);
        resources.provide(scheduleHostToken, createPluginScheduleHost(rootPluginId(), schedule));
      },
    });

    await runtime.start();
    expect(tables).toEqual([
      'sessions',
      qualifyPluginResourceName(alpha, 'sessions'),
      qualifyPluginResourceName(beta, 'sessions'),
    ]);
    expect(jobs).toEqual([
      'cleanup',
      qualifyPluginScheduleId(alpha, 'cleanup'),
      qualifyPluginScheduleId(beta, 'cleanup'),
    ]);
    await runtime.stop();
  });
});

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }

  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-owner-hosts-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/alpha': 'workspace:*', '@test/beta': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [
        { package: '@test/alpha', instanceKey: 'alpha' },
        { package: '@test/beta', instanceKey: 'beta' },
      ],
    },
  });
  for (const name of ['alpha', 'beta']) {
    await writeJson(join(root, `plugins/${name}/package.json`), {
      name: `@test/${name}`,
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    });
    await touch(join(root, `plugins/${name}/plugin.ts`));
  }
  await touch(join(root, 'plugin.ts'));
  return realpath(root);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
