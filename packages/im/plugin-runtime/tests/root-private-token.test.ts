import { describe, expect, it } from 'vitest';
import {
  Scope,
  childPluginId,
  createRootPrivateToken,
  createToken,
  rootPluginId,
} from '../src/index.js';

describe('Root-private resource tokens', () => {
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
});
