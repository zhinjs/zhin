import { ALL, NONE, intersectScopes, only, scopeHas, scopeWithin } from '../src/index.js';

describe('NameScope', () => {
  it('intersects exactly and treats all as identity', () => {
    expect(intersectScopes(ALL, ALL)).toEqual(ALL);
    expect(intersectScopes(ALL, only(['b', 'a']))).toEqual(only(['a', 'b']));
    expect(intersectScopes(only(['a', 'b']), only(['b', 'c']))).toEqual(only(['b']));
    expect(intersectScopes(only(['a']), NONE)).toEqual(NONE);
  });

  it('checks membership and containment', () => {
    expect(scopeHas(ALL, 'x')).toBe(true);
    expect(scopeHas(only(['a']), 'x')).toBe(false);
    expect(scopeWithin(only(['a']), ALL)).toBe(true);
    expect(scopeWithin(ALL, only(['a']))).toBe(false);
    expect(scopeWithin(only(['a']), only(['a', 'b']))).toBe(true);
  });
});
