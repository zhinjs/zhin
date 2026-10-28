import type { Client } from '@icqqjs/icqq';
import type { GroupModerationAction, GroupModerationMember } from 'zhin.js/adapter';

/** Native role/join facts stay in the adapter; the moderation plugin owns policy. */
export async function inspectGroupMember(
  client: Client, groupId: string, userId: string, signal: AbortSignal,
): Promise<GroupModerationMember> {
  signal.throwIfAborted();
  const group = numericId(groupId);
  const user = numericId(userId);
  const selfLookup = client.getGroupMemberInfo(group, client.uin, true);
  const [self, member] = await Promise.all([
    selfLookup,
    user === client.uin ? selfLookup : client.getGroupMemberInfo(group, user, true),
  ]);
  signal.throwIfAborted();
  const joinedAt = member.join_time * 1000;
  const platformRole = member.user_id === user && member.group_id === group
    && (member.role === 'owner' || member.role === 'admin' || member.role === 'member')
    ? member.role : undefined;
  return {
    canModerate: client.isOnline() && user !== client.uin
      && self.user_id === client.uin && self.group_id === group
      && member.user_id === user && member.group_id === group
      && (self.role === 'owner' || self.role === 'admin') && member.role === 'member',
    ...(platformRole ? { platformRole } : {}),
    ...(Number.isSafeInteger(joinedAt) && joinedAt > 0 && joinedAt <= Date.now() ? { joinedAt } : {}),
  };
}

export async function moderateGroupMember(
  client: Client, groupId: string, userId: string, action: GroupModerationAction,
  signal: AbortSignal, isActive: () => boolean,
): Promise<void> {
  const member = await inspectGroupMember(client, groupId, userId, signal);
  signal.throwIfAborted();
  if (!isActive() || !member.canModerate) throw new Error('Group moderation permission is unavailable');
  if (action.type === 'kick') {
    if (!Number.isSafeInteger(action.maxMembershipAgeMs) || action.maxMembershipAgeMs <= 0
      || member.joinedAt !== action.joinedAt || !member.joinedAt
      || Date.now() - member.joinedAt > action.maxMembershipAgeMs) {
      throw new Error('Group membership no longer matches the approved newcomer window');
    }
  } else if (!Number.isSafeInteger(action.durationSeconds) || action.durationSeconds <= 0) {
    throw new Error('Invalid group mute duration');
  }
  const ok = action.type === 'kick'
    ? await client.setGroupKick(numericId(groupId), numericId(userId))
    : await client.setGroupBan(numericId(groupId), numericId(userId), action.durationSeconds);
  if (!ok) throw new Error('Platform did not confirm the moderation action');
}

function numericId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) throw new Error('Invalid QQ identifier');
  return id;
}
