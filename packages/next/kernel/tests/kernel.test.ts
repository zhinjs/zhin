import { describe, expect, it } from 'vitest';
import {
  DisposeStack,
  RootController,
  Scope,
  SharedLifetime,
  capabilityId,
  childPluginId,
  createToken,
  featureId,
  rootPluginId,
  type SnapshotState,
} from '../src/index.js';

function emptyState(): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
}

describe('next kernel', () => {
  it('accepts segmented Capability local names without relaxing Plugin keys', () => {
    const root = rootPluginId();
    expect(capabilityId(root, featureId('test.command'), 'gh/issue/list')).toContain(
      'gh/issue/list',
    );
    expect(() => capabilityId(root, featureId('test.command'), 'gh//list')).toThrow(
      'Invalid capability local name',
    );
    expect(() => childPluginId(root, 'gh/issue')).toThrow('Invalid plugin instance key');
  });

  it('disposes a shared lifetime only after its final generation lease', async () => {
    let disposed = 0;
    const lifetime = new SharedLifetime(() => { disposed += 1; });
    const first = lifetime.acquire();
    const second = lifetime.acquire();

    await first.release();
    expect(disposed).toBe(0);
    expect(lifetime.references).toBe(1);

    await second.release();
    await second.release();
    expect(disposed).toBe(1);
    expect(lifetime.references).toBe(0);
    expect(() => lifetime.acquire()).toThrow('SharedLifetime is closed');
  });

  it('inherits resources from the nearest ancestor and seals scopes', () => {
    const rootId = rootPluginId();
    const childId = childPluginId(rootId, 'child');
    const value = createToken<string>('test.value');
    const root = new Scope(rootId);
    const child = new Scope(childId, root);

    root.provide(value, 'root');
    child.provide(value, 'child');
    root.seal();
    child.seal();

    expect(child.use(value)).toBe('child');
    expect(child.snapshot().get(value.id)).toBe('child');
    expect(() => child.provide(createToken('test.late'), true)).toThrow('sealed');
  });

  it('disposes effects in reverse order and aggregates failures', async () => {
    const events: string[] = [];
    const stack = new DisposeStack();
    stack.add(() => { events.push('first'); });
    stack.add(() => {
      events.push('second');
      throw new Error('failed');
    });

    await expect(stack.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(events).toEqual(['second', 'first']);
  });

  it('keeps a retired generation alive until its lease is released', async () => {
    const disposed: number[] = [];
    const root = new RootController(emptyState());
    await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => { disposed.push(1); },
    }));
    const oldLease = root.snapshots.acquire();

    await root.transact(() => ({
      snapshot: emptyState(),
      dispose: () => { disposed.push(2); },
    }));

    expect(oldLease.value.generation).toBe(1);
    expect(root.generation).toBe(2);
    expect(disposed).toEqual([]);

    oldLease.release();
    await Promise.resolve();
    expect(disposed).toEqual([1]);

    await root.stop();
    expect(disposed).toEqual([1, 2]);
  });

  it('serializes concurrent generation transactions', async () => {
    const root = new RootController(emptyState());
    await root.start(() => ({ snapshot: emptyState(), dispose: () => undefined }));

    const first = root.transact(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { snapshot: emptyState(), dispose: () => undefined };
    });
    const second = root.transact(() => ({
      snapshot: emptyState(),
      dispose: () => undefined,
    }));

    await Promise.all([first, second]);
    expect(root.generation).toBe(3);
    await root.stop();
  });

  it('keeps the current generation when a transaction has no semantic work', async () => {
    const root = new RootController(emptyState());
    const first = await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => undefined,
    }));

    const unchanged = await root.transact(() => undefined);

    expect(unchanged).toBe(first);
    expect(root.generation).toBe(1);
    await root.stop();
  });

  it('does not expose mutable Map methods from a RuntimeSnapshot', async () => {
    const root = new RootController(emptyState());
    const snapshot = await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => undefined,
    }));

    expect('set' in snapshot.tree).toBe(false);
    expect('clear' in snapshot.capabilities).toBe(false);
    await root.stop();
  });

  it('does not finish stop until the active generation drains', async () => {
    const root = new RootController(emptyState());
    let disposed = false;
    await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => { disposed = true; },
    }));
    const lease = root.snapshots.acquire();
    let stopped = false;
    const stopping = root.stop().then(() => { stopped = true; });

    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(disposed).toBe(false);

    lease.release();
    await stopping;
    expect(stopped).toBe(true);
    expect(disposed).toBe(true);
  });

  it('waits for leases from every retired generation during stop', async () => {
    const root = new RootController(emptyState());
    const disposed: number[] = [];
    await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => { disposed.push(1); },
    }));
    const retiredLease = root.snapshots.acquire();
    await root.transact(() => ({
      snapshot: emptyState(),
      dispose: () => { disposed.push(2); },
    }));

    let stopped = false;
    const stopping = root.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    retiredLease.release();
    await stopping;
    expect(disposed).toEqual([2, 1]);
  });
});
