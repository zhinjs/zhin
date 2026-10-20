/**
 * OneBot12 endpoint management 语义端口（Console 社交面 RPC 消费，见
 * packages/im/adapter/src/endpoint-management.ts）。
 *
 * 动作名对齐 OB12 规范：get_friend_list / get_group_list / get_group_member_list。
 * 归一化取舍（OB12 id 为字符串，收敛为数字）：
 * - friend → {user_id:number, nickname: user_name, remark: user_displayname ?? ''}
 * - group → {group_id:number, name: group_name ?? name}
 * - 群成员列表保持 OB12 原生形状，仅保证数组
 */
import type {
  EndpointFriend,
  EndpointGroup,
  EndpointManagement,
} from 'zhin.js/adapter';

/** 管理面只依赖 endpoint 的 callApi（ws/wss/webhook 三种传输各自实现）。 */
export interface OneBot12ManagementCaller {
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
}

export function createOneBot12EndpointManagement(
  endpoint: OneBot12ManagementCaller,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listFriends(): Promise<readonly EndpointFriend[]> {
      const data = await endpoint.callApi('get_friend_list');
      return toArray(data).map((value) => {
        const friend = asRecord(value);
        return {
          user_id: toNumberId(friend.user_id, 'user_id'),
          nickname: String(friend.user_name ?? friend.nickname ?? ''),
          remark: String(friend.user_displayname ?? friend.remark ?? ''),
        };
      });
    },
    async listGroups(): Promise<readonly EndpointGroup[]> {
      const data = await endpoint.callApi('get_group_list');
      return toArray(data).map((value) => {
        const group = asRecord(value);
        return {
          group_id: toNumberId(group.group_id, 'group_id'),
          name: String(group.group_name ?? group.name ?? ''),
        };
      });
    },
    async listGroupMembers(groupId: string): Promise<readonly unknown[]> {
      const data = await endpoint.callApi('get_group_member_list', {
        group_id: groupId,
      });
      return toArray(data);
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function toArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** OB12 id 是字符串；QQ 系实现均为数字串，统一收敛为数字。 */
function toNumberId(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? '').trim() === '') {
    throw new TypeError(`onebot12 ${label} 必须是数字: ${String(value)}`);
  }
  return n;
}
