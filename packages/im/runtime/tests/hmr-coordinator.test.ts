import { describe, expect, it } from 'vitest';
import { capabilityId, childPluginId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  DEFAULT_WATCH_DEBOUNCE_MS,
  HmrCoordinator,
  SourceOwnershipIndex,
  type GenerationInvalidationPlan,
  type ManifestFieldChange,
  type ModuleRuntime,
  type ProcessInvalidationPlan,
} from '../src/index.js';

const root = rootPluginId();
const child = childPluginId(root, 'child');
const command = featureId('zhin.command');

describe('HmrCoordinator', () => {
  it('filters automatic events without blocking explicit reload requests', async () => {
    const source = '/project/commands/status/index.ts';
    const config = '/project/zhin.config.yml';
    const modules = new WatchingFakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    const ownership = ownershipFor(source, '/project');
    ownership.addPackageRoot('/project', root);
    let accepted!: () => void;
    const acceptedReload = new Promise<void>(resolve => { accepted = resolve; });
    const coordinator = new HmrCoordinator({
      modules, ownership: () => ownership,
      acceptWatchedSource: path => path === config,
      runtime: { reload: async plan => { plans.push(plan); } },
      onRestartRequired: () => { throw new Error('Unexpected restart'); },
      onError: error => { throw error; },
      onReload: plan => { if (plan.changed.includes(config)) accepted(); },
    });
    const stop = coordinator.start();
    try {
      modules.emit(source);
      // Enqueue is a completion barrier for all events emitted above; it also
      // proves an explicit source reload remains available with config-only watch.
      await coordinator.enqueue(source);
      expect(plans.map(plan => plan.changed)).toEqual([[source]]);
      expect(modules.invalidated).toEqual([source]);
      modules.emit(config);
      await acceptedReload;
      expect(plans.map(plan => plan.changed)).toEqual([[source], [config]]);
      expect(modules.invalidated).toEqual([source, config]);
      modules.emit(source);
      await coordinator.stop();
      expect(plans).toHaveLength(2);
    } finally { await stop(); }
  });

  it('batches synchronous watcher events into one serialized reload', async () => {
    const first = capabilityId(child, command, 'first');
    const second = capabilityId(child, command, 'second');
    const ownership = new SourceOwnershipIndex();
    ownership.addPackageRoot('/project/plugins/child', child);
    ownership.add({
      source: '/project/plugins/child/commands/first/index.ts',
      role: 'capability',
      owner: child,
      capability: first,
      feature: command,
    });
    ownership.add({
      source: '/project/plugins/child/commands/second/index.ts',
      role: 'capability',
      owner: child,
      capability: second,
      feature: command,
    });
    const modules = new FakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    const reloadEvents: Array<{
      readonly plan: GenerationInvalidationPlan;
      readonly durationMs: number;
    }> = [];
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownership,
      runtime: {
        async reload(plan) {
          plans.push(plan);
        },
      },
      onRestartRequired() {},
      onError() {},
      onReload(plan, durationMs) { reloadEvents.push({ plan, durationMs }); },
    });

    const firstEvent = coordinator.enqueue('/project/plugins/child/commands/first/index.ts');
    const secondEvent = coordinator.enqueue('/project/plugins/child/commands/second/index.ts');
    await Promise.all([firstEvent, secondEvent]);

    expect(plans).toHaveLength(1);
    expect(reloadEvents).toHaveLength(1);
    expect(reloadEvents[0]?.plan).toBe(plans[0]);
    expect(reloadEvents[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(plans[0]?.slots).toEqual([first, second]);
    expect(modules.invalidated).toEqual([
      '/project/plugins/child/commands/first/index.ts',
      '/project/plugins/child/commands/second/index.ts',
    ]);
  });

  it('reports process-level changes without reloading modules', async () => {
    const modules = new FakeModules();
    const restarts: ProcessInvalidationPlan[] = [];
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => new SourceOwnershipIndex(),
      runtime: {
        async reload() {
          throw new Error('must not reload');
        },
      },
      onRestartRequired(plan) {
        restarts.push(plan);
      },
      onError() {},
    });

    await coordinator.enqueue('/project/pnpm-lock.yaml');

    expect(restarts).toHaveLength(1);
    expect(modules.invalidated).toEqual([]);
  });

  it('honors a module loader process boundary before invalidation', async () => {
    const source = '/project/src/helper.ts';
    const modules = new FakeModules();
    modules.processSources.add(source);
    const restarts: ProcessInvalidationPlan[] = [];
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => new SourceOwnershipIndex(),
      runtime: { reload: async () => { throw new Error('must not reload'); } },
      onRestartRequired(plan) { restarts.push(plan); },
      onError() {},
    });

    await coordinator.enqueue(source);

    expect(restarts).toEqual([expect.objectContaining({
      kind: 'process',
      changed: [source],
    })]);
    expect(modules.invalidated).toEqual([]);
  });

  it('routes a generation reload escalation through the process port', async () => {
    const source = '/project/commands/status/index.ts';
    const ownership = new SourceOwnershipIndex();
    ownership.add({
      source,
      role: 'capability',
      owner: root,
      capability: capabilityId(root, command, 'status'),
      feature: command,
    });
    const restarts: ProcessInvalidationPlan[] = [];
    const errors: unknown[] = [];
    const reloadEvents: GenerationInvalidationPlan[] = [];
    const modules = new FakeModules();
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownership,
      runtime: {
        async reload() {
          return {
            kind: 'process',
            changed: [source],
            reasons: ['package runtime ABI changed: @test/root'],
          };
        },
      },
      onRestartRequired(plan) { restarts.push(plan); },
      onError(error) { errors.push(error); },
      onReload(plan) { reloadEvents.push(plan); },
    });

    await coordinator.enqueue(source);

    expect(restarts).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(reloadEvents).toEqual([]);
    expect(modules.generationBegins).toBe(1);
    expect(modules.generationCommits).toEqual([]);
    expect(modules.generationRollbacks).toBe(1);
  });

  it('updates module sources and watch roots only after a generation reload commits', async () => {
    const source = '/project/commands/status/index.ts';
    const initial = ownershipFor(source, '/project');
    const committed = ownershipFor(source, '/workspace/plugins/sibling');
    let ownership = initial;
    const modules = new FakeModules();
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownership,
      runtime: {
        async reload() {
          ownership = committed;
        },
      },
      onRestartRequired() {},
      onError() {},
    });

    await coordinator.enqueue(source);

    expect(modules.generationBegins).toBe(1);
    expect(modules.generationCommits).toEqual([[source]]);
    expect(modules.generationRollbacks).toBe(0);
    expect(modules.watchRootUpdates).toEqual([
      [{ root: '/workspace/plugins/sibling', source: 'workspace' }],
    ]);
  });

  it('rolls back when opening the module generation transaction fails', async () => {
    const source = '/project/commands/status/index.ts';
    const failure = new Error('stale module transaction');
    const modules = new FakeModules();
    modules.beginFailure = failure;
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownershipFor(source, '/project'),
      runtime: { reload: async () => { throw new Error('must not reload'); } },
      onRestartRequired() {},
      onError() {},
    });

    await expect(coordinator.enqueue(source)).rejects.toBe(failure);
    expect(modules.generationBegins).toBe(1);
    expect(modules.generationRollbacks).toBe(1);
    expect(modules.generationCommits).toEqual([]);
  });

  it('does not commit module metadata when watch-root replacement fails', async () => {
    const source = '/project/commands/status/index.ts';
    const failure = new Error('watch root replacement failed');
    const modules = new FakeModules();
    modules.watchRootFailure = failure;
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownershipFor(source, '/workspace/plugins/sibling'),
      runtime: { reload: async () => undefined },
      onRestartRequired() {},
      onError() {},
    });

    await expect(coordinator.enqueue(source)).rejects.toBe(failure);
    expect(modules.generationBegins).toBe(1);
    expect(modules.generationCommits).toEqual([]);
    expect(modules.generationRollbacks).toBe(1);
  });

  it('reports a failed reload and rejects every waiter in its batch', async () => {
    const ownership = new SourceOwnershipIndex();
    ownership.add({
      source: '/project/commands/status/index.ts',
      role: 'capability',
      owner: root,
      capability: capabilityId(root, command, 'status'),
      feature: command,
    });
    const reported: unknown[] = [];
    const failure = new Error('prepare failed');
    const modules = new FakeModules();
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownership,
      runtime: { reload: async () => { throw failure; } },
      onRestartRequired() {},
      onError(error) { reported.push(error); },
    });

    const first = coordinator.enqueue('/project/commands/status/index.ts');
    const second = coordinator.enqueue('/project/commands/status/index.ts');

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(reported).toEqual([failure]);
    expect(modules.generationBegins).toBe(1);
    expect(modules.generationCommits).toEqual([]);
    expect(modules.generationRollbacks).toBe(1);
  });

  it('waits for an in-flight reload before stop settles and rejects later work', async () => {
    const source = '/project/commands/status/index.ts';
    const ownership = ownershipFor(source, '/project');
    let finishReload!: () => void;
    const reloadBlocked = new Promise<void>((resolve) => { finishReload = resolve; });
    let reloadStarted!: () => void;
    const started = new Promise<void>((resolve) => { reloadStarted = resolve; });
    const coordinator = new HmrCoordinator({
      modules: new FakeModules(),
      ownership: () => ownership,
      runtime: {
        async reload() {
          reloadStarted();
          await reloadBlocked;
        },
      },
      onRestartRequired() {},
      onError() {},
    });

    const reload = coordinator.enqueue(source);
    await started;
    const stopping = coordinator.stop();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    await expect(coordinator.enqueue(source)).rejects.toThrow('stopping');

    finishReload();
    await Promise.all([reload, stopping]);
    expect(stopped).toBe(true);
  });

  it('awaits asynchronous watcher disposal and replays the same stop outcome', async () => {
    const modules = new FakeModules();
    let dispose!: () => void;
    const disposed = new Promise<void>(resolve => { dispose = resolve; });
    let calls = 0;
    modules.watch = () => () => { calls++; return disposed; };
    const coordinator = new HmrCoordinator({ modules, ownership: () => ownershipFor('/project/commands/status/index.ts', '/project'), runtime: { async reload() {} }, onRestartRequired() {}, onError() {} });
    coordinator.start();
    const stopping = coordinator.stop();
    expect(coordinator.stop()).toBe(stopping);
    let settled = false; void stopping.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(calls).toBe(1);
    dispose(); await stopping; expect(settled).toBe(true);
  });

  it('drains admitted reloads even when watcher disposal throws', async () => {
    const source = '/project/commands/status/index.ts';
    const failure = new Error('watcher cleanup failed');
    const modules = new FakeModules();
    let calls = 0; modules.watch = () => () => { calls++; throw failure; };
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    let announce!: () => void; const started = new Promise<void>(resolve => { announce = resolve; });
    const coordinator = new HmrCoordinator({ modules, ownership: () => ownershipFor(source, '/project'), runtime: { async reload() { announce(); await blocked; } }, onRestartRequired() {}, onError() {} });
    coordinator.start(); const reload = coordinator.enqueue(source); await started;
    const stopping = coordinator.stop(); const rejected = expect(stopping).rejects.toBe(failure);
    let settled = false; void stopping.catch(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    await expect(coordinator.enqueue(source)).rejects.toThrow('stopping');
    release(); await Promise.all([reload, rejected]);
    expect(coordinator.stop()).toBe(stopping); expect(calls).toBe(1);
  });

  it('reports post-commit observer failure without rejecting the reload', async () => {
    const source = '/project/commands/status/index.ts';
    const reported: unknown[] = [];
    const failure = new Error('console projection failed');
    const coordinator = new HmrCoordinator({
      modules: new FakeModules(),
      ownership: () => ownershipFor(source, '/project'),
      runtime: { reload: async () => undefined },
      onRestartRequired() {},
      onError(error) { reported.push(error); },
      onReload() { throw failure; },
    });

    await expect(coordinator.enqueue(source)).resolves.toBeUndefined();
    expect(reported).toEqual([failure]);
  });

  it('stops accepting generation work after a process restart is required', async () => {
    const source = '/project/pnpm-lock.yaml';
    let releaseRestart!: () => void;
    const restartBlocked = new Promise<void>((resolve) => { releaseRestart = resolve; });
    let restartStarted!: () => void;
    const started = new Promise<void>((resolve) => { restartStarted = resolve; });
    const coordinator = new HmrCoordinator({
      modules: new FakeModules(),
      ownership: () => new SourceOwnershipIndex(),
      runtime: { reload: async () => undefined },
      async onRestartRequired() {
        restartStarted();
        await restartBlocked;
      },
      onError() {},
    });

    const restart = coordinator.enqueue(source);
    await restart;
    await started;
    await expect(coordinator.enqueue('/project/plugin.ts')).rejects.toThrow('process restart');
    releaseRestart();
  });

  it('allows a restart observer to drain the coordinator without self-waiting', async () => {
    let resolveStopped!: () => void;
    const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
    const coordinator = new HmrCoordinator({
      modules: new FakeModules(),
      ownership: () => new SourceOwnershipIndex(),
      runtime: { reload: async () => undefined },
      async onRestartRequired() {
        await coordinator.stop();
        resolveStopped();
      },
      onError() {},
    });

    await coordinator.enqueue('/project/pnpm-lock.yaml');
    await stopped;
  });

  it('reports a synchronous restart observer failure without reopening admission', async () => {
    const failure = new Error('restart observer failed');
    const reported: unknown[] = [];
    const coordinator = new HmrCoordinator({
      modules: new FakeModules(),
      ownership: () => new SourceOwnershipIndex(),
      runtime: { reload: async () => undefined },
      onRestartRequired() { throw failure; },
      onError(error) { reported.push(error); },
    });

    await coordinator.enqueue('/project/pnpm-lock.yaml');
    await Promise.resolve();
    await Promise.resolve();
    expect(reported).toEqual([failure]);
    await expect(coordinator.enqueue('/project/plugin.ts')).rejects.toThrow('process restart');
  });
});

describe('HmrCoordinator watch debounce (#1250)', () => {
  const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

  it('merges a sed -i style burst (events ~250 ms apart) into one reload by default', async () => {
    expect(DEFAULT_WATCH_DEBOUNCE_MS).toBe(300);
    const source = '/project/commands/status/index.ts';
    const modules = new WatchingFakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    let reloaded!: () => void;
    const done = new Promise<void>((resolve) => { reloaded = resolve; });
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownershipFor(source, '/project'),
      runtime: { async reload(plan) { plans.push(plan); } },
      onRestartRequired() {},
      onError() {},
      onReload() { reloaded(); },
    });
    const stop = coordinator.start();
    try {
      // Temp file write, then rename onto the source: two events for one edit.
      modules.emit(source);
      await sleep(250);
      expect(plans).toHaveLength(0);
      modules.emit(source);
      await done;
      await sleep(400);
      expect(plans).toHaveLength(1);
      expect(plans[0]?.changed).toEqual([source]);
    } finally { await stop(); }
  });

  it('merges different files of one batch into a single reload request', async () => {
    const first = '/project/plugins/child/commands/first/index.ts';
    const second = '/project/plugins/child/commands/second/index.ts';
    const ownership = new SourceOwnershipIndex();
    ownership.addPackageRoot('/project/plugins/child', child);
    for (const [source, name] of [[first, 'first'], [second, 'second']] as const) {
      ownership.add({ source, role: 'capability', owner: child, capability: capabilityId(child, command, name), feature: command });
    }
    const modules = new WatchingFakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    let reloaded!: () => void;
    const done = new Promise<void>((resolve) => { reloaded = resolve; });
    const coordinator = new HmrCoordinator({
      modules, ownership: () => ownership, watchDebounceMs: 50,
      runtime: { async reload(plan) { plans.push(plan); } },
      onRestartRequired() {}, onError() {}, onReload() { reloaded(); },
    });
    const stop = coordinator.start();
    try {
      modules.emit(first);
      await sleep(20);
      modules.emit(second);
      await sleep(20);
      modules.emit(first);
      await done;
      await sleep(100);
      expect(plans).toHaveLength(1);
      expect(plans[0]?.changed).toEqual([first, second]);
    } finally { await stop(); }
  });

  it('never delays explicit enqueue requests, and stop drops events still waiting for the window', async () => {
    const source = '/project/commands/status/index.ts';
    const modules = new WatchingFakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownershipFor(source, '/project'),
      watchDebounceMs: 10_000,
      runtime: { async reload(plan) { plans.push(plan); } },
      onRestartRequired() {},
      onError() {},
    });
    coordinator.start();
    await coordinator.enqueue(source);
    expect(plans).toHaveLength(1);
    modules.emit(source);
    await coordinator.stop();
    expect(plans).toHaveLength(1);
  });
  it('reloads within the max wait while events keep arriving', async () => {
    const source = '/project/commands/status/index.ts';
    const modules = new WatchingFakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownershipFor(source, '/project'),
      watchDebounceMs: 100,
      watchDebounceMaxWaitMs: 250,
      runtime: { async reload(plan) { plans.push(plan); } },
      onRestartRequired() {},
      onError() {},
    });
    const stop = coordinator.start();
    try {
      // A write every 40 ms never leaves a 100 ms quiet period.
      const startedAt = performance.now();
      while (performance.now() - startedAt < 700) {
        modules.emit(source);
        await sleep(40);
      }
      expect(plans.length).toBeGreaterThanOrEqual(2);
    } finally { await stop(); }
  });

  it('reloads once when an explicit enqueue covers a debounced watch event of the same path', async () => {
    const source = '/project/commands/status/index.ts';
    const modules = new WatchingFakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownershipFor(source, '/project'),
      watchDebounceMs: 50,
      runtime: { async reload(plan) { plans.push(plan); } },
      onRestartRequired() {},
      onError() {},
    });
    const stop = coordinator.start();
    try {
      modules.emit(source);
      await coordinator.enqueue(source);
      await sleep(150);
      expect(plans).toHaveLength(1);
    } finally { await stop(); }
  });
});

describe('HmrCoordinator package.json field filter (#1250)', () => {
  const manifest = '/project/package.json';
  const base = { name: 'bot', version: '1.0.0', type: 'module', scripts: { start: 'zhin start' },
    dependencies: { 'zhin.js': '^1.2.0' }, pnpm: { overrides: {}, onlyBuiltDependencies: [] } };

  function setup(processPlan = false) {
    const files = new Map<string, string>([[manifest, JSON.stringify(base)]]);
    const modules = new WatchingFakeModules();
    const ownership = ownershipFor('/project/commands/status/index.ts', '/project');
    ownership.add({ source: manifest, role: 'manifest', owner: root });
    const plans: GenerationInvalidationPlan[] = [];
    const ignored: ManifestFieldChange[] = [];
    const restarts: ProcessInvalidationPlan[] = [];
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    const coordinator = new HmrCoordinator({
      modules, ownership: () => ownership, watchDebounceMs: 0,
      readManifest: (source) => {
        const text = files.get(source);
        if (text === undefined) throw new Error('ENOENT');
        return text;
      },
      runtime: {
        async reload(plan) {
          plans.push(plan);
          if (processPlan) return { kind: 'process', changed: plan.changed, reasons: ['package runtime ABI changed: bot'] };
        },
      },
      onRestartRequired(plan) { restarts.push(plan); settle(); },
      onManifestIgnored(change) { ignored.push(change); settle(); },
      onReload() { settle(); },
      onError(error) { throw error; },
    });
    const stop = coordinator.start();
    const write = (value: unknown) => files.set(manifest, JSON.stringify(value));
    return { coordinator, modules, plans, ignored, restarts, settled, stop, write };
  }

  it('drops a watched change of scripts / description without reload or restart', async () => {
    const f = setup();
    try {
      f.write({ ...base, scripts: { start: 'zhin start --foreground' }, description: 'x', pnpm: { ...base.pnpm, onlyBuiltDependencies: ['esbuild'] } });
      f.modules.emit(manifest);
      await f.settled;
      expect(f.plans).toEqual([]);
      expect(f.restarts).toEqual([]);
      expect(f.ignored).toEqual([{ source: manifest, fields: ['description', 'pnpm.onlyBuiltDependencies', 'scripts'], runtimeFields: [] }]);
    } finally { await f.stop(); }
  });

  it.each([
    ['dependencies', { dependencies: { 'zhin.js': '^1.3.0' } }],
    ['pnpm.overrides', { pnpm: { ...base.pnpm, overrides: { ws: '8.18.0' } } }],
    ['zhin', { zhin: { protocol: 1, type: 'plugin' } }],
    ['exports', { exports: './lib/index.js' }],
  ] as const)('keeps the normal reload path when %s changes', async (_name, patch) => {
    const f = setup();
    try {
      f.write({ ...base, scripts: { build: 'tsc' }, ...patch });
      f.modules.emit(manifest);
      await f.settled;
      expect(f.ignored).toEqual([]);
      expect(f.plans).toHaveLength(1);
      expect(f.plans[0]?.manifestSources).toEqual([manifest]);
      expect(f.plans[0]?.changed).toEqual([manifest]);
    } finally { await f.stop(); }
  });

  it('attaches the changed fields to the restart plan so the restart can be explained', async () => {
    const f = setup(true);
    try {
      f.write({ ...base, type: 'commonjs', scripts: {} });
      f.modules.emit(manifest);
      await f.settled;
      expect(f.restarts).toHaveLength(1);
      expect(f.restarts[0]?.manifestChanges).toEqual([{ source: manifest, fields: ['scripts', 'type'], runtimeFields: ['type'] }]);
    } finally { await f.stop(); }
  });

  it('never drops an explicitly requested manifest reload', async () => {
    const f = setup();
    try {
      f.write({ ...base, scripts: {} });
      await f.coordinator.enqueue(manifest);
      expect(f.ignored).toEqual([]);
      expect(f.plans).toHaveLength(1);
    } finally { await f.stop(); }
  });
});

describe('HmrCoordinator package.json baselines (#1250)', () => {
  const rootManifest = '/project/package.json';
  const childManifest = '/project/plugins/child/package.json';
  const manifest = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name, version: '1.0.0', type: 'module', ...extra });

  function setup(options: { reload?: (plan: GenerationInvalidationPlan, files: Map<string, string>) => Promise<void> | void; mountChild?: boolean } = {}) {
    const files = new Map<string, string>([[rootManifest, manifest('bot')], [childManifest, manifest('@test/child')]]);
    const modules = new WatchingFakeModules();
    const committed = ownershipFor('/project/commands/status/index.ts', '/project');
    committed.add({ source: rootManifest, role: 'manifest', owner: root });
    const mounted = (): SourceOwnershipIndex => {
      const next = ownershipFor('/project/commands/status/index.ts', '/project');
      next.add({ source: rootManifest, role: 'manifest', owner: root });
      next.addPackageRoot('/project/plugins/child', child);
      next.add({ source: childManifest, role: 'manifest', owner: child });
      next.addChildPluginManifest(childManifest);
      return next;
    };
    let ownership = options.mountChild === false ? committed : mounted();
    const plans: GenerationInvalidationPlan[] = [];
    const ignored: ManifestFieldChange[] = [];
    const errors: unknown[] = [];
    const coordinator = new HmrCoordinator({
      modules, ownership: () => ownership, watchDebounceMs: 0,
      readManifest: (source) => {
        const text = files.get(source);
        if (text === undefined) throw new Error('ENOENT');
        return text;
      },
      runtime: {
        async reload(plan) {
          plans.push(plan);
          await options.reload?.(plan, files);
        },
      },
      onRestartRequired() {},
      onManifestIgnored(change) { ignored.push(change); },
      onError(error) { errors.push(error); },
    });
    const stop = coordinator.start();
    return {
      coordinator, modules, plans, ignored, errors, stop, files,
      mount: () => { ownership = mounted(); },
    };
  }

  const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 20); });

  it('reloads for a version change of a mounted child Plugin, but ignores the Root project version', async () => {
    const f = setup();
    try {
      f.files.set(rootManifest, manifest('bot', { version: '1.1.0' }));
      f.modules.emit(rootManifest);
      await settle();
      expect(f.plans).toEqual([]);
      expect(f.ignored).toEqual([{ source: rootManifest, fields: ['version'], runtimeFields: [] }]);

      f.files.set(childManifest, JSON.stringify({ name: '@test/child', version: '1.1.0', type: 'module' }));
      f.modules.emit(childManifest);
      await settle();
      expect(f.plans).toHaveLength(1);
      expect(f.plans[0]?.manifestSources).toEqual([childManifest]);
    } finally { await f.stop(); }
  });

  it('puts the baseline back when the reload fails, so the same edit is not ignored next time', async () => {
    let failures = 1;
    const f = setup({ reload: () => { if (failures-- > 0) throw new Error('reload failed'); } });
    try {
      f.files.set(childManifest, manifest('@test/child', { dependencies: { ws: '^8.0.0' } }));
      f.modules.emit(childManifest);
      await settle();
      expect(f.errors).toHaveLength(1);
      // The file did not change again; the retry still reports the dependency change.
      f.modules.emit(childManifest);
      await settle();
      expect(f.ignored).toEqual([]);
      expect(f.plans).toHaveLength(2);
      expect(f.plans[1]?.manifestSources).toEqual([childManifest]);
    } finally { await f.stop(); }
  });

  it('does not adopt a newly mounted manifest edited while the generation reloaded', async () => {
    let edited = false;
    const f = setup({
      mountChild: false,
      reload: (_plan, files) => {
        if (edited) return;
        edited = true;
        // The new generation mounts the child; its manifest is edited before the commit finishes.
        files.set(childManifest, manifest('@test/child', { scripts: { build: 'tsc' } }));
        f.mount();
        f.modules.emit(childManifest);
      },
    });
    try {
      await f.coordinator.enqueue('/project/commands/status/index.ts');
      await settle();
      expect(f.ignored).toEqual([]);
      expect(f.plans.map((plan) => plan.changed)).toEqual([['/project/commands/status/index.ts'], [childManifest]]);
    } finally { await f.stop(); }
  });
});

describe('HmrCoordinator editor temp files (#857)', () => {
  it('drops watcher events for editor temp files but still reloads the real source', async () => {
    const source = '/project/commands/status/index.ts';
    const modules = new WatchingFakeModules();
    const plans: GenerationInvalidationPlan[] = [];
    let reloaded!: () => void;
    const done = new Promise<void>((resolve) => { reloaded = resolve; });
    const coordinator = new HmrCoordinator({
      modules,
      ownership: () => ownershipFor(source, '/project'),
      runtime: { async reload(plan) { plans.push(plan); } },
      onRestartRequired() {},
      onError() {},
      onReload() { reloaded(); },
    });
    const stop = coordinator.start();
    modules.emit('/project/commands/status/.!97910!index.ts');
    modules.emit('/project/commands/status/.index.ts.swp');
    modules.emit('/project/commands/status/4913');
    modules.emit(source);
    await done;
    await stop();

    expect(plans).toHaveLength(1);
    expect(plans[0]?.changed).toEqual([source]);
  });
});

class FakeModules implements ModuleRuntime {
  readonly invalidated: string[] = [];
  readonly processSources = new Set<string>();
  readonly generationCommits: unknown[] = [];
  readonly watchRootUpdates: unknown[] = [];
  generationBegins = 0;
  generationRollbacks = 0;
  beginFailure?: Error;
  watchRootFailure?: Error;

  async load<T>(): Promise<T> {
    throw new Error('not used');
  }

  invalidate(source: string): void {
    this.invalidated.push(source);
  }

  requiresProcessRestart(source: string): boolean {
    return this.processSources.has(source);
  }

  beginGeneration(): void {
    this.generationBegins += 1;
    if (this.beginFailure) throw this.beginFailure;
  }

  commitGeneration(sources: readonly string[]): void {
    this.generationCommits.push(sources);
  }

  rollbackGeneration(): void {
    this.generationRollbacks += 1;
  }

  updateWatchRoots(roots: readonly { readonly root: string; readonly source: string }[]): void {
    if (this.watchRootFailure) throw this.watchRootFailure;
    this.watchRootUpdates.push(roots);
  }

  async close(): Promise<void> {}
}

function ownershipFor(source: string, watchRoot: string): SourceOwnershipIndex {
  const ownership = new SourceOwnershipIndex();
  ownership.add({
    source,
    role: 'capability',
    owner: root,
    capability: capabilityId(root, command, 'status'),
    feature: command,
  });
  ownership.addWatchRoot({ root: watchRoot, source: 'workspace' });
  return ownership;
}

class WatchingFakeModules extends FakeModules {
  #listener?: (source: string) => void;

  watch(listener: (source: string) => void): () => void {
    this.#listener = listener;
    return () => { this.#listener = undefined; };
  }

  emit(source: string): void {
    this.#listener?.(source);
  }
}
