import { TokenRegistry } from '../src/token-registry.js';

describe('TokenRegistry principal binding', () => {
  it('keeps immutable principal authority across replay and revokes it on rotation', () => {
    const first = new TokenRegistry({
      scopedTokens: [{ token: 'old-secret', scope: 'full', principalId: 'human:alice' }],
    });
    expect(first.resolvePrincipal('old-secret')).toEqual({ principalId: 'human:alice', scope: 'full' });
    expect(first.resolvePrincipal('old-secret')).toEqual({ principalId: 'human:alice', scope: 'full' });

    const rotated = new TokenRegistry({
      scopedTokens: [{ token: 'new-secret', scope: 'full', principalId: 'human:alice' }],
    });
    expect(rotated.resolve('old-secret')).toBeNull();
    expect(rotated.resolvePrincipal('old-secret')).toBeNull();
    expect(rotated.resolvePrincipal('new-secret')).toEqual({ principalId: 'human:alice', scope: 'full' });
  });

  it('never turns an unbound full-scope credential into a Sponsor principal', () => {
    const registry = new TokenRegistry({ primaryToken: 'root-console-token' });
    expect(registry.resolve('root-console-token')).toBe('full');
    expect(registry.resolvePrincipal('root-console-token')).toBeNull();
  });

  it('registers, expires, and revokes runtime-issued device credentials', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00Z'));
    const registry = new TokenRegistry();
    const revoke = registry.register({
      token: 'paired-device-secret',
      scope: 'full',
      principalId: 'device:ipad',
      expiresAt: Date.now() + 60_000,
    });
    expect(registry.resolve('paired-device-secret')).toBe('full');
    expect(registry.resolvePrincipal('paired-device-secret')).toEqual({
      principalId: 'device:ipad', scope: 'full',
    });

    revoke();
    expect(registry.resolve('paired-device-secret')).toBeNull();

    registry.register({
      token: 'short-lived-secret',
      scope: 'demo',
      expiresAt: Date.now() + 1_000,
    });
    vi.advanceTimersByTime(1_001);
    expect(registry.resolve('short-lived-secret')).toBeNull();
    vi.useRealTimers();
  });

  it('does not let dynamic credentials replace configured credentials', () => {
    const registry = new TokenRegistry({ primaryToken: 'configured-secret' });
    expect(() => registry.register({ token: 'configured-secret', scope: 'full' }))
      .toThrow('conflicts with an existing credential');
    expect(registry.revoke('configured-secret')).toBe(false);
    expect(registry.resolve('configured-secret')).toBe('full');
  });
});

describe('TokenRegistry Console access', () => {
  it('treats a Host without tokens and full-scope tokens as the unrestricted operator', () => {
    expect(new TokenRegistry().resolveAccess('').unrestricted).toBe(true);
    const registry = new TokenRegistry({ primaryToken: 'admin-secret' });
    expect(registry.resolveAccess('admin-secret').unrestricted).toBe(true);
  });

  it('gives scoped tokens exactly their configured permissions and roles', () => {
    const registry = new TokenRegistry({
      primaryToken: 'admin-secret',
      scopedTokens: [{ token: 'alice-secret', scope: 'demo', principalId: 'alice', permissions: ['ambient:read', 'ambient:read'], roles: ['member'] }],
    });
    expect(registry.resolveAccess('alice-secret')).toEqual({ unrestricted: false, permissions: ['ambient:read'], roles: ['member'] });
    expect(registry.resolve('alice-secret')).toBe('demo');
  });

  it('gives missing, unknown and expired tokens public access only', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T08:00:00Z'));
    const registry = new TokenRegistry({ primaryToken: 'admin-secret' });
    registry.register({ token: 'short-lived', scope: 'demo', permissions: ['a'], expiresAt: Date.now() + 1000 });
    expect(registry.resolveAccess('short-lived').permissions).toEqual(['a']);
    vi.advanceTimersByTime(2000);
    for (const token of ['', 'nope', 'short-lived']) {
      expect(registry.resolveAccess(token)).toEqual({ unrestricted: false, permissions: [], roles: [] });
    }
    vi.useRealTimers();
  });

  it('rejects malformed access lists and conflicting duplicate bindings', () => {
    expect(() => new TokenRegistry({ scopedTokens: [{ token: 't', scope: 'demo', permissions: [' a '] }] })).toThrow(/permissions/u);
    expect(() => new TokenRegistry({ scopedTokens: [
      { token: 't', scope: 'demo', roles: ['a'] },
      { token: 't', scope: 'demo', roles: ['b'] },
    ] })).toThrow(/conflicting/u);
  });
});
