import type { ConsoleRpcExtendedCtx, EndpointManagementPort, ExtendedRpcResult } from './contracts.js';
import { boolField, numField, strField, withLiveEndpoint } from './rpc-values.js';

export async function listFriends(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const endpoint = requireEndpointAddress(d);
  if ('error' in endpoint) return endpoint;
  return withLiveEndpoint(ctx, endpoint.adapter, endpoint.endpointKey, async (management) => {
    if (management.listFriends) {
      const friends = [...await management.listFriends()];
      return { data: { friends, count: friends.length } };
    }
    return { error: `当前适配器（${endpoint.adapter}）不支持好友列表` };
  });
}

export async function listGroups(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const endpoint = requireEndpointAddress(d);
  if ('error' in endpoint) return endpoint;
  return withLiveEndpoint(ctx, endpoint.adapter, endpoint.endpointKey, async (management) => {
    if (management.listGroups) {
      const groups = [...await management.listGroups()];
      return { data: { groups, count: groups.length } };
    }
    return { error: `当前适配器（${endpoint.adapter}）不支持群列表` };
  });
}

export async function listChannels(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const endpoint = requireEndpointAddress(d);
  if ('error' in endpoint) return endpoint;
  return withLiveEndpoint(ctx, endpoint.adapter, endpoint.endpointKey, async (management) => {
    if (management.listChannels) {
      const channels = [...await management.listChannels()];
      return { data: { channels, count: channels.length } };
    }
    return { error: `当前适配器（${endpoint.adapter}）不支持频道列表` };
  });
}

export async function listGroupMembers(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  const groupId = strField(d, 'groupId');
  if (!adapter || !endpointKey || !groupId) {
    return { error: 'adapter, endpointKey, and groupId are required' };
  }
  return withLiveEndpoint(ctx, adapter, endpointKey, async (management) => {
    const method = management.listGroupMembers;
    if (!method) {
      return { error: `当前适配器（${adapter}）不支持群成员列表` };
    }
    const members = [...await method(groupId)];
    return { data: { members, count: members.length } };
  });
}

// ---------------------------------------------------------------- 群管/好友写操作

interface GroupWriteSpec {
  method: 'kickGroupMember' | 'muteGroupMember' | 'setGroupAdmin';
  buildArgs(groupId: string, userId: string, extra: { duration?: number; enable?: boolean }): unknown[];
  requireUser: boolean;
  /** 中文操作名，用于"该平台不支持 xxx"。 */
  unsupported: string;
}

export async function groupWriteOp(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
  spec: GroupWriteSpec,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  const groupId = strField(d, 'groupId');
  const userId = strField(d, 'userId');
  if (!adapter || !endpointKey || !groupId) {
    return { error: 'adapter, endpointKey, and groupId are required' };
  }
  if (spec.requireUser && !userId) {
    return { error: 'userId is required' };
  }
  return withLiveEndpoint(ctx, adapter, endpointKey, async (management) => {
    const method = management[spec.method];
    if (!method) {
      return { error: `当前适配器（${adapter}）不支持${spec.unsupported}` };
    }
    const durationRaw = d.duration;
    const enableRaw = d.enable;
    const args = spec.buildArgs(groupId, userId, {
      duration: typeof durationRaw === 'number' && Number.isFinite(durationRaw)
        ? durationRaw
        : undefined,
      enable: typeof enableRaw === 'boolean' ? enableRaw : undefined,
    });
    await (method as (...args: unknown[]) => Promise<void>).call(management, ...args);
    return { data: { success: true } };
  });
}

export async function deleteFriend(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  const userId = strField(d, 'userId');
  if (!adapter || !endpointKey || !userId) {
    return { error: 'adapter, endpointKey, and userId are required' };
  }
  return withLiveEndpoint(ctx, adapter, endpointKey, async (management) => {
    const method = management.deleteFriend;
    if (!method) {
      return { error: '当前适配器暂不支持删除好友' };
    }
    await method(userId);
    return { data: { success: true } };
  });
}

// ---------------------------------------------------------------- helpers


function requireEndpointAddress(
  d: Record<string, unknown>,
): { adapter: string; endpointKey: string } | { error: string } {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  if (!adapter || !endpointKey) return { error: 'adapter and endpointKey are required' };
  return { adapter, endpointKey };
}

export function normalizeParent(raw: unknown): { type: 'group' | 'guild'; id: string; name?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const parent = raw as { type?: unknown; id?: unknown; name?: unknown };
  const id = typeof parent.id === 'string' && parent.id.trim() ? parent.id.trim() : undefined;
  if (!id) return undefined;
  let type: 'group' | 'guild' | undefined;
  if (parent.type === 'group' || parent.type === 'guild') type = parent.type;
  else if (parent.type === 'channel') type = 'guild';
  if (!type) return undefined;
  const name = typeof parent.name === 'string' && parent.name.trim() ? parent.name.trim() : undefined;
  return name ? { type, id, name } : { type, id };
}

export function channelFromStoredRow(row: Record<string, unknown>): Record<string, unknown> {
  const parent = parentFromStoredRow(row);
  return {
    id: String(row.channel_id ?? ''),
    type: String(row.channel_type ?? ''),
    ...(row.channel_name != null ? { name: String(row.channel_name) } : {}),
    ...(parent ? { parent } : {}),
  };
}

function parentFromStoredRow(
  row: Record<string, unknown>,
): { type: 'group' | 'guild'; id: string; name?: string } | undefined {
  return normalizeParent({
    type: row.channel_parent_type,
    id: row.channel_parent_id,
  });
}
