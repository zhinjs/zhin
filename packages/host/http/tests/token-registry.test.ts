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
