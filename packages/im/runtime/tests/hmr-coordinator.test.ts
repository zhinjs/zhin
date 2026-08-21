import { describe, expect, it } from 'vitest';
import { capabilityId, childPluginId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  HmrCoordinator,
  SourceOwnershipIndex,
  type GenerationInvalidationPlan,
  type ModuleRuntime,
  type ProcessInvalidationPlan,
} from '../src/index.js';

const root = rootPluginId();
const child = childPluginId(root, 'child');
const command = featureId('zhin.command');

describe('HmrCoordinator', () => {
  it('batches synchronous watcher events into one serialized reload', async () => {
    const first = capabilityId(child, command, 'first');
    const second = capabilityId(child, command, 'second');
    const ownership = new SourceOwnershipIndex();
    ownership.addPackageRoot('/project/plugins/child', child);
    ownership.add({
      source: '/project/plugins/child/commands/first.ts',
      role: 'capability',
      owner: child,
      capability: first,
      feature: command,
    });
    ownership.add({
      source: '/project/plugins/child/commands/second.ts',
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

    const firstEvent = coordinator.enqueue('/project/plugins/child/commands/first.ts');
    const secondEvent = coordinator.enqueue('/project/plugins/child/commands/second.ts');
    await Promise.all([firstEvent, secondEvent]);

    expect(plans).toHaveLength(1);
    expect(reloadEvents).toHaveLength(1);
    expect(reloadEvents[0]?.plan).toBe(plans[0]);
    expect(reloadEvents[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(plans[0]?.slots).toEqual([first, second]);
    expect(modules.invalidated).toEqual([
      '/project/plugins/child/commands/first.ts',
      '/project/plugins/child/commands/second.ts',
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
    const source = '/project/commands/status.ts';
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
    const coordinator = new HmrCoordinator({
      modules: new FakeModules(),
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
  });

  it('updates module watch roots only after a generation reload commits', async () => {
    const source = '/project/commands/status.ts';
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

    expect(modules.watchRootUpdates).toEqual([
      [{ root: '/workspace/plugins/sibling', source: 'workspace' }],
    ]);
  });

  it('reports a failed reload and rejects every waiter in its batch', async () => {
    const ownership = new SourceOwnershipIndex();
    ownership.add({
      source: '/project/commands/status.ts',
      role: 'capability',
      owner: root,
      capability: capabilityId(root, command, 'status'),
      feature: command,
    });
    const reported: unknown[] = [];
    const failure = new Error('prepare failed');
    const coordinator = new HmrCoordinator({
      modules: new FakeModules(),
      ownership: () => ownership,
      runtime: { reload: async () => { throw failure; } },
      onRestartRequired() {},
      onError(error) { reported.push(error); },
    });

    const first = coordinator.enqueue('/project/commands/status.ts');
    const second = coordinator.enqueue('/project/commands/status.ts');

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(reported).toEqual([failure]);
  });

  it('waits for an in-flight reload before stop settles and rejects later work', async () => {
    const source = '/project/commands/status.ts';
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

  it('reports post-commit observer failure without rejecting the reload', async () => {
    const source = '/project/commands/status.ts';
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

class FakeModules implements ModuleRuntime {
  readonly invalidated: string[] = [];
  readonly processSources = new Set<string>();
  readonly watchRootUpdates: unknown[] = [];

  async load<T>(): Promise<T> {
    throw new Error('not used');
  }

  invalidate(source: string): void {
    this.invalidated.push(source);
  }

  requiresProcessRestart(source: string): boolean {
    return this.processSources.has(source);
  }

  updateWatchRoots(roots: readonly { readonly root: string; readonly source: string }[]): void {
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
