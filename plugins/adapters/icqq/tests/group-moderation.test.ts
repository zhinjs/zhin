import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectGroupMember, moderateGroupMember } from '../src/group-moderation.js';
import type { Client, MemberInfo } from '@icqqjs/icqq';
import kickTool from '../agents/icqq/skills/icqq-group-admin/tools/group_kick/index.ts';
import setAdminTool from '../agents/icqq/skills/icqq-group-admin/tools/set_group_admin/index.ts';

function fixture() {
  const joinedAt = Date.now() - 1000;
  const self = { user_id: 8596238, group_id: 129043431, role: 'admin' } as MemberInfo;
  const member = { user_id: 123, group_id: 129043431, role: 'member', join_time: Math.floor(joinedAt / 1000) } as MemberInfo;
  const native = {
    uin: 8596238, isOnline: () => true,
    getGroupMemberInfo: vi.fn(async (_group: number, id: number) => id === 8596238 ? self : member),
    setGroupKick: vi.fn(async () => true), setGroupBan: vi.fn(async () => true),
    setGroupAdmin: vi.fn(async () => true),
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
  describe('set_group_admin', () => {
    const run = (f: ReturnType<typeof fixture>, enabled: boolean, user_id = 123) => setAdminTool.execute(
      { group_id: 129043431, user_id, enabled, reason: '经人工确认' },
      { $client: f.client, signal: f.abort.signal, locale: 'en' } as never);

    it('is owner-only and human-approved', () => {
      expect(setAdminTool).toMatchObject({ requiresApproval: 'human', currentConversationBotRoles: ['owner'],
        permissions: ['role(master,admin,trusted,owner)'], scopes: ['group'] });
    });

    it.each([[true, 'member', 'Member 123 is now an administrator'], [false, 'admin', 'Administrator role removed from 123']] as const)(
      'enabled=%s changes a %s with fresh role reads', async (enabled, role, message) => {
        const f = fixture(); f.self.role = 'owner'; f.member.role = role;
        await expect(run(f, enabled)).resolves.toEqual({ success: true, message });
        expect(f.native.getGroupMemberInfo).toHaveBeenCalledWith(129043431, 8596238, true);
        expect(f.native.getGroupMemberInfo).toHaveBeenCalledWith(129043431, 123, true);
        expect(f.native.setGroupAdmin).toHaveBeenCalledExactlyOnceWith(129043431, 123, enabled);
      });

    it.each(['admin', 'member'] as const)('refuses when the Bot is only %s at execution time', async role => {
      const f = fixture(); f.self.role = role;
      await expect(run(f, true)).resolves.toMatchObject({ success: false, message: 'The bot must be the group owner to set or remove administrators' });
      expect(f.native.setGroupAdmin).not.toHaveBeenCalled();
    });

    it.each([[true, 'admin'], [true, 'owner'], [false, 'member'], [false, 'owner']] as const)(
      'enabled=%s refuses a %s target', async (enabled, role) => {
        const f = fixture(); f.self.role = 'owner'; f.member.role = role;
        await expect(run(f, enabled)).resolves.toMatchObject({ success: false, message: expect.stringContaining("role does not allow") });
        expect(f.native.setGroupAdmin).not.toHaveBeenCalled();
      });

    it('refuses self and missing targets', async () => {
      const f = fixture(); f.self.role = 'owner';
      await expect(run(f, false, 8596238)).resolves.toMatchObject({ success: false });
      f.native.getGroupMemberInfo.mockImplementation(async (_g: number, id: number) => {
        if (id === 8596238) return f.self;
        throw new Error('not a member');
      });
      await expect(run(f, true)).resolves.toMatchObject({ success: false, message: 'The target member does not exist' });
      expect(f.native.setGroupAdmin).not.toHaveBeenCalled();
    });

    it.each(['false', 'throw'] as const)('reports an unconfirmed result (%s) without retrying', async mode => {
      const f = fixture(); f.self.role = 'owner';
      if (mode === 'false') f.native.setGroupAdmin.mockResolvedValue(false);
      else f.native.setGroupAdmin.mockRejectedValue(new Error('platform error'));
      await expect(run(f, true)).resolves.toMatchObject({ success: false, message: 'The platform did not confirm the administrator change; do not retry automatically' });
      expect(f.native.setGroupAdmin).toHaveBeenCalledTimes(1);
    });
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
