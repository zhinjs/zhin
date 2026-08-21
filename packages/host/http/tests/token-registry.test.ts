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
});
