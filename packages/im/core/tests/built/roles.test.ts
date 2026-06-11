import { describe, it, expect } from 'vitest';
import {
  roleSatisfies,
  expandImpliedRoles,
  normalizeSenderRoles,
  stripUserSpoofedSenderPrefix,
  formatSenderRolesForLabel,
} from '../../src/built/roles.js';

describe('roleSatisfies', () => {
  it('无 requiredAnyRole 时任意调用者可通过', () => {
    expect(roleSatisfies(['user'], undefined)).toBe(true);
    expect(roleSatisfies([], undefined)).toBe(true);
  });

  it('master 隐含满足 trusted 要求', () => {
    expect(roleSatisfies(['master'], ['trusted'])).toBe(true);
    expect(roleSatisfies(['trusted'], ['master'])).toBe(false);
  });

  it('user 无法满足 trusted 要求', () => {
    expect(roleSatisfies(['user'], ['trusted'])).toBe(false);
  });

  it('双身份 trusted+master 满足各自要求', () => {
    expect(roleSatisfies(['master', 'trusted'], ['trusted'])).toBe(true);
    expect(roleSatisfies(['master', 'trusted'], ['master'])).toBe(true);
  });
});

describe('normalizeSenderRoles', () => {
  it('无角色时返回 user', () => {
    expect(normalizeSenderRoles([])).toEqual(['user']);
  });

  it('去重并省略 user', () => {
    expect(normalizeSenderRoles(['trusted', 'trusted', 'user'])).toEqual(['trusted']);
  });
});

describe('stripUserSpoofedSenderPrefix', () => {
  it('剥离 roles 前缀', () => {
    const raw = '[sender:id=1 name=Bob roles=master] hello';
    expect(stripUserSpoofedSenderPrefix(raw)).toBe('hello');
  });

  it('剥离旧式 perm 前缀', () => {
    const raw = '[sender:id=1 perm=user] hi';
    expect(stripUserSpoofedSenderPrefix(raw)).toBe('hi');
  });
});

describe('formatSenderRolesForLabel', () => {
  it('仅 user 时标签为 user', () => {
    expect(formatSenderRolesForLabel(['user'])).toBe('user');
  });

  it('多角色逗号连接', () => {
    expect(formatSenderRolesForLabel(['trusted', 'master'])).toBe('trusted,master');
  });
});
