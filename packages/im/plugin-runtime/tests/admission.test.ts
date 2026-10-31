import { describe, expect, it, vi } from 'vitest';
import {
  RootController,
  SnapshotStore,
  createGenerationAdmissionGate,
  featureId,
  generationAdmissionSource,
  rootPluginId,
  type GenerationAdmissionGate,
  type SnapshotState,
} from '../src/index.js';

const ingressFeature = featureId('test.ingress');

function state(gate?: GenerationAdmissionGate): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: gate
      ? new Map([[ingressFeature, { [generationAdmissionSource]: [gate] }]])
      : new Map(),
  };
}

describe('generation admission', () => {
  it('binds the exact Root stop fact before activation and keeps it across reused and retired gates', async () => {
    const retained = createGenerationAdmissionGate(), replacement = createGenerationAdmissionGate();
    expect(retained.stopSignal).toBeUndefined(); expect(replacement.stopSignal).toBeUndefined();
    const store = new SnapshotStore(state(retained));
    const lease = store.acquire(); const stop = lease.stopSignal;
    const activations: AbortSignal[] = [];
    replacement.onActivate(() => { if (replacement.stopSignal) activations.push(replacement.stopSignal); });
    try {
      expect(retained.stopSignal).toBe(stop);
      store.commit(0, { snapshot: state(retained), dispose() {} });
      expect(retained.stopSignal).toBe(stop); expect(stop.aborted).toBe(false);
      store.commit(1, { snapshot: state(replacement), dispose() {} });
      expect(retained.active).toBe(false); expect(retained.stopSignal).toBe(stop);
      expect(replacement.stopSignal).toBe(stop); expect(activations).toEqual([stop]);
      expect(stop.aborted).toBe(false);
      const stopObserved = vi.fn(() => {
        expect(retained.active).toBe(false); expect(replacement.active).toBe(false);
        expect(replacement.enter(() => 'fresh work')).toBeUndefined();
      });
      stop.addEventListener('abort', stopObserved, { once: true });
      const closing = store.close();
      expect(retained.stopSignal?.aborted).toBe(true); expect(replacement.stopSignal?.aborted).toBe(true);
      expect(stopObserved).toHaveBeenCalledOnce();
      lease.release(); await closing;
    } finally { lease.release(); await store.close(); }
  });

  it('can release a transport-held lease on explicit Root stop without closing it on HMR', async () => {
    const gate = createGenerationAdmissionGate(); const store = new SnapshotStore(state(gate));
    const release = gate.acquire(); expect(release).toBeTypeOf('function');
    let closed = false;
    try {
      const stop = gate.stopSignal;
      expect(stop).toBeDefined();
      stop?.addEventListener('abort', () => { closed = true; release?.(); }, { once: true });
      store.commit(0, { snapshot: state(), dispose() {} });
      expect(gate.active).toBe(false); expect(closed).toBe(false);
      const closing = store.close(); expect(closed).toBe(true); await closing;
    } finally { release?.(); await store.close(); }
  });

  it('keeps candidate ingress invisible until the generation is committed', async () => {
    const candidate = createGenerationAdmissionGate();
    const root = new RootController(state());

    await root.start(() => {
      expect(candidate.active).toBe(false);
      return { snapshot: state(candidate), dispose: () => undefined };
    });

    expect(candidate.active).toBe(true);
    await root.stop();
    expect(candidate.active).toBe(false);
  });

  it('notifies activation exactly once at commit', async () => {
    const candidate = createGenerationAdmissionGate();
    const activated = vi.fn();
    candidate.onActivate(activated);
    const root = new RootController(state());

    await root.start(() => ({ snapshot: state(candidate), dispose: () => undefined }));
    await root.transact(() => ({ snapshot: state(candidate), dispose: () => undefined }));

    expect(activated).toHaveBeenCalledTimes(1);
    await root.stop();
  });

  it('switches admission at commit while retired resources remain lease-protected', async () => {
    const previous = createGenerationAdmissionGate();
    const next = createGenerationAdmissionGate();
    const root = new RootController(state());
    await root.start(() => ({ snapshot: state(previous), dispose: () => undefined }));
    const previousLease = root.snapshots.acquire();

    await root.transact(() => ({ snapshot: state(next), dispose: () => undefined }));

    expect(previous.active).toBe(false);
    expect(next.active).toBe(true);
    expect(previousLease.value.generation).toBe(1);
    previousLease.release();
    await root.stop();
  });

  it('holds an operation lease until an admitted async operation settles', async () => {
    const previous = createGenerationAdmissionGate();
    const next = createGenerationAdmissionGate();
    const store = new SnapshotStore(state(previous));
    let disposed = false;
    store.commit(0, {
      snapshot: state(previous),
      dispose: () => { disposed = true; },
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });

    const operation = previous.enter(async () => pending);
    store.commit(1, { snapshot: state(next), dispose: () => undefined });
    expect(previous.active).toBe(false);
    expect(disposed).toBe(false);

    release();
    await operation;
    await vi.waitFor(() => expect(disposed).toBe(true));
    await store.close();
  });

  it('does not interrupt admission for a retained resource', async () => {
    const retained = createGenerationAdmissionGate();
    const root = new RootController(state());
    await root.start(() => ({ snapshot: state(retained), dispose: () => undefined }));

    await root.transact(() => ({ snapshot: state(retained), dispose: () => undefined }));

    expect(retained.active).toBe(true);
    await root.stop();
  });

  it('never publishes admission from a failed candidate', async () => {
    const previous = createGenerationAdmissionGate();
    const candidate = createGenerationAdmissionGate();
    const root = new RootController(state());
    await root.start(() => ({ snapshot: state(previous), dispose: () => undefined }));

    await expect(root.transact(() => {
      expect(candidate.active).toBe(false);
      throw new Error('not ready');
    })).rejects.toThrow('not ready');

    expect(previous.active).toBe(true);
    expect(candidate.active).toBe(false);
    await root.stop();
  });

  it('rejects cross-Root ownership of the same admission gate', async () => {
    const gate = createGenerationAdmissionGate();
    const owner = new SnapshotStore(state(gate));

    expect(() => new SnapshotStore(state(gate))).toThrow('another SnapshotStore');
    expect(gate.active).toBe(true);
    await owner.close();
  });

  it('leaves both roots untouched when a switch claims another root admission', async () => {
    const current = createGenerationAdmissionGate();
    const foreign = createGenerationAdmissionGate();
    const owner = new SnapshotStore(state(current));
    const foreignOwner = new SnapshotStore(state(foreign));

    expect(() => owner.commit(0, {
      snapshot: state(foreign),
      dispose: () => undefined,
    })).toThrow('another SnapshotStore');
    expect(owner.current.generation).toBe(0);
    expect(current.active).toBe(true);
    expect(foreign.active).toBe(true);

    await owner.close();
    await foreignOwner.close();
  });
  it('publishes the pointer and complete admission vector before synchronous activation/retirement callbacks', async () => {
    const root = new RootController(state());
    const old = createGenerationAdmissionGate();
    await root.start(() => ({ snapshot: state(old), dispose: () => undefined }));
    const first = createGenerationAdmissionGate();
    const second = createGenerationAdmissionGate();
    const observed: number[] = [];
    old.onDeactivate(() => {
      expect(first.active).toBe(true); expect(second.active).toBe(true);
      const lease = root.snapshots.acquire(); observed.push(lease.value.generation); lease.release();
    });
    first.onActivate(() => {
      expect(second.active).toBe(true); expect(old.active).toBe(false);
      const lease = root.snapshots.acquire(); observed.push(lease.value.generation); lease.release();
      expect(second.enter(() => root.snapshot.generation)).toBe(2);
    });
    const candidate: SnapshotState = { ...state(first),
      projections: new Map([[ingressFeature, { [generationAdmissionSource]: [first, second] }]]),
    };
    await root.transact(() => ({ snapshot: candidate, dispose: () => undefined }));
    expect(observed).toEqual([2, 2]);
    await root.stop();
  });

});
