/**
 * NapCat endpoint management 语义端口（Console 社交面 RPC 消费，见
 * packages/im/adapter/src/endpoint-management.ts）。
 *
 * 归一化取舍：
 * - friend → {user_id:number, nickname, remark: remark ?? ''}
 * - group → {group_id:number, name: group_name ?? name}
 * - 群成员列表保持 OneBot11 原生形状，仅保证数组
 */
import {
  type PendingRpcRequest,
  type EndpointFriend,
  type EndpointGroup,
  type EndpointManagement,
  type EndpointManagementRequest,
  type EndpointGroupRequest,
  type EndpointGroupNoticeRequest,
} from 'zhin.js/adapter';
import { standingFromMemberRole, type PlatformStanding, type SelfStandingRequest } from '@zhin.js/im-contract';

/** 管理面只依赖 endpoint 的 callApi（ws/wss/http 三种传输各自实现）。 */
export interface NapCatManagementCaller {
  requestApi(request: PendingRpcRequest): Promise<unknown>;
}

export function createNapCatEndpointManagement(
  endpoint: NapCatManagementCaller,
): EndpointManagement {
  let selfId: string | undefined;
  return Object.freeze<EndpointManagement>({
    /** ADR 0056 §1: the Bot's own group role (`get_login_info` once, then `get_group_member_info` self). */
    async inspectSelfStanding({ conversation, signal }: SelfStandingRequest): Promise<PlatformStanding | undefined> {
      if (conversation.kind !== 'group') return undefined;
      if (!selfId) {
        const login = asRecord(await endpoint.requestApi({ action: 'get_login_info', signal }));
        const id = login.user_id;
        selfId = (typeof id === 'number' && id > 0) || (typeof id === 'string' && id.trim() !== '' && id !== '0') ? String(id) : undefined;
      }
      if (!selfId) return undefined;
      const data = asRecord(await endpoint.requestApi({ action: 'get_group_member_info', signal, params: {
        group_id: toNumberId(conversation.id, 'group_id'), user_id: toNumberId(selfId, 'user_id'), no_cache: true,
      } }));
      return standingFromMemberRole(data.role);
    },
    async listFriends(request: EndpointManagementRequest = {}): Promise<readonly EndpointFriend[]> {
      const data = await endpoint.requestApi({ action: 'get_friend_list', signal: request.signal });
      return toArray(data).map((value) => {
        const friend = asRecord(value);
        return {
          user_id: toNumberId(friend.user_id, 'user_id'),
          nickname: String(friend.nickname ?? ''),
          remark: String(friend.remark ?? ''),
        };
      });
    },
    async listGroups(request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> {
      const data = await endpoint.requestApi({ action: 'get_group_list', signal: request.signal });
      return toArray(data).map((value) => {
        const group = asRecord(value);
        return {
          group_id: toNumberId(group.group_id, 'group_id'),
          name: String(group.group_name ?? group.name ?? ''),
        };
      });
    },
    async listGroupMembers({ groupId, signal }: EndpointGroupRequest): Promise<readonly unknown[]> {
      const data = await endpoint.requestApi({ action: 'get_group_member_list', params: {
        group_id: toNumberId(groupId, 'group_id'),
      }, signal });
      return toArray(data);
    },
    async sendGroupNotice({ groupId, content, signal }: EndpointGroupNoticeRequest): Promise<void> {
      await endpoint.requestApi({ action: '_send_group_notice', params: {
        group_id: toNumberId(groupId, 'group_id'),
        content,
      }, signal });
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
