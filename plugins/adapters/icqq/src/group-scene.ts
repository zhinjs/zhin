import type { Client } from '@icqqjs/icqq';
import type { GroupMemberProfile, GroupSceneFacts } from 'zhin.js/adapter';

/** Listing a very large roster only to find admins is not worth the packet; adminIds stay unknown. */
export const ADMIN_SCAN_MAX_MEMBERS = 1000;
const MAX_ADMIN_IDS = 20;

function positiveId(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
}

function numericId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) throw new Error('Invalid QQ identifier');
  return id;
}

/**
 * ADR 0041 scene facts: one uncached group-info read, plus (small groups only) one roster read for
 * admins. A roster failure leaves adminIds unknown instead of failing the other facts.
 */
export async function inspectGroupScene(client: Client, groupId: string, signal: AbortSignal): Promise<GroupSceneFacts> {
  signal.throwIfAborted();
  const group = numericId(groupId);
  const info = await client.getGroupInfo(group, true);
  signal.throwIfAborted();
  if (info.group_id !== group) return {};
  const memberCount = Number.isSafeInteger(info.member_count) && info.member_count > 0 ? info.member_count : undefined;
  const ownerId = positiveId(info.owner_id);
  let adminIds: string[] | undefined;
  if (memberCount === undefined || memberCount <= ADMIN_SCAN_MAX_MEMBERS) {
    try {
      const roster = await client.getGroupMemberList(group);
      signal.throwIfAborted();
      adminIds = [...roster.values()]
        .filter(member => member.role === 'admin' && member.group_id === group)
        .map(member => positiveId(member.user_id))
        .filter((id): id is string => id !== undefined)
        .slice(0, MAX_ADMIN_IDS);
    } catch {
      signal.throwIfAborted();
      adminIds = undefined;
    }
  }
  const name = typeof info.group_name === 'string' && info.group_name.trim() ? info.group_name.trim() : undefined;
  const nowSeconds = Date.now() / 1000;
  return {
    ...(name ? { name } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(adminIds ? { adminIds } : {}),
    ...(memberCount !== undefined ? { memberCount } : {}),
    ...(typeof info.shutup_time_whole === 'number' ? { muteAll: info.shutup_time_whole > nowSeconds } : {}),
  };
}

/** ADR 0041 member facts from one uncached lookup (same rationale as the agent `freshMember` helper). */
export async function inspectGroupMemberProfile(
  client: Client, groupId: string, userId: string, signal: AbortSignal,
): Promise<GroupMemberProfile> {
  signal.throwIfAborted();
  const group = numericId(groupId);
  const user = numericId(userId);
  const member = await client.getGroupMemberInfo(group, user, true);
  signal.throwIfAborted();
  if (member.user_id !== user || member.group_id !== group) return {};
  const card = typeof member.card === 'string' && member.card.trim() ? member.card.trim() : undefined;
  const title = typeof member.title === 'string' && member.title.trim() ? member.title.trim() : undefined;
  const shutupSeconds = member.shutup_time;
  return {
    ...(member.role === 'owner' || member.role === 'admin' || member.role === 'member' ? { platformRole: member.role } : {}),
    ...(card ? { card } : {}),
    ...(title ? { title } : {}),
    ...(typeof shutupSeconds === 'number' && Number.isFinite(shutupSeconds)
      ? { mutedUntil: shutupSeconds * 1000 > Date.now() ? shutupSeconds * 1000 : 0 } : {}),
  };
}
