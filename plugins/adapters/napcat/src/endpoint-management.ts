/**
 * NapCat endpoint management 语义端口（Console 社交面 RPC 消费，见
 * packages/im/adapter/src/endpoint-management.ts）。
 *
 * 归一化取舍：
 * - friend → {user_id:number, nickname, remark: remark ?? ''}
 * - group → {group_id:number, name: group_name ?? name}
 * - 群成员列表保持 OneBot11 原生形状，仅保证数组
 */
import type {
  EndpointFriend,
  EndpointGroup,
  EndpointManagement,
} from 'zhin.js/adapter';

/** 管理面只依赖 endpoint 的 callApi（ws/wss/http 三种传输各自实现）。 */
export interface NapCatManagementCaller {
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
}

export function createNapCatEndpointManagement(
  endpoint: NapCatManagementCaller,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listFriends(): Promise<readonly EndpointFriend[]> {
      const data = await endpoint.callApi('get_friend_list');
      return toArray(data).map((value) => {
        const friend = asRecord(value);
        return {
          user_id: toNumberId(friend.user_id, 'user_id'),
          nickname: String(friend.nickname ?? ''),
          remark: String(friend.remark ?? ''),
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
        group_id: toNumberId(groupId, 'group_id'),
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

/** console RPC 传入的 gid/uid 可能是字符串，统一收敛为数字。 */
function toNumberId(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? '').trim() === '') {
    throw new TypeError(`napcat ${label} 必须是数字: ${String(value)}`);
  }
  return n;
}
