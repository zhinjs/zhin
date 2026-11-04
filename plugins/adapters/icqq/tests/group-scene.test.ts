import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client, GroupInfo, MemberInfo } from '@icqqjs/icqq';
import { ADMIN_SCAN_MAX_MEMBERS, inspectGroupMemberProfile, inspectGroupScene } from '../src/group-scene.js';

const GROUP = 129043431;
const nowSeconds = () => Math.floor(Date.now() / 1000);

function fixture(overrides: { info?: Partial<GroupInfo>; members?: Partial<MemberInfo>[] } = {}) {
  const info = {
    group_id: GROUP, group_name: '  测试群 ', member_count: 42, owner_id: 10001,
    shutup_time_whole: 0, ...overrides.info,
  } as GroupInfo;
  const members = (overrides.members ?? [
    { user_id: 10001, role: 'owner' }, { user_id: 10003, role: 'admin' },
    { user_id: 10002, role: 'admin' }, { user_id: 10009, role: 'member' },
  ]).map(m => ({ group_id: GROUP, ...m }) as MemberInfo);
  const native = {
    uin: 8596238,
    getGroupInfo: vi.fn(async () => info),
    getGroupMemberList: vi.fn(async () => new Map(members.map(m => [m.user_id, m] as const))),
    getGroupMemberInfo: vi.fn(async (_g: number, id: number) => ({
      group_id: GROUP, user_id: id, role: 'admin', card: ' 明明 ', title: '老玩家', shutup_time: 0,
    }) as MemberInfo),
  };
  return { info, native, client: native as unknown as Client, signal: new AbortController().signal };
}

afterEach(() => vi.useRealTimers());

describe('ICQQ group scene facts', () => {
  it('maps group info and roster admins with one uncached info read', async () => {
    const f = fixture();
    await expect(inspectGroupScene(f.client, { groupId: String(GROUP), signal: f.signal })).resolves.toEqual({
      name: '测试群', ownerId: '10001', adminIds: ['10003', '10002'], memberCount: 42, muteAll: false,
    });
    expect(f.native.getGroupInfo).toHaveBeenCalledExactlyOnceWith(GROUP, true);
    expect(f.native.getGroupMemberList).toHaveBeenCalledTimes(1);
  });

  it('reports whole-group mute while it is in force', async () => {
    const f = fixture({ info: { shutup_time_whole: 0xffffffff } });
    expect(await inspectGroupScene(f.client, { groupId: String(GROUP), signal: f.signal })).toMatchObject({ muteAll: true });
    const expired = fixture({ info: { shutup_time_whole: nowSeconds() - 10 } });
    expect(await inspectGroupScene(expired.client, { groupId: String(GROUP), signal: expired.signal })).toMatchObject({ muteAll: false });
  });

  it('omits admins instead of failing when the roster read fails', async () => {
    const f = fixture();
    f.native.getGroupMemberList.mockRejectedValueOnce(new Error('roster timeout'));
    const scene = await inspectGroupScene(f.client, { groupId: String(GROUP), signal: f.signal });
    expect(scene).toEqual({ name: '测试群', ownerId: '10001', memberCount: 42, muteAll: false });
    expect('adminIds' in scene).toBe(false);
  });

  it('skips the roster read for very large groups', async () => {
    const f = fixture({ info: { member_count: ADMIN_SCAN_MAX_MEMBERS + 1 } });
    const scene = await inspectGroupScene(f.client, { groupId: String(GROUP), signal: f.signal });
    expect(f.native.getGroupMemberList).not.toHaveBeenCalled();
    expect('adminIds' in scene).toBe(false);
  });

  it('returns nothing for a mismatched group and propagates group-info failure', async () => {
    const f = fixture({ info: { group_id: 1 } });
    expect(await inspectGroupScene(f.client, { groupId: String(GROUP), signal: f.signal })).toEqual({});
    f.native.getGroupInfo.mockRejectedValueOnce(new Error('platform down'));
    await expect(inspectGroupScene(f.client, { groupId: String(GROUP), signal: f.signal })).rejects.toThrow('platform down');
    await expect(inspectGroupScene(f.client, { groupId: 'abc', signal: f.signal })).rejects.toThrow('Invalid QQ identifier');
  });

  it('rejects results arriving after cancellation', async () => {
    const f = fixture(); const abort = new AbortController();
    f.native.getGroupInfo.mockImplementation(async () => { abort.abort(new Error('turn retired')); return f.info; });
    await expect(inspectGroupScene(f.client, { groupId: String(GROUP), signal: abort.signal })).rejects.toMatchObject({ disposition: 'unknown', cause: abort.signal.reason });
  });
});

describe('ICQQ group member profile', () => {
  it('maps role, card, title and a single uncached lookup', async () => {
    const f = fixture();
    await expect(inspectGroupMemberProfile(f.client, { groupId: String(GROUP), userId: '10002', signal: f.signal })).resolves.toEqual({
      platformRole: 'admin', card: '明明', title: '老玩家', mutedUntil: 0,
    });
    expect(f.native.getGroupMemberInfo).toHaveBeenCalledExactlyOnceWith(GROUP, 10002, true);
  });

  it('converts the mute expiry to epoch milliseconds and treats an elapsed one as unmuted', async () => {
    const f = fixture(); const expiry = nowSeconds() + 600;
    f.native.getGroupMemberInfo.mockResolvedValueOnce({ group_id: GROUP, user_id: 10002, role: 'member', card: '', title: '', shutup_time: expiry } as MemberInfo);
    expect(await inspectGroupMemberProfile(f.client, { groupId: String(GROUP), userId: '10002', signal: f.signal })).toEqual({ platformRole: 'member', mutedUntil: expiry * 1000 });
    f.native.getGroupMemberInfo.mockResolvedValueOnce({ group_id: GROUP, user_id: 10002, role: 'member', shutup_time: nowSeconds() - 5 } as MemberInfo);
    expect(await inspectGroupMemberProfile(f.client, { groupId: String(GROUP), userId: '10002', signal: f.signal })).toEqual({ platformRole: 'member', mutedUntil: 0 });
  });

  it('attaches nothing when the returned member does not match the request', async () => {
    const f = fixture();
    f.native.getGroupMemberInfo.mockResolvedValueOnce({ group_id: GROUP, user_id: 999, role: 'owner' } as MemberInfo);
    expect(await inspectGroupMemberProfile(f.client, { groupId: String(GROUP), userId: '10002', signal: f.signal })).toEqual({});
  });
});
