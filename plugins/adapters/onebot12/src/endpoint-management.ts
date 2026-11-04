/**
 * OneBot12 endpoint management 语义端口（Console 社交面 RPC 消费，见
 * packages/im/adapter/src/endpoint-management.ts）。
 *
 * 动作名对齐 OB12 规范：get_friend_list / get_group_list / get_group_member_list。
 * 投影仅归一化展示字段；OB12 账号与会话 ID 始终保留为不透明字符串：
 * - friend → {user_id:string, nickname: user_name, remark: user_displayname ?? ''}
 * - group → {group_id:string, name: group_name ?? name}
 * - 群成员列表保持 OB12 原生形状，仅保证数组
 */
import {
  type EndpointFriend,
  type EndpointGroup,
  type EndpointManagement,
  type EndpointManagementRequest,
  type EndpointGroupRequest,
  type PendingRpcRequest,
} from 'zhin.js/adapter';

/** 管理面只依赖 endpoint 的 callApi（ws/wss/webhook 三种传输各自实现）。 */
export interface OneBot12ManagementCaller {
  callApi(request: PendingRpcRequest): Promise<unknown>;
}

export function createOneBot12EndpointManagement(
  endpoint: OneBot12ManagementCaller,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listFriends(request: EndpointManagementRequest = {}): Promise<readonly EndpointFriend[]> {
      const data = await endpoint.callApi({ action: 'get_friend_list', signal: request.signal });
      return toArray(data).map((value) => {
        const friend = asRecord(value);
        return {
          user_id: readOpaqueId(friend.user_id, 'user_id'),
          nickname: String(friend.user_name ?? friend.nickname ?? ''),
          remark: String(friend.user_displayname ?? friend.remark ?? ''),
        };
      });
    },
    async listGroups(request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> {
      const data = await endpoint.callApi({ action: 'get_group_list', signal: request.signal });
      return toArray(data).map((value) => {
        const group = asRecord(value);
        return {
          group_id: readOpaqueId(group.group_id, 'group_id'),
          name: String(group.group_name ?? group.name ?? ''),
        };
      });
    },
    async listGroupMembers({ groupId, signal }: EndpointGroupRequest): Promise<readonly unknown[]> {
      const data = await endpoint.callApi({ action: 'get_group_member_list', signal, params: {
        group_id: groupId,
      } });
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

/** Platform IDs are addresses, including nonnumeric IDs and integers beyond Number precision. */
function readOpaqueId(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new TypeError(`onebot12 ${label} must be an opaque string or safe integer platform ID`);
}
