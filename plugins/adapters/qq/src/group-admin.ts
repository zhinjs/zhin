/**
 * QQ 群（group_openid / member_openid）管理：只走官方 v2 群管理接口。
 *
 * 官方限制（https://bot.q.qq.com/wiki/develop/api-v2/autogen/）：
 * - 成员列表 / 成员信息 / 批量移除 / 黑名单 / 入群申请多为白名单能力，无权限返回 11253；
 * - 禁言与入群审批要求机器人是群管理员；禁言最长 30 天，只能禁言普通成员；
 * - 没有「机器人所在群列表」「好友列表」「退群」「设管理员」「群公告」等接口。
 */
import type {
  GroupBotState,
  GroupMemberInfo,
  GroupMemberRole,
} from 'qq-official-bot';
import {
  createEndpointOperation,
  type EndpointGroupRequest, type EndpointMemberRequest, type EndpointMuteRequest,
  type EndpointGroupInspectionRequest, type EndpointMemberInspectionRequest, type EndpointModerationRequest,
  type GroupMemberProfile,
  type GroupModerationMember,
  type GroupSceneFacts,
} from 'zhin.js/adapter';
import type { QqOfficialApi } from './ws.js';

/** 官方 restrict_chat_setting 上限：30 天。 */
export const QQ_GROUP_MUTE_MAX_SECONDS = 30 * 24 * 60 * 60;

export type QqGroupService = QqOfficialApi['groupService'];

export function qqGroupService(api: Partial<QqOfficialApi> | undefined): QqGroupService {
  const service = api?.groupService;
  if (!service) throw new Error('QQ group management API is unavailable on this transport');
  return service;
}

export function isQqGroupManagerRole(role: unknown): role is 'owner' | 'admin' {
  return role === 'owner' || role === 'admin';
}

function platformRole(role: unknown): GroupMemberRole | undefined {
  return role === 'owner' || role === 'admin' || role === 'member' ? role : undefined;
}

function requireId(value: string, what: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || /[\s/?#]/.test(id)) throw new Error(`Invalid QQ ${what}`);
  return id;
}

/** RFC3339 → epoch ms；非法或未来时间返回 undefined（从不猜测）。 */
export function parseQqTime(value: unknown, { allowFuture = false } = {}): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at <= 0) return undefined;
  if (!allowFuture && at > Date.now()) return undefined;
  return at;
}

/** 只读、实时：机器人在群里的状态（角色、是否允许主动消息、接收设置）。 */
export async function qqGroupBotState(api: Partial<QqOfficialApi> | undefined, { groupId, signal }: EndpointGroupRequest): Promise<GroupBotState> {
  return createEndpointOperation({ signal }).run(() => qqGroupService(api).getBotState(requireId(groupId, 'group id')));
}

export async function qqGroupMember(api: Partial<QqOfficialApi> | undefined, { groupId, userId, signal }: EndpointMemberRequest): Promise<GroupMemberInfo> {
  return createEndpointOperation({ signal }).run(() => qqGroupService(api).getMemberInfo(requireId(groupId, 'group id'), requireId(userId, 'member id')));
}

/** 禁言 / 解除禁言一个普通成员；0 = 解除。 */
export async function muteQqGroupMember(
  api: Partial<QqOfficialApi> | undefined, { groupId, userId, durationSeconds, signal }: EndpointMuteRequest,
): Promise<void> {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > QQ_GROUP_MUTE_MAX_SECONDS) {
    throw new RangeError(`QQ group mute duration must be 0..${QQ_GROUP_MUTE_MAX_SECONDS} seconds`);
  }
  const member = requireId(userId, 'member id');
  await createEndpointOperation({ signal }).run(() => qqGroupService(api).setMemberMute(requireId(groupId, 'group id'), [durationSeconds === 0
    ? { op: 'del', member_openid: member, mute_expire_at: '' }
    : { op: 'add', member_openid: member, mute_expire_at: new Date(Date.now() + durationSeconds * 1000).toISOString() }]));
}

/** 移出一个成员；可选同时加入群黑名单。平台未确认 success 时抛错，不把未确认当成功。 */
export async function kickQqGroupMember(
  api: Partial<QqOfficialApi> | undefined, { groupId, userId, addToBlacklist = false, signal }: EndpointMemberRequest & { readonly addToBlacklist?: boolean },
): Promise<{ blacklistFailed: boolean }> {
  const member = requireId(userId, 'member id');
  const result = await createEndpointOperation({ signal }).run(() => qqGroupService(api).removeMembers(requireId(groupId, 'group id'), {
    member_openids: [member],
    ...(addToBlacklist ? { add_to_member_blacklist: true } : {}),
  }));
  if (result?.remove_members_result !== 'success') throw new Error('QQ did not confirm the member removal');
  return { blacklistFailed: addToBlacklist && (result.add_to_member_blacklist_fail_openids ?? []).includes(member) };
}

/** 自动审核用：机器人与目标成员的实时角色；平台只允许管理员处置普通成员（且非机器人）。 */
export async function inspectQqGroupMember(
  api: Partial<QqOfficialApi> | undefined, { groupId, userId, signal }: EndpointMemberInspectionRequest,
): Promise<GroupModerationMember> {
  signal.throwIfAborted();
  const [self, member] = await Promise.all([qqGroupBotState(api, { groupId, signal }), qqGroupMember(api, { groupId, userId, signal })]);
  signal.throwIfAborted();
  const role = member.member_openid === userId ? platformRole(member.member_role) : undefined;
  const joinedAt = parseQqTime(member.joined_at);
  return {
    canModerate: isQqGroupManagerRole(self.member_role) && self.member_openid !== userId
      && member.member_openid === userId && role === 'member' && member.bot !== true,
    ...(role ? { platformRole: role } : {}),
    ...(joinedAt ? { joinedAt } : {}),
  };
}

export async function moderateQqGroupMember(
  { api, isActive }: { readonly api: Partial<QqOfficialApi> | undefined; readonly isActive: () => boolean },
  { groupId, userId, action, signal }: EndpointModerationRequest,
): Promise<void> {
  const member = await inspectQqGroupMember(api, { groupId: groupId, userId: userId, signal: signal });
  signal.throwIfAborted();
  if (!isActive() || !member.canModerate) throw new Error('Group moderation permission is unavailable');
  if (action.type === 'kick') {
    if (!Number.isSafeInteger(action.maxMembershipAgeMs) || action.maxMembershipAgeMs <= 0
      || !member.joinedAt || member.joinedAt !== action.joinedAt
      || Date.now() - member.joinedAt > action.maxMembershipAgeMs) {
      throw new Error('Group membership no longer matches the approved newcomer window');
    }
    await kickQqGroupMember(api, { groupId, userId, signal });
    return;
  }
  if (!Number.isSafeInteger(action.durationSeconds) || action.durationSeconds <= 0) {
    throw new Error('Invalid group mute duration');
  }
  await muteQqGroupMember(api, { groupId: groupId, userId: userId, durationSeconds: Math.min(action.durationSeconds, QQ_GROUP_MUTE_MAX_SECONDS), signal });
}

/** ADR 0041 场景事实：一次群信息读取；官方群信息不含群主/管理员/全员禁言，留作 unknown。 */
export async function inspectQqGroupScene(
  api: Partial<QqOfficialApi> | undefined, { groupId, signal }: EndpointGroupInspectionRequest,
): Promise<GroupSceneFacts> {
  signal.throwIfAborted();
  const info = await createEndpointOperation({ signal }).run(() => qqGroupService(api).getInfo(requireId(groupId, 'group id')));
  signal.throwIfAborted();
  if (info?.group_openid && info.group_openid !== groupId) return {};
  const name = typeof info?.group_name === 'string' && info.group_name.trim() ? info.group_name.trim() : undefined;
  const memberCount = Number.isSafeInteger(info?.group_member_num) && info.group_member_num > 0 ? info.group_member_num : undefined;
  return { ...(name ? { name } : {}), ...(memberCount ? { memberCount } : {}) };
}

/** ADR 0041 成员事实：一次成员读取（群名片/头衔/禁言到期官方不提供）。 */
export async function inspectQqGroupMemberProfile(
  api: Partial<QqOfficialApi> | undefined, { groupId, userId, signal }: EndpointMemberInspectionRequest,
): Promise<GroupMemberProfile> {
  signal.throwIfAborted();
  const member = await qqGroupMember(api, { groupId, userId, signal });
  signal.throwIfAborted();
  if (member.member_openid !== userId) return {};
  const role = platformRole(member.member_role);
  return role ? { platformRole: role } : {};
}
