/**
 * Milky endpoint management 语义端口（Console 社交面 RPC 消费，见
 * packages/im/adapter/src/endpoint-management.ts）。
 *
 * Milky 协议响应 data 为包裹对象：get_friend_list → {friends:[...]}、
 * get_group_list → {groups:[...]}、get_group_member_list → {members:[...]}。
 * 归一化取舍：
 * - friend → {user_id:number, nickname, remark: remark ?? ''}
 * - group → {group_id:number, name: group_name ?? name}
 * - 群成员列表保持 Milky 原生形状，仅保证数组
 */
import {
  type EndpointFriend,
  type EndpointGroup,
  type EndpointManagement,
  type EndpointManagementRequest,
  type EndpointGroupRequest,
  type PendingRpcRequest,
} from 'zhin.js/adapter';
import { standingFromMemberRole, type PlatformStanding, type SelfStandingRequest } from '@zhin.js/im-contract';

/** 管理面只依赖 endpoint 的 callApi（ws/wss/sse/webhook 四种传输各自实现）。 */
export interface MilkyManagementCaller {
  callApi(request: PendingRpcRequest): Promise<unknown>;
}

/** How long one `get_login_info` answer is reused (bursts only; see inspectSelfStanding). */
const SELF_ID_TTL_MS = 5_000;

export function createMilkyEndpointManagement(
  endpoint: MilkyManagementCaller,
): EndpointManagement {
  // The login account can change across reconnects (or a different account on the same
  // connection), so `get_login_info` is not remembered for the endpoint's lifetime: only briefly,
  // to coalesce bursts, and never across a failed lookup.
  let login: { readonly id: string; readonly at: number } | undefined;
  const loginId = async (signal: AbortSignal | undefined): Promise<string | undefined> => {
    if (login && Date.now() - login.at < SELF_ID_TTL_MS) return login.id;
    login = undefined;
    const info = asRecord(await endpoint.callApi({ action: 'get_login_info', signal }));
    const id = info.uin ?? info.user_id;
    const value = (typeof id === 'number' && id > 0) || (typeof id === 'string' && id.trim() !== '' && id !== '0') ? String(id) : undefined;
    if (value) login = { id: value, at: Date.now() };
    return value;
  };
  return Object.freeze<EndpointManagement>({
    /** ADR 0056 §1: the Bot's own group role (`get_login_info`, then `get_group_member_info` self). */
    async inspectSelfStanding({ conversation, signal }: SelfStandingRequest): Promise<PlatformStanding | undefined> {
      if (conversation.kind !== 'group') return undefined;
      const selfId = await loginId(signal);
      if (!selfId) return undefined;
      let data: Record<string, unknown>;
      try {
        data = asRecord(await endpoint.callApi({ action: 'get_group_member_info', signal, params: {
          group_id: toNumberId(conversation.id, 'group_id'), user_id: toNumberId(selfId, 'user_id'), no_cache: true,
        } }));
      } catch (error) {
        login = undefined;
        throw error;
      }
      return standingFromMemberRole(asRecord(data.member).role ?? data.role);
    },
    async listFriends(request: EndpointManagementRequest = {}): Promise<readonly EndpointFriend[]> {
      const data = asRecord(await endpoint.callApi({ action: 'get_friend_list', signal: request.signal }));
      return toArray(data.friends).map((value) => {
        const friend = asRecord(value);
        return {
          user_id: toNumberId(friend.user_id, 'user_id'),
          nickname: String(friend.nickname ?? ''),
          remark: String(friend.remark ?? ''),
        };
      });
    },
    async listGroups(request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> {
      const data = asRecord(await endpoint.callApi({ action: 'get_group_list', signal: request.signal }));
      return toArray(data.groups).map((value) => {
        const group = asRecord(value);
        return {
          group_id: toNumberId(group.group_id, 'group_id'),
          name: String(group.group_name ?? group.name ?? ''),
        };
      });
    },
    async listGroupMembers({ groupId, signal }: EndpointGroupRequest): Promise<readonly unknown[]> {
      const data = asRecord(await endpoint.callApi({ action: 'get_group_member_list', signal, params: {
        group_id: toNumberId(groupId, 'group_id'),
      } }));
      return toArray(data.members);
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
    throw new TypeError(`milky ${label} 必须是数字: ${String(value)}`);
  }
  return n;
}
