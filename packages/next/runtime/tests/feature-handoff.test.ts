import { describe, expect, it } from 'vitest';
import {
  DisposeStack,
  RootController,
  featureId,
  rootPluginId,
  type PreparedGeneration,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { defineFeatureProvider } from '@zhin.js/feature-kit';
import { FeatureProjector } from '../src/feature-projector.js';

describe('Feature projection handoff', () => {
  it('joins the generation transaction and defers old projection disposal to leases', async () => {
    const events: string[] = [];
    let version = 0;
    const provider = defineFeatureProvider({
      protocol: 1,
      id: featureId('test.endpoint'),
      authoring: { conventions: [], validate: (value) => value },
      runtime: {
        project() {
          const current = ++version;
          return {
            value: current,
            dispose: () => { events.push(`dispose:${current}`); },
            handoff: {
              quiescePrevious(previous) { events.push(`quiesce:${previous.generation}`); },
              activateNext() { events.push(`activate:${current}`); },
              deactivateNext() { events.push(`deactivate:${current}`); },
              resumePrevious() { events.push(`resume:${current - 1}`); },
              openNext() { events.push(`open:${current}`); },
            },
          };
        },
      },
    });
    const controller = new RootController(emptyState());
    await controller.start((current) => prepare(provider, current.generation + 1));
    const oldLease = controller.snapshots.acquire();
    await controller.transact((current) => prepare(provider, current.generation + 1));

    expect(events).toEqual([
      'activate:1',
      'open:1',
      'quiesce:1',
      'activate:2',
      'open:2',
    ]);
    oldLease.release();
    await Promise.resolve();
    expect(events).toContain('dispose:1');
    await controller.stop();
    expect(events.at(-1)).toBe('dispose:2');
  });

  it('keeps the active snapshot and resumes its Feature after candidate activation fails', async () => {
    const events: string[] = [];
    let version = 0;
    const provider = defineFeatureProvider({
      protocol: 1,
      id: featureId('test.rollback-endpoint'),
      authoring: { conventions: [], validate: (value) => value },
      runtime: {
        project() {
          const current = ++version;
          return {
            value: current,
            dispose: () => { events.push(`dispose:${current}`); },
            handoff: {
              quiescePrevious() { events.push(`quiesce:${current - 1}`); },
              activateNext() {
                events.push(`activate:${current}`);
                if (current === 2) throw new Error('bind failed');
              },
              resumePrevious() { events.push(`resume:${current - 1}`); },
              openNext() { events.push(`open:${current}`); },
            },
          };
        },
      },
    });
    const controller = new RootController(emptyState());
    await controller.start((current) => prepare(provider, current.generation + 1));

    await expect(controller.transact((current) => prepare(
      provider,
      current.generation + 1,
    ))).rejects.toThrow('bind failed');

    expect(controller.generation).toBe(1);
    expect(events).toEqual([
      'activate:1',
      'open:1',
      'quiesce:1',
      'activate:2',
      'resume:1',
      'dispose:2',
    ]);
    await controller.stop();
  });
});

async function prepare(
  provider: ReturnType<typeof defineFeatureProvider>,
  generation: number,
): Promise<PreparedGeneration> {
  const { projections: _projections, ...base } = emptyState();
  const projected = await new FeatureProjector([provider]).project(generation, base);
  const disposers = new DisposeStack();
  for (const dispose of projected.disposers) disposers.add(dispose);
  return {
    snapshot: projected.state,
    handoff: projected.handoff,
    dispose: () => disposers.dispose(),
  };
}

function emptyState(): SnapshotState {
  const root = rootPluginId();
  return {
    root,
    tree: new Map([[root, {
      id: root,
      instanceKey: 'root',
      packageName: '@test/root',
      packageRoot: '/project',
      children: [],
    }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map()]]),
    capabilities: new Map(),
    projections: new Map(),
  };
}
