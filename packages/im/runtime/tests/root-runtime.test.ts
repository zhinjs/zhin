import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToken, definePlugin, projectLocaleToken, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import commandFeature, {
  CommandIndex,
  commandFeatureId,
  defineCommand,
} from '@zhin.js/command';
import { RootRuntime, primaryConfigToken, runtimeEnvironmentToken, type ModuleRuntime, type PrimaryConfig } from '../src/index.js';
import { Schema } from '../../../../basic/schema/src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('RootRuntime tracer bullet', () => {
  it('awaits instance pause before evaluating a candidate and notifies both old and new instances before disposal', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const order: string[] = [];
    let finishPause!: () => void;
    let pauseEntered!: () => void;
    const entered = new Promise<void>(resolve => { pauseEntered = resolve; });
    const held = new Promise<void>(resolve => { finishPause = resolve; });
    const source = join(project, 'plugin.ts');
    const notices: import('@zhin.js/plugin-runtime').HmrResumeDetails[] = [];
    modules.set(source, { default: definePlugin({ name: 'root', setup({ events, lifecycle }) {
      events.on('hmr.pause', async event => {
        expect(event.signal.aborted).toBe(false); order.push('pause'); pauseEntered(); await held;
      });
      events.on('hmr.resume', event => { notices.push(event.details); order.push('old-complete'); });
      lifecycle.add(() => { order.push('old-dispose'); });
    } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: () => 'ok' }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    await runtime.start();
    modules.set(source, { default: definePlugin({ name: 'root', setup({ events }) {
      order.push('candidate'); events.on('hmr.resume', event => { notices.push(event.details); order.push('new-complete'); });
    } }) });
    const reloading = runtime.reload();
    await entered;
    expect(order).toEqual(['pause']); expect(runtime.snapshot.generation).toBe(1);
    finishPause();
    await reloading;
    expect(order.slice(0, 4)).toEqual(['pause', 'candidate', 'old-complete', 'new-complete']);
    expect(notices.map(value => [value.outcome, value.receiver.creationGeneration, value.receiver.state]))
      .toEqual([['committed', 1, 'replaced'], ['committed', 2, 'current']]);
    expect(notices[0].replaced).toContain(runtime.snapshot.root);
    await runtime.stop();
    expect(order.indexOf('old-dispose')).toBeGreaterThan(order.indexOf('old-complete'));
  });

  it('keeps a reused instance once on source-slot HMR and reports completion errors without rolling module metadata back', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    let pauses = 0, resumes = 0, setups = 0;
    const reported: unknown[] = [];
    const rollback = vi.fn();
    const commit = vi.fn();
    Object.assign(modules, { beginGeneration() {}, rollbackGeneration: rollback, commitGeneration: commit });
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup({ events }) {
      setups++; events.on('hmr.pause', () => { pauses++; });
      events.on('hmr.resume', event => {
        resumes++; expect(event.details.receiver.state).toBe('current');
        expect(event.details.replaced).toEqual([]); throw new Error('completion diagnostic');
      });
    } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    const source = join(project, 'commands/gh/issue/list/index.ts');
    modules.set(source, { default: defineCommand({ execute: () => 'before' }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' }, onControlError: error => { reported.push(error); } });
    await runtime.start();
    const hmr = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError(error) { throw error; } });
    modules.set(source, { default: defineCommand({ execute: () => 'after' }) });
    await hmr.enqueue(source);
    expect([setups, pauses, resumes]).toEqual([1, 1, 1]);
    expect(runtime.snapshot.generation).toBe(2);
    expect(rollback).not.toHaveBeenCalled(); expect(commit).toHaveBeenCalled(); expect(reported).toHaveLength(1);
    expect(await commandIndex(runtime.snapshot).execute('gh issue list')).toBe('after');
    await runtime.stop();
  });

  it('rejects publication after pause failure while notifying every attempted instance', async () => {
    const project = await createProject(); const modules = new FakeModuleRuntime();
    const outcomes: string[] = [];
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup({ events }) {
      events.on('hmr.pause', () => { throw new Error('checkpoint rejected'); });
      events.on('hmr.resume', event => { outcomes.push(event.details.outcome); });
    } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: () => 'ok' }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    await runtime.start();
    const before = modules.loadCount(join(project, 'plugin.ts'));
    await expect(runtime.reload()).rejects.toThrow('pause handlers rejected');
    expect(runtime.snapshot.generation).toBe(1); expect(outcomes).toEqual(['rejected']);
    expect(modules.loadCount(join(project, 'plugin.ts'))).toBe(before);
    await runtime.stop();
  });

  it('never sends completion to a rejected candidate that registered listeners during setup', async () => {
    const project = await createProject(); const modules = new FakeModuleRuntime();
    const completions: string[] = []; let rejectedDisposed = false;
    const source = join(project, 'plugin.ts');
    modules.set(source, { default: definePlugin({ name: 'root', setup({ events }) {
      events.on('hmr.resume', event => { completions.push(`old:${event.details.outcome}`); });
    } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: () => 'ok' }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    await runtime.start();
    modules.set(source, { default: definePlugin({ name: 'root', setup({ events, lifecycle }) {
      events.on('hmr.resume', () => { completions.push('candidate'); });
      lifecycle.add(() => { rejectedDisposed = true; }); throw new Error('candidate setup rejected');
    } }) });
    try {
      await expect(runtime.reload()).rejects.toThrow('candidate setup rejected');
      expect(runtime.snapshot.generation).toBe(1); expect(completions).toEqual(['old:rejected']);
      expect(rejectedDisposed).toBe(true);
    } finally { await runtime.stop(); }
  });

  it('cooperatively cancels a pending pause on explicit stop and keeps its old instance through completion', async () => {
    const project = await createProject(); const modules = new FakeModuleRuntime();
    let entered!: () => void;
    const pause = new Promise<void>(resolve => { entered = resolve; });
    let completed = false, disposed = false;
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup({ events, lifecycle }) {
      events.on('hmr.pause', event => { entered(); return new Promise<void>(resolve => event.signal.addEventListener('abort', () => resolve(), { once: true })); });
      events.on('hmr.resume', async event => {
        expect(disposed).toBe(false); expect(event.details.outcome).toBe('cancelled');
        expect(event.details.reason).toBe('root-stopping');
        if (!event.signal.aborted) await new Promise<void>(resolve => event.signal.addEventListener('abort', () => resolve(), { once: true }));
        completed = true;
      });
      lifecycle.add(() => { expect(completed).toBe(true); disposed = true; });
    } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: () => 'ok' }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    await runtime.start(); const reload = runtime.reload(); const rejected = expect(reload).rejects.toThrow('stopping');
    await pause; const stop = runtime.stop(); await rejected; await stop;
    expect(completed).toBe(true); expect(disposed).toBe(true);
  });

  it.each(['abort', 'retain'] as const)('lets the plugin choose %s for accepted command work without imposing a drain', async policy => {
    const project = await createProject(); const modules = new FakeModuleRuntime();
    const taskSignal = new AbortController();
    let finish!: () => void, entered!: () => void;
    const active = new Promise<void>(resolve => { entered = resolve; });
    const work = new Promise<string>(resolve => { finish = () => resolve('finished');
      taskSignal.signal.addEventListener('abort', () => resolve('plugin-cancelled'), { once: true }); });
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup({ events }) {
      events.on('hmr.pause', () => { if (policy === 'abort') taskSignal.abort(); });
    } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: async () => { entered(); return work; } }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    try {
      await runtime.start();
      const executing = commandIndex(runtime.snapshot).execute('gh issue list'); await active;
      await runtime.reload();
      expect(taskSignal.signal.aborted).toBe(policy === 'abort');
      finish();
      await expect(executing).resolves.toBe(policy === 'abort' ? 'plugin-cancelled' : 'finished');
    } finally { finish(); await runtime.stop(); }
  });

  it('resolves omitted project language at runtime without adding it to the configuration', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: context => context.locale }) });
    const input = { configVersion: 2, plugins: {} };
    const runtime = new RootRuntime({ projectRoot: project, modules, config: input,
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    const expectOmitted = async () => {
      const snapshot = runtime.snapshot;
      const resources = snapshot.resources.get(snapshot.root)!;
      const primary = resources.get(primaryConfigToken.id) as PrimaryConfig;
      expect(primary.document).not.toHaveProperty('locale');
      expect(primary.expanded).not.toHaveProperty('locale');
      expect(snapshot.config.get(snapshot.root)).not.toHaveProperty('locale');
      expect(resources.get(projectLocaleToken.id)).toBe('zh-CN');
      expect(await commandIndex(snapshot).execute('gh issue list')).toBe('zh-CN');
    };
    try {
      await runtime.start();
      await expectOmitted();
      expect(input).toEqual({ configVersion: 2, plugins: {} });
      await runtime.patchConfig([{ op: 'set', path: ['locale'], value: 'en' }]);
      expect(runtime.snapshot.resources.get(runtime.snapshot.root)?.get(projectLocaleToken.id)).toBe('en');
      expect(await commandIndex(runtime.snapshot).execute('gh issue list')).toBe('en');
      await runtime.patchConfig([{ op: 'remove', path: ['locale'] }]);
      await expectOmitted();
    } finally { await runtime.stop(); }
  });

  it('publishes detached custom-resolver schemas before pending setup completes', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const declaration = { type: 'object', properties: { count: { type: 'number', default: 1 } } };
    let finish!: () => void;
    let entered!: () => void;
    const setupEntered = new Promise<void>(resolve => { entered = resolve; });
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup() {
      entered();
      return new Promise<void>(resolve => { finish = resolve; });
    } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: () => 'ok' }) });
    const runtime = new RootRuntime({ application: { configVersion: 2, plugins: {} }, projectRoot: project, modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: Object.assign(() => ({}), { schema: () => declaration }) });
    const ready = runtime.whenConfigurationReady();
    const starting = runtime.start();
    try {
      await ready;
      await setupEntered;
      expect(runtime.snapshot.generation).toBe(0);
      const initial = runtime.configurationSchemas.get(project)!;
      declaration.properties.count.default = 99;
      expect(initial.properties).toMatchObject({ count: { default: 1 } });
      expect(Object.isFrozen(initial.properties)).toBe(true);
      finish();
      const committed = await starting;
      expect(committed.tree.get(committed.root)?.configSchema?.properties).toMatchObject({ count: { default: 1 } });
    } finally {
      finish?.();
      await runtime.stop();
    }
  });

  it('rejects metadata waiters on initial composition failure and stop before initialization', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root',
      config: { toJsonSchema() { throw new Error('configuration preflight failed'); } } }) });
    const runtime = new RootRuntime({ config: { configVersion: 2, plugins: {} }, projectRoot: project, modules,
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    const waiting = expect(runtime.whenConfigurationReady()).rejects.toThrow('configuration preflight failed');
    await expect(runtime.start()).rejects.toThrow('configuration preflight failed');
    await waiting;
    await runtime.stop();
    const stopped = new RootRuntime({ config: { configVersion: 2, plugins: {} }, projectRoot: project, modules: new FakeModuleRuntime(),
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    const stopping = expect(stopped.whenConfigurationReady()).rejects.toThrow('stopped before configuration initialization');
    await expect(stopped.stop()).rejects.toThrow('Cannot stop RootController from idle');
    await stopping;
  });

  it('rejects metadata waiters when stop aborts an in-flight configuration preflight', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    let entered!: () => void;
    let release!: () => void;
    const loading = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const originalLoad = modules.load.bind(modules);
    modules.load = async <T>(source: string): Promise<T> => {
      entered();
      await held;
      return originalLoad<T>(source);
    };
    const runtime = new RootRuntime({ config: { configVersion: 2, plugins: {} }, projectRoot: project, modules,
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    const waiting = expect(runtime.whenConfigurationReady()).rejects.toThrow('stopped before configuration initialization');
    const starting = runtime.start();
    const aborted = expect(starting).rejects.toThrow('Root lifecycle is stopping');
    await loading;
    const stopping = runtime.stop();
    await waiting;
    release();
    await aborted;
    await stopping;
  });

  it('commits validated declaration metadata and keeps the old generation on invalid config', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const schema = Schema.object({ count: Schema.number().min(1).default(2), apiKey: Schema.string().secret() });
    const configs: unknown[] = [];
    const pluginSource = join(project, 'plugin.ts');
    modules.set(pluginSource, { default: definePlugin({ name: 'root', config: schema, setup({ config }) { configs.push(config.get()); } }) });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), { default: defineCommand({ execute: () => 'ok' }) });
    const configPath = join(project, 'zhin.config.json');
    await writeJson(configPath, { configVersion: 2, plugins: {}, plugin: { count: 3 } });
    const runtime = new RootRuntime({ projectRoot: project, modules,
      environment: { name: 'test', mode: 'test', platform: 'node' }, config: { configVersion: 2, plugins: {}, plugin: { count: 3 } } });
    try {
      const first = await runtime.start();
      expect(configs).toEqual([{ count: 3 }]);
      const committed = first.tree.get(first.root)!.configSchema!;
      expect(committed.properties).toMatchObject({ count: { minimum: 1, default: 2 }, apiKey: { writeOnly: true } });
      schema.description('new metadata');
      expect(committed.description).toBeUndefined();
      await writeJson(configPath, { configVersion: 2, plugins: {}, plugin: { count: 0 } });
      await expect(runtime.patchConfig([{ op: 'set', path: ['plugin', 'count'], value: 0 }])).rejects.toThrow('Invalid Plugin config');
      expect(runtime.snapshot).toBe(first);
      expect(configs).toHaveLength(1);
      await writeJson(configPath, { configVersion: 2, plugins: {}, plugin: { count: 4 } });
      await runtime.patchConfig([{ op: 'set', path: ['plugin', 'count'], value: 4 }]);
      expect(runtime.snapshot.generation).toBe(2);
      expect(configs).toEqual([{ count: 3 }, { count: 4 }]);
      expect(runtime.snapshot.tree.get(first.root)!.configSchema!.description).toBe('new metadata');
    } finally { await runtime.stop(); }
  });

  it('loads a static graph, executes a discovered Command, and isolates HMR leases', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const greeting = createToken<string>('test.greeting');
    const pluginSource = join(project, 'plugin.ts');
    const featureSource = join(project, 'packages/command/index.ts');
    const commandSource = join(project, 'commands/gh/issue/list/index.ts');
    let setupCalls = 0;
    let resourceDisposals = 0;
    let readCandidate: (() => RuntimeSnapshot) | undefined;
    let handoffCandidate: RuntimeSnapshot | undefined;
    modules.set(pluginSource, {
      default: definePlugin({
        name: 'root',
        requires: [greeting, runtimeEnvironmentToken],
        setup() {
          setupCalls += 1;
        },
      }),
    });
    modules.set(featureSource, {
      default: commandFeature,
    });
    modules.set(commandSource, {
      default: defineCommand({
        execute: ({ use }) => `${use(greeting)} ${use(runtimeEnvironmentToken).mode} v1`,
      }),
    });

    const runtime = new RootRuntime({ config: { configVersion: 2, plugins: {} },
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources, readCandidateSnapshot, handoff }) {
        readCandidate = readCandidateSnapshot;
        expect(() => readCandidate!()).toThrow('not projected yet');
        handoff.add({ activateNext() { handoffCandidate = readCandidate!(); } });
        resources.provide(greeting, 'hello', () => {
          resourceDisposals += 1;
        });
      },
    });
    const committedWorlds: number[] = [];
    runtime.onGenerationCommit(({ current }) => {
      expect(runtime.snapshot).toBe(current.snapshot);
      expect(runtime.sourceOwnership).toBe(current.state.ownership);
      committedWorlds.push(current.snapshot.generation);
    });
    const first = await runtime.start();
    expect(handoffCandidate).toEqual(first);
    expect(readCandidate!()).toBe(handoffCandidate);
    expect('controller' in runtime).toBe(false);
    expect('commit' in runtime.snapshots).toBe(false);
    const oldLease = runtime.snapshots.acquire();

    await expect(commandIndex(first).execute('gh issue list')).resolves.toBe('hello test v1');
    expect(setupCalls).toBe(1);
    expect(runtime.sourceOwnership.recordsFor(commandSource)).toEqual([
      expect.objectContaining({ role: 'capability', owner: 'root' }),
    ]);
    modules.set(commandSource, {
      default: defineCommand({
        execute: ({ use }) => `${use(greeting)} ${use(runtimeEnvironmentToken).mode} v2`,
      }),
    });
    const errors: unknown[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired: () => undefined,
      onError: (error) => {
        errors.push(error);
      },
    });
    await hmr.enqueue(commandSource);
    const second = runtime.snapshot;

    expect(second.generation).toBe(2);
    expect(modules.invalidated).toEqual([commandSource]);
    // Read the declaration before config validation, then assemble it; setup runs once.
    expect(modules.loadCount(pluginSource)).toBe(2);
    expect(modules.loadCount(featureSource)).toBe(1);
    expect(modules.loadCount(commandSource)).toBe(2);
    expect(setupCalls).toBe(1);
    expect(resourceDisposals).toBe(0);
    expect(errors).toEqual([]);
    await expect(commandIndex(second).execute('gh issue list')).resolves.toBe('hello test v2');
    await expect(commandIndex(oldLease.value).execute('gh issue list')).resolves.toBe(
      'hello test v1',
    );

    modules.set(commandSource, { default: { execute: 'invalid' } });
    await expect(hmr.enqueue(commandSource)).rejects.toBeInstanceOf(TypeError);
    expect(runtime.snapshot).toBe(second);
    expect(runtime.snapshot.generation).toBe(2);
    expect(setupCalls).toBe(1);
    expect(resourceDisposals).toBe(0);
    expect(errors).toHaveLength(1);

    await rm(commandSource);
    await hmr.enqueue(commandSource);
    expect(runtime.snapshot.generation).toBe(3);
    expect(commandIndex(runtime.snapshot).has('gh issue list')).toBe(false);
    expect(setupCalls).toBe(1);
    expect(resourceDisposals).toBe(0);
    expect(committedWorlds).toEqual([1, 2, 3]);

    oldLease.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(resourceDisposals).toBe(0);
    const stopping = runtime.stop();
    expect(runtime.stop()).toBe(stopping);
    await stopping;
    expect(resourceDisposals).toBe(1);
    expect(modules.closed).toBe(true);
    expect(modules.closeCalls).toBe(1);
  });

  it('replays the same failed stop outcome without closing modules twice', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root' }),
    });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), {
      default: defineCommand({ execute: () => 'ok' }),
    });
    modules.closeError = new Error('module close failed');
    const runtime = new RootRuntime({ config: { configVersion: 2, plugins: {} },
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();

    const first = runtime.stop();
    expect(runtime.stop()).toBe(first);
    await expect(first).rejects.toThrow('module close failed');
    await expect(runtime.stop()).rejects.toThrow('module close failed');
    expect(modules.closeCalls).toBe(1);
  });

  it('aborts candidate Plugin setup before waiting for Root Stop', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    let entered!: () => void;
    const setupEntered = new Promise<void>((resolve) => { entered = resolve; });
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({
        name: 'root',
        config: Schema.object({ label: Schema.string().default('pending login') }),
        setup({ signal }) {
          entered();
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      }),
    });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/gh/issue/list/index.ts'), {
      default: defineCommand({ execute: () => 'ok' }),
    });
    const runtime = new RootRuntime({ config: { configVersion: 2, plugins: {} },
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });

    const starting = runtime.start();
    await setupEntered;
    expect(runtime.snapshot.generation).toBe(0);
    expect(runtime.configurationSchemas.get(project)!.properties).toMatchObject({ label: { default: 'pending login' } });
    const stopping = runtime.stop();
    await expect(starting).rejects.toThrow('stopping');
    await expect(stopping).resolves.toBeUndefined();
    expect(modules.closed).toBe(true);
  });
});

function commandIndex(snapshot: RuntimeSnapshot): CommandIndex {
  const index = snapshot.projections.get(commandFeatureId);
  if (!(index instanceof CommandIndex)) throw new Error('Missing Command projection');
  return index;
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();
  readonly invalidated: string[] = [];
  closed = false;
  closeCalls = 0;
  closeError?: Error;

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    this.#loads.set(source, (this.#loads.get(source) ?? 0) + 1);
    return this.#modules.get(source) as T;
  }

  loadCount(source: string): number {
    return this.#loads.get(source) ?? 0;
  }

  affectedSources(source: string): readonly string[] {
    return [source];
  }

  invalidate(source: string): void {
    this.invalidated.push(source);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.closed = true;
    if (this.closeError) throw this.closeError;
  }
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-runtime-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/command': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [{ package: '@test/command' }],
    },
  });
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@test/command',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  await touch(join(root, 'plugin.ts'));
  await touch(join(root, 'packages/command/index.ts'));
  await touch(join(root, 'commands/gh/issue/list/index.ts'));
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
