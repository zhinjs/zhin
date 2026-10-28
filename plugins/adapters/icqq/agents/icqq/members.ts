import type { Client, MemberInfo } from '@icqqjs/icqq';

/**
 * 实时查询群成员（跳过缓存）；不在群里或查询失败返回 undefined。
 * 不要用 `pickMember`：它总会返回实体对象（判空永远为真），`is_admin` 等也读旧缓存——Bot 刚被设为管理员时会误判。
 */
export async function freshMember(client: Client, groupId: number, userId: number): Promise<MemberInfo | undefined> {
  try {
    return await client.getGroupMemberInfo(groupId, userId, true);
  } catch {
    return undefined;
  }
}

export function isGroupManager(info: MemberInfo | undefined): boolean {
  return info?.role === 'owner' || info?.role === 'admin';
}
