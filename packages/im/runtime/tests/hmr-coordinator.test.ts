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
    });

    const firstEvent = coordinator.enqueue('/project/plugins/child/commands/first.ts');
    const secondEvent = coordinator.enqueue('/project/plugins/child/commands/second.ts');
    await Promise.all([firstEvent, secondEvent]);

    expect(plans).toHaveLength(1);
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
    });

    await coordinator.enqueue(source);

    expect(restarts).toHaveLength(1);
    expect(errors).toEqual([]);
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
});

class FakeModules implements ModuleRuntime {
  readonly invalidated: string[] = [];
  readonly processSources = new Set<string>();

  async load<T>(): Promise<T> {
    throw new Error('not used');
  }

  invalidate(source: string): void {
    this.invalidated.push(source);
  }

  requiresProcessRestart(source: string): boolean {
    return this.processSources.has(source);
  }

  async close(): Promise<void> {}
}
