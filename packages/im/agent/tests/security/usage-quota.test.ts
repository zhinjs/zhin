import { describe, expect, it } from 'vitest';
import { UsageQuota } from '../../src/security/usage-quota.js';

const alice = { userId: 'alice', groupId: 'qq:bot:g1', owner: false };
const bob = { userId: 'bob', groupId: 'qq:bot:g1', owner: false };

describe('UsageQuota', () => {
  it('counts one shared request per group and leaves no rate reservation after a rejected batch', () => {
    const quota = new UsageQuota({ perUserTokens: 10, perGroupRequestsPerMinute: 1 });
    quota.record(alice, 10);
    expect(quota.checkBatch([alice, bob])).toMatchObject({ allowed: false, scope: 'user', deniedUserIds: ['alice'] });
    expect(quota.checkBatch([bob, bob])).toEqual({ allowed: true });
    expect(quota.check(bob)).toMatchObject({ allowed: false, scope: 'group', reason: 'rate' });
  });

  it('preflights all groups before reserving any rate slot', () => {
    const quota = new UsageQuota({ perGroupRequestsPerMinute: 1 });
    const other = { ...bob, groupId: 'qq:bot:other' };
    quota.check(other);
    expect(quota.checkBatch([alice, other])).toMatchObject({ allowed: false, scope: 'group' });
    expect(quota.checkBatch([alice, bob])).toEqual({ allowed: true });
  });

  it('is off by default', () => {
    const quota = new UsageQuota();
    quota.record(alice, 1_000_000);
    expect(quota.enabled).toBe(false);
    expect(quota.check(alice)).toEqual({ allowed: true });
  });

  it('stops only the user over their token quota, with a clear message', () => {
    const quota = new UsageQuota({ perUserTokens: 100 });
    quota.record(alice, 120);
    const decision = quota.check(alice);
    expect(decision).toMatchObject({ allowed: false, scope: 'user', reason: 'tokens' });
    expect(decision.allowed === false && decision.message).toContain('其他人不受影响');
    expect(quota.check(bob)).toEqual({ allowed: true });
  });

  it('stops a group over its token quota but not private chats', () => {
    const quota = new UsageQuota({ perGroupTokens: 100 });
    quota.record(alice, 60);
    quota.record(bob, 60);
    expect(quota.check(alice)).toMatchObject({ allowed: false, scope: 'group' });
    expect(quota.check({ userId: 'alice', owner: false })).toEqual({ allowed: true });
  });

  it('rate-limits a group per minute and recovers after the window', () => {
    let now = 0;
    const quota = new UsageQuota({ perGroupRequestsPerMinute: 2 }, undefined, () => now);
    expect(quota.check(alice).allowed).toBe(true);
    expect(quota.check(bob).allowed).toBe(true);
    expect(quota.check(alice)).toMatchObject({ allowed: false, reason: 'rate' });
    now = 60_000;
    expect(quota.check(alice).allowed).toBe(true);
  });

  it('resets token windows and exempts the owner', () => {
    let now = 0;
    const quota = new UsageQuota({ perUserTokens: 10, windowMs: 60_000 }, undefined, () => now);
    quota.record(alice, 20);
    expect(quota.check(alice).allowed).toBe(false);
    now = 60_000;
    expect(quota.check(alice).allowed).toBe(true);
    const owner = { userId: 'owner', owner: true };
    quota.record(owner, 1_000);
    expect(quota.check(owner).allowed).toBe(true);
  });
});
