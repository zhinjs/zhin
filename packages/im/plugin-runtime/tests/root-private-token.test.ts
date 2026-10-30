import { describe, expect, it } from 'vitest';
import {
  Scope,
  SnapshotStore,
  readLeasedRootResource,
  type SnapshotState,
  childPluginId,
  createRootPrivateToken,
  createToken,
  rootPluginId,
} from '../src/index.js';

describe('Root-private resource tokens', () => {
  it('does not expose the parent Scope as an escape hatch to Root process resources', () => {
    const rootId = rootPluginId();
    const root = new Scope(rootId);
    const child = new Scope(childPluginId(rootId, 'feature'), root);
    const grandchild = new Scope(childPluginId(child.owner, 'nested'), child);
    const privateToken = createRootPrivateToken<object>('root.private.raw-host');
    const inheritedToken = createToken<string>('root.public.inherited');
    root.provide(privateToken, { rawHost: true });
    root.provide(inheritedToken, 'root-value');

    for (const scope of [child, grandchild]) {
      expect(Reflect.get(scope, 'parent')).toBeUndefined();
      expect(Reflect.ownKeys(scope)).not.toContain('parent');
      expect(Object.values(scope)).not.toContain(root);
      expect(Object.values(scope)).not.toContain(child);
      expect(scope.has(privateToken)).toBe(false);
      expect(() => scope.use(privateToken)).toThrow('Missing resource');
      expect(scope.use(inheritedToken)).toBe('root-value');
      // Public JS properties cannot redirect the private resolution chain.
      Object.defineProperty(scope, 'parent', { value: new Scope(rootId) });
      expect(scope.use(inheritedToken)).toBe('root-value');
      expect(() => scope.use(privateToken)).toThrow('Missing resource');
    }

    root.seal();
    child.seal();
    grandchild.seal();
    expect(grandchild.snapshot().get(inheritedToken.id)).toBe('root-value');
    expect(grandchild.snapshot().has(privateToken.id)).toBe(false);
  });

  it('remain usable by Root composition but never enter child scope or snapshots', () => {
    const rootId = rootPluginId();
    const root = new Scope(rootId);
    const child = new Scope(childPluginId(rootId, 'feature'), root);
    const privateToken = createRootPrivateToken<{ secret: string }>('root.private.provider');
    const inheritedToken = createToken<string>('root.public.provider');
    root.provide(privateToken, { secret: 'provider-capability' });
    root.provide(inheritedToken, 'public-capability');

    expect(root.use(privateToken)).toEqual({ secret: 'provider-capability' });
    expect(child.has(privateToken)).toBe(false);
    expect(() => child.use(privateToken)).toThrow('Missing resource');
    expect(child.use(inheritedToken)).toBe('public-capability');

    root.seal();
    child.seal();
    expect(root.snapshot().has(privateToken.id)).toBe(false);
    expect(child.snapshot().has(privateToken.id)).toBe(false);
    expect(child.snapshot().get(inheritedToken.id)).toBe('public-capability');
  });

  it('rejects a same-id public or private token spoof in the owning Scope', () => {
    const root = new Scope(rootPluginId());
    const authority = createRootPrivateToken<string>('root.private.same-id');
    const publicSpoof = createToken<string>('root.private.same-id');
    const privateSpoof = createRootPrivateToken<string>('root.private.same-id');
    root.provide(authority, 'secret');

    expect(root.has(authority)).toBe(true);
    expect(root.use(authority)).toBe('secret');
    expect(root.has(publicSpoof)).toBe(false);
    expect(root.has(privateSpoof)).toBe(false);
    expect(() => root.use(publicSpoof)).toThrow('Missing resource');
    expect(() => root.use(privateSpoof)).toThrow('Missing resource');
  });

  it('blocks private inheritance through every descendant while permitting a local public shadow', () => {
    const rootId = rootPluginId();
    const root = new Scope(rootId);
    const child = new Scope(childPluginId(rootId, 'child'), root);
    const grandchild = new Scope(childPluginId(child.owner, 'grandchild'), child);
    const authority = createRootPrivateToken<string>('root.private.shadowed');
    const shadow = createToken<string>('root.private.shadowed');
    root.provide(authority, 'root-secret');

    expect(child.has(authority)).toBe(false);
    expect(grandchild.has(authority)).toBe(false);
    expect(() => grandchild.use(shadow)).toThrow('Missing resource');

    child.provide(shadow, 'child-local');
    expect(child.use(shadow)).toBe('child-local');
    expect(grandchild.use(shadow)).toBe('child-local');
    expect(child.use(authority)).toBe('child-local');

    root.seal();
    child.seal();
    grandchild.seal();
    expect(root.snapshot().has(authority.id)).toBe(false);
    expect(child.snapshot().get(shadow.id)).toBe('child-local');
    expect(grandchild.snapshot().get(shadow.id)).toBe('child-local');
  });
  it('lets trusted Host leases read the exact generation without publishing private resources', async () => {
    const rootId = rootPluginId();
    const token = createRootPrivateToken<{ generation: string }>('private.generation.service');
    const scope = (generation: string) => {
      const value = new Scope(rootId); value.provide(token, { generation }); value.seal(); return value;
    };
    const state = (value: Scope): SnapshotState => ({ root: rootId, tree: new Map(), config: new Map(),
      resources: new Map([[rootId, value.snapshot()]]), capabilities: new Map(), projections: new Map() });
    const first = scope('old'); const second = scope('new');
    const store = new SnapshotStore<Scope>(state(first), undefined, first,
      (value, _root, requested) => value.has(requested) ? value.use(requested) : undefined);
    const oldLease = store.acquire();
    store.commit(0, { snapshot: state(second), state: second, dispose: () => undefined });
    const newLease = store.acquire();
    expect(oldLease.value.resources.get(rootId)?.has(token.id)).toBe(false);
    expect(newLease.value.resources.get(rootId)?.has(token.id)).toBe(false);
    expect(readLeasedRootResource(store, oldLease, token)).toEqual({ generation: 'old' });
    expect(readLeasedRootResource(store, newLease, token)).toEqual({ generation: 'new' });
    expect(readLeasedRootResource(store, newLease, createToken(token.id))).toBeUndefined();
    expect(new Scope(childPluginId(rootId, 'child'), second).has(token)).toBe(false);
    const other = new SnapshotStore(state(first)); const foreign = other.acquire();
    expect(() => readLeasedRootResource(store, foreign, token)).toThrow('active owned');
    foreign.release(); await other.close();
    oldLease.release();
    expect(store.owns(oldLease)).toBe(true);
    expect(() => readLeasedRootResource(store, oldLease, token)).toThrow('active owned');
    newLease.release(); await store.close();
  });

});
