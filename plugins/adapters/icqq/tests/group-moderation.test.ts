import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectGroupMember, moderateGroupMember } from '../src/group-moderation.js';
import type { Client, MemberInfo } from '@icqqjs/icqq';
import kickTool from '../agents/icqq/skills/icqq-group-admin/tools/group_kick/index.ts';

function fixture() {
  const joinedAt = Date.now() - 1000;
  const self = { user_id: 8596238, group_id: 129043431, role: 'admin' } as MemberInfo;
  const member = { user_id: 123, group_id: 129043431, role: 'member', join_time: Math.floor(joinedAt / 1000) } as MemberInfo;
  const native = {
    uin: 8596238, isOnline: () => true,
    getGroupMemberInfo: vi.fn(async (_group: number, id: number) => id === 8596238 ? self : member),
    setGroupKick: vi.fn(async () => true), setGroupBan: vi.fn(async () => true),
  };
  const client = native as unknown as Client;
  const abort = new AbortController();
  return { self, member, native, client, abort, joinedAt: member.join_time * 1000 };
}

afterEach(() => vi.useRealTimers());

describe('ICQQ checked moderation port', () => {
  it('keeps the ordinary kick tool behind human approval and checks the SDK result', async () => {
    const f = fixture(); f.native.setGroupKick.mockResolvedValue(false);
    expect(kickTool.requiresApproval).toBe('human');
    await expect(kickTool.execute({ group_id: 129043431, user_id: 123, reason: '经人工确认' },
      { $client: f.client, signal: f.abort.signal, locale: 'en' } as never)).resolves.toMatchObject({ success: false, message: 'The platform did not confirm removal; do not retry automatically' });
    expect(f.native.getGroupMemberInfo).toHaveBeenCalledWith(129043431, 123, true);
    expect(f.native.setGroupKick).toHaveBeenCalledTimes(1);
  });
  it('reads uncached roles and actual platform join time', async () => {
    const f = fixture();
    await expect(inspectGroupMember(f.client, { groupId: '129043431', userId: '123', signal: f.abort.signal }))
      .resolves.toEqual({ canModerate: true, platformRole: 'member', joinedAt: f.joinedAt });
    expect(f.native.getGroupMemberInfo).toHaveBeenCalledWith(129043431, 8596238, true);
    expect(f.native.getGroupMemberInfo).toHaveBeenCalledWith(129043431, 123, true);
  });

  it.each(['owner', 'admin', 'member'] as const)('reads the Bot %s role once without inferring it from moderation permission', async role => {
    const f = fixture(); f.self.role = role;
    await expect(inspectGroupMember(f.client, { groupId: '129043431', userId: '8596238', signal: f.abort.signal }))
      .resolves.toEqual({ canModerate: false, platformRole: role });
    expect(f.native.getGroupMemberInfo).toHaveBeenCalledExactlyOnceWith(129043431, 8596238, true);
    expect(f.native.setGroupBan).not.toHaveBeenCalled();
    expect(f.native.setGroupKick).not.toHaveBeenCalled();
  });

  it.each(['user_id', 'group_id'] as const)('does not attach a role when the returned %s does not match', async field => {
    const f = fixture(); f.self[field] = 999;
    await expect(inspectGroupMember(f.client, { groupId: '129043431', userId: '8596238', signal: f.abort.signal }))
      .resolves.toEqual({ canModerate: false });
  });

  it('preserves platform errors and rejects results arriving after cancellation', async () => {
    const f = fixture(); const error = new Error('platform member lookup failed');
    f.native.getGroupMemberInfo.mockRejectedValueOnce(error);
    await expect(inspectGroupMember(f.client, { groupId: '129043431', userId: '8596238', signal: f.abort.signal })).rejects.toBe(error);
    f.native.getGroupMemberInfo.mockImplementation(async () => {
      f.abort.abort(new Error('turn retired'));
      return f.self;
    });
    await expect(inspectGroupMember(f.client, { groupId: '129043431', userId: '8596238', signal: f.abort.signal })).rejects.toMatchObject({ disposition: 'unknown', cause: f.abort.signal.reason });
  });

  it.each(['owner', 'admin'])('refuses to moderate a %s', async (role) => {
    const f = fixture(); f.member.role = role as MemberInfo['role'];
    await expect(moderateGroupMember({ client: f.client, isActive: () => true }, { groupId: '129043431', userId: '123', action: { type: 'mute', durationSeconds: 600 }, signal: f.abort.signal })).rejects.toThrow('permission');
    expect(f.native.setGroupBan).not.toHaveBeenCalled();
  });

  it('refuses a permission loss between review and action', async () => {
    const f = fixture();
    await inspectGroupMember(f.client, { groupId: '129043431', userId: '123', signal: f.abort.signal });
    f.self.role = 'member';
    await expect(moderateGroupMember({ client: f.client, isActive: () => true }, { groupId: '129043431', userId: '123', action: { type: 'mute', durationSeconds: 600 }, signal: f.abort.signal })).rejects.toThrow('permission');
  });

  it.each(['rejoined', 'expired', 'missing'])('refuses newcomer kicks with %s join facts', async (mode) => {
    const f = fixture(); const approved = f.joinedAt;
    if (mode === 'rejoined') f.member.join_time -= 1;
    if (mode === 'expired') vi.spyOn(Date, 'now').mockReturnValue(approved + 600_001);
    if (mode === 'missing') f.member.join_time = 0;
    try {
      await expect(moderateGroupMember({ client: f.client, isActive: () => true }, { groupId: '129043431', userId: '123', action: { type: 'kick', joinedAt: approved, maxMembershipAgeMs: 600_000 }, signal: f.abort.signal })).rejects.toThrow('membership');
      expect(f.native.setGroupKick).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });

  it('rejects stale generations after the awaited platform reads', async () => {
    const f = fixture();
    await expect(moderateGroupMember({ client: f.client, isActive: () => false }, { groupId: '129043431', userId: '123', action: { type: 'mute', durationSeconds: 600 }, signal: f.abort.signal })).rejects.toThrow('permission');
    expect(f.native.setGroupBan).not.toHaveBeenCalled();
  });

  it('does not report a false SDK result as successful or retry it', async () => {
    const f = fixture(); f.native.setGroupKick.mockResolvedValue(false);
    await expect(moderateGroupMember({ client: f.client, isActive: () => true }, { groupId: '129043431', userId: '123', action: { type: 'kick', joinedAt: f.joinedAt, maxMembershipAgeMs: 600_000 }, signal: f.abort.signal })).rejects.toThrow('confirm');
    expect(f.native.setGroupKick).toHaveBeenCalledTimes(1);
  });
});
