import { describe, it, expect } from 'vitest';
import {
  parsePermitName,
  isBuiltinPermit,
  isPlatformPermit,
  parsePlatformPermitName,
  assertPermitSyntax,
  checkBuiltinPermit,
  checkBuiltinPermitList,
} from '../src/builtin.js';
import type { PermissionSubject } from '../src/subject.js';

function makeSubject(overrides: Partial<PermissionSubject> = {}): PermissionSubject {
  return {
    adapter: 'test',
    endpoint: 'e1',
    scene: { id: 'g1', type: 'group' },
    sender: { id: 'u1', role: ['user'] },
    ...overrides,
  };
}

describe('parsePermitName', () => {
  it('parses adapter(qq)', () => {
    const result = parsePermitName('adapter(qq)');
    expect(result).toEqual({ kind: 'adapter', values: ['qq'] });
  });

  it('parses group(g1,g2)', () => {
    const result = parsePermitName('group(g1,g2)');
    expect(result).toEqual({ kind: 'group', values: ['g1', 'g2'] });
  });

  it('parses private()', () => {
    const result = parsePermitName('private()');
    expect(result).toEqual({ kind: 'private', values: [''] });
  });

  it('parses role(admin)', () => {
    const result = parsePermitName('role(admin)');
    expect(result).toEqual({ kind: 'role', values: ['admin'] });
  });

  it('returns null for unknown DSL', () => {
    expect(parsePermitName('unknown(foo)')).toBeNull();
  });

  it('returns null for platform(...)', () => {
    expect(parsePermitName('platform(qq,scene_admin)')).toBeNull();
  });
});

describe('isBuiltinPermit / isPlatformPermit', () => {
  it('recognizes builtin permits', () => {
    expect(isBuiltinPermit('adapter(qq)')).toBe(true);
    expect(isBuiltinPermit('group()')).toBe(true);
    expect(isBuiltinPermit('role(admin)')).toBe(true);
  });

  it('rejects platform as builtin', () => {
    expect(isBuiltinPermit('platform(qq,scene_admin)')).toBe(false);
  });

  it('recognizes platform permits', () => {
    expect(isPlatformPermit('platform(qq,scene_admin)')).toBe(true);
  });

  it('rejects builtin as platform', () => {
    expect(isPlatformPermit('adapter(qq)')).toBe(false);
  });
});

describe('parsePlatformPermitName', () => {
  it('parses platform(adapter,perm)', () => {
    expect(parsePlatformPermitName('platform(qq,scene_admin)')).toEqual({
      adapter: 'qq',
      perm: 'scene_admin',
    });
  });

  it('returns null for malformed', () => {
    expect(parsePlatformPermitName('platform()')).toBeNull();
    expect(parsePlatformPermitName('adapter(qq)')).toBeNull();
  });
});

describe('assertPermitSyntax', () => {
  it('accepts valid builtin and platform permits', () => {
    expect(() => assertPermitSyntax(['adapter(qq)', 'group()', 'platform(qq,scene_admin)'])).not.toThrow();
  });

  it('throws for unknown DSL', () => {
    expect(() => assertPermitSyntax(['unknown(foo)'])).toThrow(/Unknown permit/);
  });

  it('includes source in error message', () => {
    expect(() => assertPermitSyntax(['bad'], 'my-command')).toThrow(/for my-command/);
  });
});

describe('checkBuiltinPermit', () => {
  it('adapter — matches', () => {
    expect(checkBuiltinPermit('adapter(test)', makeSubject())).toBe(true);
  });

  it('adapter — mismatch', () => {
    expect(checkBuiltinPermit('adapter(qq)', makeSubject())).toBe(false);
  });

  it('group — matches scene type', () => {
    expect(checkBuiltinPermit('group()', makeSubject())).toBe(true);
  });

  it('group — wrong scene type', () => {
    expect(checkBuiltinPermit('group()', makeSubject({ scene: { id: 'c1', type: 'private' } }))).toBe(false);
  });

  it('private — matches', () => {
    expect(checkBuiltinPermit('private()', makeSubject({ scene: { id: 'p1', type: 'private' } }))).toBe(true);
  });

  it('user — matches sender id', () => {
    expect(checkBuiltinPermit('user(u1)', makeSubject())).toBe(true);
    expect(checkBuiltinPermit('user(u2)', makeSubject())).toBe(false);
  });

  it('role — master implies trusted', () => {
    const subject = makeSubject({ sender: { id: 'u1', role: ['master'] } });
    expect(checkBuiltinPermit('role(trusted)', subject)).toBe(true);
    expect(checkBuiltinPermit('role(master)', subject)).toBe(true);
  });

  it('role — user does not have admin', () => {
    expect(checkBuiltinPermit('role(admin)', makeSubject())).toBe(false);
  });

  it('adapter with slash prefix', () => {
    const subject = makeSubject({ adapter: 'adapters/qq' });
    expect(checkBuiltinPermit('adapter(qq)', subject)).toBe(true);
  });
});

describe('checkBuiltinPermitList (AND)', () => {
  it('all pass → true', () => {
    const subject = makeSubject();
    expect(checkBuiltinPermitList(['adapter(test)', 'group()'], subject)).toBe(true);
  });

  it('one fails → false', () => {
    const subject = makeSubject();
    expect(checkBuiltinPermitList(['adapter(test)', 'private()'], subject)).toBe(false);
  });

  it('empty list → true', () => {
    expect(checkBuiltinPermitList([], makeSubject())).toBe(true);
  });
});
