import { describe, expect, it } from 'vitest';
import {
  DisposeStack,
  GenerationHandoffStack,
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

describe('Plugin Runtime kernel', () => {
  it('accepts segmented Capability local names without relaxing Plugin keys', () => {
    const root = rootPluginId();
    expect(capabilityId(root, featureId('test.command'), 'gh/issue/list')).toContain(
      'gh/issue/list',
    );
    expect(capabilityId(root, featureId('test.command'), 'gh/pr/$title')).toContain(
      'gh/pr/$title',
    );
    expect(capabilityId(root, featureId('test.command'), '赞我')).toContain('赞我');
    expect(capabilityId(root, featureId('test.command'), '工具/赞我')).toContain('工具/赞我');
    expect(capabilityId(root, featureId('test.command'), 'voice_stt')).toContain('voice_stt');
    expect(capabilityId(root, featureId('test.command'), 'schedule_list')).toContain(
      'schedule_list',
    );
    expect(() => capabilityId(root, featureId('test.command'), 'gh//list')).toThrow(
      'Invalid capability local name',
    );
    expect(() => capabilityId(root, featureId('test.command'), 'gh/pr/$Title')).toThrow(
      'Invalid capability local name',
    );
    expect(() => capabilityId(root, featureId('test.command'), 'Hello')).toThrow(
      'Invalid capability local name',
    );
    expect(() => childPluginId(root, 'gh/issue')).toThrow('Invalid plugin instance key');
    expect(() => childPluginId(root, '赞我')).toThrow('Invalid plugin instance key');
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

  it('exposes leases without exposing generation write authority', () => {
    const root = new RootController(emptyState());

    expect(root.snapshot.generation).toBe(0);
    expect('current' in root.snapshots).toBe(false);
    expect('commit' in root.snapshots).toBe(false);
    expect('close' in root.snapshots).toBe(false);
  });

  it('observes every committed generation but skips no-op transactions', async () => {
    const root = new RootController(emptyState());
    const commits: Array<[number, number]> = [];
    const unsubscribe = root.onGenerationCommit((event) => {
      commits.push([event.previous.generation, event.current.generation]);
    });

    await root.start(() => ({ snapshot: emptyState(), dispose: () => undefined }));
    await root.transact(() => undefined);
    await root.transact(() => ({ snapshot: emptyState(), dispose: () => undefined }));
    unsubscribe();
    await root.transact(() => ({ snapshot: emptyState(), dispose: () => undefined }));

    expect(commits).toEqual([[0, 1], [1, 2]]);
    await root.stop();
  });

  it('isolates generation observers from an already committed transaction', async () => {
    const reported: unknown[] = [];
    const root = new RootController(emptyState(), (error) => { reported.push(error); });
    root.onGenerationCommit(() => { throw new Error('observer failed'); });

    const snapshot = await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => undefined,
    }));

    expect(snapshot.generation).toBe(1);
    expect(root.state).toBe('running');
    expect(reported).toEqual([
      expect.objectContaining({ message: 'observer failed' }),
    ]);
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

  it('closes Root admission when generation rollback cannot restore integrity', async () => {
    const root = new RootController(emptyState());
    await root.start(() => ({ snapshot: emptyState(), dispose: () => undefined }));

    await expect(root.transact(() => ({
      snapshot: emptyState(),
      dispose: () => undefined,
      handoff: {
        quiescePrevious() {},
        activateNext() { throw new Error('activation failed'); },
        deactivateNext() { throw new Error('cleanup failed'); },
        resumePrevious() {},
        openNext() {},
      },
    }))).rejects.toThrow('Root integrity failed');

    expect(root.state).toBe('failed');
    expect(() => root.snapshots.acquire()).toThrow('not accepting');
    await expect(root.transact(() => undefined)).rejects.toThrow('Cannot transact');
    await root.stop();
  });

  it('recognizes compensation failure reported inside the production handoff stack', async () => {
    const root = new RootController(emptyState());
    await root.start(() => ({ snapshot: emptyState(), dispose: () => undefined }));
    const handoff = new GenerationHandoffStack();
    handoff.add({
      quiescePrevious() { throw new Error('quiesce failed'); },
    });
    handoff.add({
      quiescePrevious() {},
      resumePrevious() { throw new Error('resume failed'); },
    });

    await expect(root.transact(() => ({
      snapshot: emptyState(),
      dispose: () => undefined,
      handoff: handoff.seal(),
    }))).rejects.toThrow('Root integrity failed');

    expect(root.state).toBe('failed');
    await root.stop();
  });

  it('cannot publish a candidate after asynchronous disposal closes Root admission', async () => {
    const root = new RootController(emptyState());
    await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => { throw new Error('retired dispose failed'); },
    }));
    const retiredLease = root.snapshots.acquire();
    await root.transact(() => ({ snapshot: emptyState(), dispose: () => undefined }));

    let enterPrepare!: () => void;
    const preparing = new Promise<void>((resolve) => { enterPrepare = resolve; });
    let finishPrepare!: () => void;
    const prepareGate = new Promise<void>((resolve) => { finishPrepare = resolve; });
    let candidateDisposed = false;
    const transaction = root.transact(async () => {
      enterPrepare();
      await prepareGate;
      return {
        snapshot: emptyState(),
        dispose: () => { candidateDisposed = true; },
      };
    });
    await preparing;

    retiredLease.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.state).toBe('failed');

    finishPrepare();
    await expect(transaction).rejects.toThrow('cannot publish');
    expect(root.generation).toBe(2);
    expect(candidateDisposed).toBe(true);
    await expect(root.stop()).rejects.toThrow('retired dispose failed');
  });

  it('closes Root admission when a retired generation fails to dispose', async () => {
    const root = new RootController(emptyState());
    await root.start(() => ({
      snapshot: emptyState(),
      dispose: () => { throw new Error('retired dispose failed'); },
    }));
    const lease = root.snapshots.acquire();
    await root.transact(() => ({ snapshot: emptyState(), dispose: () => undefined }));

    lease.release();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.state).toBe('failed');
    expect(() => root.snapshots.acquire()).toThrow('not accepting');
    const firstStop = root.stop();
    const secondStop = root.stop();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toThrow('retired dispose failed');
    await expect(root.stop()).rejects.toThrow('retired dispose failed');
    expect(root.state).toBe('stopped');
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
