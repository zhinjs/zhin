import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  childPluginId,
  definePlugin,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/next-runtime';
import {
  isolatedPluginToken,
  NodeIsolatedPluginRuntime,
  type IsolateMode,
  type IsolatedPluginHandle,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('NodeIsolatedPluginRuntime', () => {
  it.each<IsolateMode>(['worker', 'process'])(
    'runs structured-clone RPC and events over %s transport',
    async (mode) => {
      const root = await temporaryDirectory();
      const entry = join(root, 'plugin.mjs');
      await writePlugin(entry, 'direct');
      const runtime = new NodeIsolatedPluginRuntime({
        mode,
        hostMethods: {
          decorate: (input, context) => `${context.owner}:${String(input)}`,
        },
      });
      const owner = childPluginId(rootPluginId(), 'direct');
      const prepared = await runtime.prepare({
        owner,
        parent: rootPluginId(),
        packageName: '@test/direct',
        entry,
        config: { value: 2 },
        environment: { name: 'test', mode: 'test', platform: 'node' },
      });
      const handle = prepared.resources?.[0]?.value as IsolatedPluginHandle;
      const events: unknown[] = [];
      handle.onEvent((event) => events.push(event));

      await prepared.handoff?.activateNext?.();
      prepared.handoff?.openNext?.();
      await expect(handle.call('sum', 3)).resolves.toBe(5);
      await expect(handle.call('host', 'ok')).resolves.toBe('root/direct:ok');
      await expect(handle.call('announce', { ready: true })).resolves.toBe(true);
      expect(events).toEqual([{ name: 'ready', payload: { ready: true } }]);
      await expect(handle.call('sum', () => undefined)).rejects.toThrow('structured-cloneable');

      await prepared.dispose();
      expect(handle.status).toBe('closed');
    },
  );

  it('reports an unexpected Worker exit and rejects pending calls', async () => {
    const root = await temporaryDirectory();
    const entry = join(root, 'plugin.mjs');
    await writePlugin(entry, 'crash');
    const onCrash = vi.fn();
    const runtime = new NodeIsolatedPluginRuntime({ mode: 'worker', onCrash });
    const prepared = await runtime.prepare({
      owner: childPluginId(rootPluginId(), 'crash'),
      parent: rootPluginId(),
      packageName: '@test/crash',
      entry,
      config: {},
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const handle = prepared.resources?.[0]?.value as IsolatedPluginHandle;
    await prepared.handoff?.activateNext?.();
    prepared.handoff?.openNext?.();

    await expect(handle.call('crash')).rejects.toThrow('exited');
    expect(handle.status).toBe('failed');
    expect(onCrash).toHaveBeenCalledOnce();
    await prepared.dispose();
  });

  it('rejects Host resources and retires an instance after an RPC timeout', async () => {
    const root = await temporaryDirectory();
    const hostBound = join(root, 'host-bound.mjs');
    await writeFile(hostBound, `
export default { name: 'host-bound', requires: [{ id: 'acme.database' }] };
`);
    const owner = childPluginId(rootPluginId(), 'boundary');
    const runtime = new NodeIsolatedPluginRuntime({ requestTimeoutMs: 250 });
    await expect(runtime.prepare({
      owner,
      parent: rootPluginId(),
      packageName: '@test/host-bound',
      entry: hostBound,
      config: {},
      environment: { name: 'test', mode: 'test', platform: 'node' },
    })).rejects.toThrow('Host resource cannot cross isolation boundary');

    const entry = join(root, 'timeout.mjs');
    await writePlugin(entry, 'timeout');
    const prepared = await runtime.prepare({
      owner,
      parent: rootPluginId(),
      packageName: '@test/timeout',
      entry,
      config: {},
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const handle = prepared.resources?.[0]?.value as IsolatedPluginHandle;
    await prepared.handoff?.activateNext?.();
    prepared.handoff?.openNext?.();
    await expect(handle.call('slow', 1_000)).rejects.toThrow('timed out');
    expect(handle.status).toBe('failed');
    await prepared.dispose();
  });
});

describe('RootRuntime isolated Plugin HMR', () => {
  it('drains the old generation, rolls back a broken candidate, and never Host-imports it', async () => {
    const project = await createProject();
    const entry = join(project, 'plugins/child/plugin.mjs');
    await writePlugin(entry, 'v1');
    const modules = new FakeModuleRuntime();
    const rootEntry = join(project, 'plugin.ts');
    modules.set(rootEntry, { default: definePlugin({ name: 'root' }) });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      isolation: new NodeIsolatedPluginRuntime(),
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const first = await runtime.start();
    const firstHandle = isolatedHandle(first);
    await expect(firstHandle.call('version')).resolves.toBe('v1');
    expect(modules.loadCount(entry)).toBe(0);

    const slow = Promise.all(Array.from(
      { length: 16 },
      (_, index) => firstHandle.call('slow', 50 + index * 2),
    ));
    await delay(10);
    await writePlugin(entry, 'v2');
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired() {},
      onError() {},
    });
    const started = Date.now();
    await hmr.enqueue(entry);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    await expect(slow).resolves.toEqual(Array.from({ length: 16 }, () => 'v1'));
    const second = runtime.snapshot;
    const secondHandle = isolatedHandle(second);
    await expect(secondHandle.call('version')).resolves.toBe('v2');
    await expect(firstHandle.call('version')).rejects.toThrow('not accepting calls');
    expect(modules.loadCount(entry)).toBe(0);

    await writeBrokenPlugin(entry);
    await expect(hmr.enqueue(entry)).rejects.toThrow('candidate setup failed');
    expect(runtime.snapshot).toBe(second);
    await expect(secondHandle.call('version')).resolves.toBe('v2');

    await runtime.stop();
    expect(secondHandle.status).toBe('closed');
  });
});

function isolatedHandle(snapshot: RuntimeSnapshot): IsolatedPluginHandle {
  const owner = childPluginId(rootPluginId(), 'child');
  const handle = snapshot.resources.get(owner)?.get(isolatedPluginToken.id);
  if (!handle) throw new Error('Missing isolated Plugin handle');
  return handle as IsolatedPluginHandle;
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  async load<T>(source: string): Promise<T> {
    this.#loads.set(source, (this.#loads.get(source) ?? 0) + 1);
    if (!this.#modules.has(source)) throw new Error(`Unexpected Host module load: ${source}`);
    return this.#modules.get(source) as T;
  }
  loadCount(source: string): number { return this.#loads.get(source) ?? 0; }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await temporaryDirectory();
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/child': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [{ package: '@test/child', instanceKey: 'child' }],
    },
  });
  await writeJson(join(root, 'plugins/child/package.json'), {
    name: '@test/child',
    zhin: {
      protocol: 1,
      type: 'plugin',
      runtime: 'isolated',
      entry: './plugin.mjs',
    },
  });
  await writeFile(join(root, 'plugin.ts'), '');
  return root;
}

async function writePlugin(path: string, version: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `
const channelToken = { id: 'zhin.isolate.channel' };
export default {
  name: '${version}',
  requires: [channelToken],
  setup({ config, resources }) {
    const channel = resources.use(channelToken);
    channel.expose('version', () => '${version}');
    channel.expose('sum', input => Number(input) + Number(config.get().value ?? 0));
    channel.expose('host', input => channel.call('decorate', input));
    channel.expose('announce', input => { channel.emit('ready', input); return true; });
    channel.expose('slow', async input => {
      await new Promise(resolve => setTimeout(resolve, Number(input)));
      return '${version}';
    });
    channel.expose('crash', () => process.exit(7));
  }
};
`);
}

async function writeBrokenPlugin(path: string): Promise<void> {
  await writeFile(path, `
export default {
  name: 'broken',
  setup() { throw new Error('candidate setup failed'); }
};
`);
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'zhin-next-isolate-'));
  temporary.push(path);
  return path;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
