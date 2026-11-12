import { describe, it, expect } from 'vitest';
import {
  parsePermitName,
  isBuiltinPermit,
  removedPermitReplacement,
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
    sender: { id: 'u1' },
    ...overrides,
  };
}

describe('parsePermitName', () => {
  it('parses adapter(qq)', () => {
    expect(parsePermitName('adapter(qq)')).toEqual({ kind: 'adapter', values: ['qq'] });
  });

  it('parses group(g1,g2)', () => {
    expect(parsePermitName('group(g1,g2)')).toEqual({ kind: 'group', values: ['g1', 'g2'] });
  });

  it('parses private()', () => {
    expect(parsePermitName('private()')).toEqual({ kind: 'private', values: [''] });
  });

  it('parses chat roles as role(...) or bare names', () => {
    expect(parsePermitName('role(admin)')).toEqual({ kind: 'role', values: ['admin'] });
    expect(parsePermitName('role(owner,trusted)')).toEqual({ kind: 'role', values: ['owner', 'trusted'] });
    expect(parsePermitName('owner')).toEqual({ kind: 'role', values: ['owner'] });
    expect(parsePermitName('trusted')).toEqual({ kind: 'role', values: ['trusted'] });
  });

  it('parses platform conditions', () => {
    expect(parsePermitName('platform:admin')).toEqual({ kind: 'platform', values: ['admin'] });
    expect(parsePermitName('platform:owner')).toEqual({ kind: 'platform', values: ['owner'] });
    expect(parsePermitName('platform-role:123')).toEqual({ kind: 'platform-role', values: ['123'] });
    expect(parsePermitName('platform-permission:ban_members')).toEqual({ kind: 'platform-permission', values: ['ban_members'] });
  });

  it('returns null for unknown or removed DSL', () => {
    expect(parsePermitName('unknown(foo)')).toBeNull();
    expect(parsePermitName('platform(qq,scene_admin)')).toBeNull();
    expect(parsePermitName('role(master)')).toBeNull();
    expect(parsePermitName('role(user)')).toBeNull();
    expect(parsePermitName('platform:member')).toBeNull();
    expect(parsePermitName('platform-role:')).toBeNull();
    expect(parsePermitName('scene_admin')).toBeNull();
  });
});

describe('isBuiltinPermit', () => {
  it('recognizes builtin permits', () => {
    expect(isBuiltinPermit('adapter(qq)')).toBe(true);
    expect(isBuiltinPermit('group()')).toBe(true);
    expect(isBuiltinPermit('role(admin)')).toBe(true);
    expect(isBuiltinPermit('admin')).toBe(true);
    expect(isBuiltinPermit('platform:owner')).toBe(true);
  });

  it('rejects the removed platform(adapter,perm) form', () => {
    expect(isBuiltinPermit('platform(qq,scene_admin)')).toBe(false);
  });
});

describe('removedPermitReplacement', () => {
  it('names the ADR 0056 replacement of every removed spelling', () => {
    expect(removedPermitReplacement('role(master)')).toBe('role(owner)');
    expect(removedPermitReplacement('role(owner,admin,master)')).toBe('role(owner,admin)');
    expect(removedPermitReplacement('master')).toBe('owner');
    expect(removedPermitReplacement('scene_admin')).toBe('platform:admin');
    expect(removedPermitReplacement('scene_owner')).toBe('platform:owner');
    expect(removedPermitReplacement('platform(qq,scene_admin)')).toBe('platform:admin');
    expect(removedPermitReplacement('platform(discord,manage_roles)')).toBe('platform-permission:manage_roles');
    expect(removedPermitReplacement('adapter(qq)')).toBeUndefined();
  });
});

describe('assertPermitSyntax', () => {
  it('accepts valid builtin, role and platform permits', () => {
    expect(() => assertPermitSyntax(['adapter(qq)', 'group()', 'admin', 'role(owner,trusted)', 'platform:admin',
      'platform-role:42', 'platform-permission:kick'])).not.toThrow();
  });

  it('throws for unknown DSL', () => {
    expect(() => assertPermitSyntax(['unknown(foo)'])).toThrow(/Unknown permit/);
  });

  it('throws with the replacement for removed spellings', () => {
    expect(() => assertPermitSyntax(['role(master)'])).toThrow(/removed \(ADR 0056\); use role\(owner\)/);
    expect(() => assertPermitSyntax(['platform(qq,scene_admin)'])).toThrow(/use platform:admin/);
    expect(() => assertPermitSyntax(['scene_owner'])).toThrow(/use platform:owner/);
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

  it('role — owner includes admin includes trusted', () => {
    const owner = makeSubject({ sender: { id: 'u1', chatRole: 'owner' } });
    expect(checkBuiltinPermit('trusted', owner)).toBe(true);
    expect(checkBuiltinPermit('role(admin)', owner)).toBe(true);
    expect(checkBuiltinPermit('owner', owner)).toBe(true);
    const admin = makeSubject({ sender: { id: 'u1', chatRole: 'admin' } });
    expect(checkBuiltinPermit('trusted', admin)).toBe(true);
    expect(checkBuiltinPermit('owner', admin)).toBe(false);
    expect(checkBuiltinPermit('role(owner,admin)', admin)).toBe(true);
    const trusted = makeSubject({ sender: { id: 'u1', chatRole: 'trusted' } });
    expect(checkBuiltinPermit('admin', trusted)).toBe(false);
  });

  it('role@level — the role must come from that level or a higher one (owner@global …)', () => {
    expect(isBuiltinPermit('owner@global')).toBe(true);
    expect(isBuiltinPermit('role(owner@adapter,admin)')).toBe(true);
    expect(isBuiltinPermit('owner@everywhere')).toBe(false);
    expect(isBuiltinPermit('master@global')).toBe(false);
    expect(parsePermitName('admin@endpoint')).toEqual({ kind: 'role', values: ['admin@endpoint'] });
    const conversationOwner = makeSubject({ sender: { id: 'u1', chatRole: 'owner', chatRoleLevels: { owner: 'conversation', admin: 'endpoint', trusted: 'global' } } });
    expect(checkBuiltinPermit('owner', conversationOwner)).toBe(true);
    expect(checkBuiltinPermit('owner@conversation', conversationOwner)).toBe(true);
    expect(checkBuiltinPermit('owner@endpoint', conversationOwner)).toBe(false);
    expect(checkBuiltinPermit('owner@global', conversationOwner)).toBe(false);
    expect(checkBuiltinPermit('admin@endpoint', conversationOwner)).toBe(true);
    expect(checkBuiltinPermit('admin@adapter', conversationOwner)).toBe(false);
    expect(checkBuiltinPermit('trusted@global', conversationOwner)).toBe(true);
    expect(checkBuiltinPermit('role(owner@global,admin@endpoint)', conversationOwner)).toBe(true);
    const globalOwner = makeSubject({ sender: { id: 'u1', chatRole: 'owner', chatRoleLevels: { owner: 'global', admin: 'global', trusted: 'global' } } });
    expect(checkBuiltinPermit('owner@global', globalOwner)).toBe(true);
    expect(checkBuiltinPermit('owner@adapter', globalOwner)).toBe(true);
    // Without levels a role counts at the conversation level only.
    expect(checkBuiltinPermit('owner@adapter', makeSubject({ sender: { id: 'u1', chatRole: 'owner' } }))).toBe(false);
    expect(() => assertPermitSyntax(['owner@nowhere'])).toThrow(/Unknown permit/);
  });

  it('role — no chat role holds nothing, platform standing is not a chat role', () => {
    expect(checkBuiltinPermit('role(admin)', makeSubject())).toBe(false);
    expect(checkBuiltinPermit('admin', makeSubject({ sender: { id: 'u1', platform: { standing: 'owner' } } }))).toBe(false);
  });

  it('platform — normalized standing, roles and permissions', () => {
    const owner = makeSubject({ sender: { id: 'u1', platform: { standing: 'owner', roles: [{ id: 'r1', name: 'Mod' }], permissions: ['kick'] } } });
    expect(checkBuiltinPermit('platform:owner', owner)).toBe(true);
    expect(checkBuiltinPermit('platform:admin', owner)).toBe(true);
    expect(checkBuiltinPermit('platform-role:r1', owner)).toBe(true);
    expect(checkBuiltinPermit('platform-role:Mod', owner)).toBe(false);
    expect(checkBuiltinPermit('platform-permission:kick', owner)).toBe(true);
    expect(checkBuiltinPermit('platform-permission:ban', owner)).toBe(false);
    const admin = makeSubject({ sender: { id: 'u1', platform: { standing: 'admin' } } });
    expect(checkBuiltinPermit('platform:admin', admin)).toBe(true);
    expect(checkBuiltinPermit('platform:owner', admin)).toBe(false);
    expect(checkBuiltinPermit('platform:admin', makeSubject())).toBe(false);
    // A zhin chat role is not a platform standing.
    expect(checkBuiltinPermit('platform:admin', makeSubject({ sender: { id: 'u1', chatRole: 'owner' } }))).toBe(false);
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
