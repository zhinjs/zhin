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
});
