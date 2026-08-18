import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  childPluginId,
  definePlugin,
  rootPluginId,
  SnapshotStore,
  type RuntimeSnapshot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
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
      }, new AbortController().signal);
      const handle = prepared.resources?.[0]?.value as IsolatedPluginHandle;
      const events: unknown[] = [];
      handle.onEvent((event) => events.push(event));

      await prepared.handoff?.activateNext?.(new AbortController().signal);
      const admission = admitIsolatedHandle(owner, handle);
      await expect(handle.call('sum', 3)).resolves.toBe(5);
      await expect(handle.call('host', 'ok')).resolves.toBe('root/direct:ok');
      await expect(handle.call('announce', { ready: true })).resolves.toBe(true);
      expect(events).toEqual([{ name: 'ready', payload: { ready: true } }]);
      await expect(handle.call('sum', () => undefined)).rejects.toThrow('structured-cloneable');

      await admission.close();
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
    }, new AbortController().signal);
    const handle = prepared.resources?.[0]?.value as IsolatedPluginHandle;
    await prepared.handoff?.activateNext?.(new AbortController().signal);
    const admission = admitIsolatedHandle(childPluginId(rootPluginId(), 'crash'), handle);

    await expect(handle.call('crash')).rejects.toThrow('exited');
    expect(handle.status).toBe('failed');
    expect(onCrash).toHaveBeenCalledOnce();
    await admission.close();
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
    }, new AbortController().signal)).rejects.toThrow('Host resource cannot cross isolation boundary');

    const entry = join(root, 'timeout.mjs');
    await writePlugin(entry, 'timeout');
    const prepared = await runtime.prepare({
      owner,
      parent: rootPluginId(),
      packageName: '@test/timeout',
      entry,
      config: {},
      environment: { name: 'test', mode: 'test', platform: 'node' },
    }, new AbortController().signal);
    const handle = prepared.resources?.[0]?.value as IsolatedPluginHandle;
    await prepared.handoff?.activateNext?.(new AbortController().signal);
    const admission = admitIsolatedHandle(owner, handle);
    await expect(handle.call('slow', 1_000)).rejects.toThrow('timed out');
    expect(handle.status).toBe('failed');
    await admission.close();
    await prepared.dispose();
  });

  it('rejects candidate Host RPC before generation admission', async () => {
    const root = await temporaryDirectory();
    const entry = join(root, 'candidate-host-call.mjs');
    await writeFile(entry, `
const channelToken = { id: 'zhin.isolate.channel' };
export default {
  name: 'candidate-host-call',
  requires: [channelToken],
  async setup({ resources }) {
    await resources.use(channelToken).call('mutate', { candidate: true });
  }
};
`);
    const mutate = vi.fn();
    const runtime = new NodeIsolatedPluginRuntime({
      hostMethods: { mutate },
    });
    const prepared = await runtime.prepare({
      owner: childPluginId(rootPluginId(), 'candidate-host-call'),
      parent: rootPluginId(),
      packageName: '@test/candidate-host-call',
      entry,
      config: {},
      environment: { name: 'test', mode: 'test', platform: 'node' },
    }, new AbortController().signal);

    await expect(prepared.handoff?.activateNext?.(new AbortController().signal))
      .rejects.toThrow('not admitted');
    expect(mutate).not.toHaveBeenCalled();
    await prepared.dispose();
  });

  it('holds the retired generation until an admitted Host RPC settles', async () => {
    const root = await temporaryDirectory();
    const entry = join(root, 'host-operation.mjs');
    await writePlugin(entry, 'host-operation');
    let releaseHost!: () => void;
    const hostGate = new Promise<void>((resolve) => { releaseHost = resolve; });
    let hostEntered!: () => void;
    const entered = new Promise<void>((resolve) => { hostEntered = resolve; });
    const owner = childPluginId(rootPluginId(), 'host-operation');
    const runtime = new NodeIsolatedPluginRuntime({
      hostMethods: {
        async decorate(input, context) {
          hostEntered();
          await hostGate;
          return `${context.owner}:${String(input)}`;
        },
      },
    });
    const prepared = await runtime.prepare({
      owner,
      parent: rootPluginId(),
      packageName: '@test/host-operation',
      entry,
      config: {},
      environment: { name: 'test', mode: 'test', platform: 'node' },
    }, new AbortController().signal);
    const handle = prepared.resources?.[0]?.value as IsolatedPluginHandle;
    await prepared.handoff?.activateNext?.(new AbortController().signal);
    const admission = admitIsolatedHandle(owner, handle);
    let disposed = false;
    admission.commit(0, {
      snapshot: admission.current,
      dispose: () => { disposed = true; },
    });

    const operation = handle.call('host', 'ok');
    await entered;
    admission.commit(1, {
      snapshot: emptySnapshotState(),
      dispose: () => undefined,
    });
    expect(disposed).toBe(false);

    releaseHost();
    await expect(operation).resolves.toBe('root/host-operation:ok');
    await vi.waitFor(() => expect(disposed).toBe(true));
    await admission.close();
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

    const oldLease = runtime.snapshots.acquire();
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
    await hmr.enqueue(entry);
    await expect(slow).resolves.toEqual(Array.from({ length: 16 }, () => 'v1'));
    oldLease.release();
    await delay(0);
    const second = runtime.snapshot;
    const secondHandle = isolatedHandle(second);
    await expect(secondHandle.call('version')).resolves.toBe('v2');
    await expect(firstHandle.call('version')).rejects.toThrow(/closed|not accepting calls/u);
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

function admitIsolatedHandle(owner: ReturnType<typeof childPluginId>, handle: IsolatedPluginHandle) {
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map(),
    config: new Map(),
    resources: new Map([[owner, new Map([[isolatedPluginToken.id, handle]])]]),
    capabilities: new Map(),
    projections: new Map(),
  };
  return new SnapshotStore(state);
}

function emptySnapshotState(): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
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
  return realpath(root);
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
  const path = await mkdtemp(join(tmpdir(), 'zhin-runtime-isolate-'));
  temporary.push(path);
  return realpath(path);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
