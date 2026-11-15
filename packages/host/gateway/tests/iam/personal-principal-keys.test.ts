import { describe, expect, it } from 'vitest';
import { personalPrincipalKeyHints, personalPrincipalKeysOf } from '../../src/iam/personal-principal-keys.js';
import type { ConsoleUserView } from '../../src/iam/service.js';

const user = (id: string, username: string, role: string, extra: Partial<ConsoleUserView> = {}): ConsoleUserView => ({
  id, username, displayName: username, disabled: false, createdAt: 1, updatedAt: 1, passwordChangedAt: 1,
  bindings: [{ id: `b-${id}`, roleId: role, role, scope: { kind: 'global' } as never }], ...extra,
});

describe('personalPrincipalKeyHints (#1250 personal-principals-invalid-key-consumes-migration)', () => {
  it('names the only owner and their id for a legacy key', () => {
    const hints = personalPrincipalKeyHints(['workroom-admin'], [user('ab06f1', 'class', 'owner', { displayName: 'Class' }), user('v1', 'viewer', 'viewer')]);
    expect(hints).toEqual(['ai.personalPrincipals.workroom-admin：键不是 user:<Console 用户 id>；当前唯一的所有者是 class（Class），可改为 user:ab06f1']);
  });

  it('a key that spells a username suggests that user\'s id, never accepts the username itself', () => {
    const users = [user('id-1', 'class', 'owner'), user('id-2', 'alice', 'owner')];
    expect(personalPrincipalKeyHints(['user:alice'], users)[0]).toContain('alice 是用户名，键要写用户 id');
    expect(personalPrincipalKeyHints(['user:alice'], users)[0]).toContain('可改为 user:id-2');
    expect(personalPrincipalKeyHints(['class'], users)[0]).toContain('可改为 user:id-1');
  });

  it('says nothing for valid keys and points to the user list when the owner is ambiguous', () => {
    const users = [user('id-1', 'a', 'owner'), user('id-2', 'b', 'owner'), user('id-3', 'c', 'owner', { disabled: true })];
    expect(personalPrincipalKeyHints(['user:id-1'], users)).toEqual([]);
    expect(personalPrincipalKeyHints(['user:gone'], users)[0]).toContain('没有 id 为 gone 的 Console 用户；共有 3 个 Console 用户（2 个所有者），用 zhin console user list');
    expect(personalPrincipalKeyHints(['x'], [])[0]).toContain('zhin console init');
  });

  it('reads the keys of ai.personalPrincipals', () => {
    expect(personalPrincipalKeysOf({ ai: { personalPrincipals: { 'user:a': [], b: [] } } })).toEqual(['user:a', 'b']);
    expect(personalPrincipalKeysOf({ ai: {} })).toEqual([]);
    expect(personalPrincipalKeysOf(null)).toEqual([]);
  });
});
