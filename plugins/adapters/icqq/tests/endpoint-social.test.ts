import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { MessageGateway } from '@zhin.js/core/runtime';
import {
  IcqqIpcEndpoint,
  type IcqqIpcTransport,
} from '../src/endpoint.js';
import { Actions, resolveIcqqConfig } from '../src/protocol.js';
import { setIcqqAgentDeps } from '../src/icqq-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveIcqqConfig({
  name: '10001',
  autoReconnect: false,
});

interface MockHandlers {
  onRequest?: (action: string, params?: Record<string, unknown>) =>
    { id: string; ok: boolean; data?: unknown; error?: string };
}

function createMockIpc(handlers: MockHandlers = {}): IcqqIpcTransport & {
  sent: Array<{ action: string; params?: Record<string, unknown> }>;
} {
  const sent: Array<{ action: string; params?: Record<string, unknown> }> = [];
  return {
    sent,
    request: vi.fn(async (action: string, params?: Record<string, unknown>) => {
      sent.push({ action, params });
      if (handlers.onRequest) return handlers.onRequest(action, params);
      if (action === Actions.LIST_FRIENDS) {
        return { id: '1', ok: true, data: [{ user_id: 2, nickname: 'bob', remark: '小博' }] };
      }
      if (action === Actions.LIST_GROUPS) {
        return {
          id: '1',
          ok: true,
          data: [{ group_id: 100, group_name: 'g', member_count: 1, max_member_count: 200 }],
        };
      }
      return { id: '1', ok: true, data: {} };
    }),
    subscribe: vi.fn((_action, _params, _handler) => ({
      unsubscribe: vi.fn(async () => undefined),
    })),
    setOnRemoteDisconnect: vi.fn(),
    close: vi.fn(),
  };
}

const gateway: MessageGateway = { receive: vi.fn(), send: vi.fn(async () => 'sent') };

async function startEndpoint(mock: IcqqIpcTransport): Promise<IcqqIpcEndpoint> {
  const endpoint = new IcqqIpcEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
    gateway,
    config: baseConfig,
    createIpc: async () => mock,
  });
  await endpoint.start();
  return endpoint;
}

afterEach(() => {
  setIcqqAgentDeps(null);
});

describe('icqq endpoint 社交/群管（console RPC 面）', () => {
  it('getFriendList 归一为 {user_id, nickname, remark}[]', async () => {
    const mock = createMockIpc();
    const endpoint = await startEndpoint(mock);
    const friends = await endpoint.getFriendList();
    expect(friends).toEqual([{ user_id: 2, nickname: 'bob', remark: '小博' }]);
    expect(mock.sent.some((s) => s.action === Actions.LIST_FRIENDS)).toBe(true);
    await endpoint.stop();
  });

  it('getFriendList 缺 remark 时归一为空字符串', async () => {
    const mock = createMockIpc({
      onRequest(action) {
        if (action === Actions.LIST_FRIENDS) {
          return { id: '1', ok: true, data: [{ user_id: 3, nickname: 'alice' }] };
        }
        if (action === Actions.LIST_GROUPS) return { id: '1', ok: true, data: [] };
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    expect(await endpoint.getFriendList()).toEqual([{ user_id: 3, nickname: 'alice', remark: '' }]);
    await endpoint.stop();
  });

  it('getGroupList 归一为 {group_id, name}[]', async () => {
    const mock = createMockIpc();
    const endpoint = await startEndpoint(mock);
    const groups = await endpoint.getGroupList();
    expect(groups).toEqual([{ group_id: 100, name: 'g' }]);
    await endpoint.stop();
  });

  it('getGroupMemberList 走 LIST_GROUP_MEMBERS 并透传 group_id；listMembers/getMemberList 为别名', async () => {
    const member = {
      user_id: 7, nickname: 'n7', card: 'c7', role: 'member', title: '',
    };
    const mock = createMockIpc({
      onRequest(action, params) {
        if (action === Actions.LIST_FRIENDS) return { id: '1', ok: true, data: [] };
        if (action === Actions.LIST_GROUPS) return { id: '1', ok: true, data: [] };
        if (action === Actions.LIST_GROUP_MEMBERS) {
          expect(params).toEqual({ group_id: 100 });
          return { id: '1', ok: true, data: [member] };
        }
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    expect(await endpoint.getGroupMemberList('100')).toEqual([member]);
    expect(await endpoint.listMembers(100)).toEqual([member]);
    expect(await endpoint.getMemberList(100)).toEqual([member]);
    const calls = mock.sent.filter((s) => s.action === Actions.LIST_GROUP_MEMBERS);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => (c.params as { group_id: number }).group_id === 100)).toBe(true);
    await endpoint.stop();
  });

  it('approveRequest 命中好友请求 → handle_friend_request（approve=true，remark 透传）', async () => {
    const mock = createMockIpc({
      onRequest(action) {
        if (action === Actions.LIST_FRIENDS || action === Actions.LIST_GROUPS) {
          return { id: '1', ok: true, data: [] };
        }
        if (action === Actions.GET_SYSTEM_MSG) {
          return {
            id: '1',
            ok: true,
            data: {
              friendRequests: [{ type: 'friend', user_id: 42, flag: 'flag-f1', seq: 1 }],
              groupRequests: [{ type: 'group', user_id: 43, group_id: 100, flag: 'flag-g1' }],
            },
          };
        }
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    await endpoint.approveRequest('flag-f1', '备注A');
    const call = mock.sent.find((s) => s.action === Actions.HANDLE_FRIEND_REQUEST);
    expect(call?.params).toEqual({ flag: 'flag-f1', approve: true, remark: '备注A' });
    expect(mock.sent.some((s) => s.action === Actions.HANDLE_GROUP_REQUEST)).toBe(false);
    await endpoint.stop();
  });

  it('approveRequest 命中群请求 → handle_group_request（approve=true）', async () => {
    const mock = createMockIpc({
      onRequest(action) {
        if (action === Actions.LIST_FRIENDS || action === Actions.LIST_GROUPS) {
          return { id: '1', ok: true, data: [] };
        }
        if (action === Actions.GET_SYSTEM_MSG) {
          return {
            id: '1',
            ok: true,
            data: {
              friendRequests: [],
              groupRequests: [{ type: 'group', user_id: 43, group_id: 100, flag: 'flag-g1' }],
            },
          };
        }
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    await endpoint.approveRequest('flag-g1');
    const call = mock.sent.find((s) => s.action === Actions.HANDLE_GROUP_REQUEST);
    expect(call?.params).toEqual({ flag: 'flag-g1', approve: true });
    expect(mock.sent.some((s) => s.action === Actions.HANDLE_FRIEND_REQUEST)).toBe(false);
    await endpoint.stop();
  });

  it('rejectRequest 命中群请求 → handle_group_request（approve=false，reason 透传）', async () => {
    const mock = createMockIpc({
      onRequest(action) {
        if (action === Actions.LIST_FRIENDS || action === Actions.LIST_GROUPS) {
          return { id: '1', ok: true, data: [] };
        }
        if (action === Actions.GET_SYSTEM_MSG) {
          return {
            id: '1',
            ok: true,
            data: {
              friendRequests: [],
              groupRequests: [{ type: 'group', user_id: 43, group_id: 100, flag: 'flag-g1' }],
            },
          };
        }
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    await endpoint.rejectRequest('flag-g1', '不欢迎');
    const call = mock.sent.find((s) => s.action === Actions.HANDLE_GROUP_REQUEST);
    expect(call?.params).toEqual({ flag: 'flag-g1', approve: false, reason: '不欢迎' });
    await endpoint.stop();
  });

  it('rejectRequest 命中好友请求 → handle_friend_request（approve=false）', async () => {
    const mock = createMockIpc({
      onRequest(action) {
        if (action === Actions.LIST_FRIENDS || action === Actions.LIST_GROUPS) {
          return { id: '1', ok: true, data: [] };
        }
        if (action === Actions.GET_SYSTEM_MSG) {
          return {
            id: '1',
            ok: true,
            data: {
              friendRequests: [{ type: 'friend', user_id: 42, flag: 'flag-f1' }],
              groupRequests: [],
            },
          };
        }
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    await endpoint.rejectRequest('flag-f1');
    const call = mock.sent.find((s) => s.action === Actions.HANDLE_FRIEND_REQUEST);
    expect(call?.params).toEqual({ flag: 'flag-f1', approve: false });
    await endpoint.stop();
  });

  it('approveRequest 找不到请求时抛出带上下文的错误', async () => {
    const mock = createMockIpc({
      onRequest(action) {
        if (action === Actions.LIST_FRIENDS || action === Actions.LIST_GROUPS) {
          return { id: '1', ok: true, data: [] };
        }
        if (action === Actions.GET_SYSTEM_MSG) {
          return { id: '1', ok: true, data: { friendRequests: [], groupRequests: [] } };
        }
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    await expect(endpoint.approveRequest('flag-x')).rejects.toThrow(/未找到待处理请求: flag-x/);
    expect(mock.sent.some((s) => s.action === Actions.HANDLE_FRIEND_REQUEST)).toBe(false);
    expect(mock.sent.some((s) => s.action === Actions.HANDLE_GROUP_REQUEST)).toBe(false);
    await endpoint.stop();
  });

  it('removeMember/kickMember/setGroupKick → group_kick（gid/uid，字符串收敛为数字）', async () => {
    const mock = createMockIpc();
    const endpoint = await startEndpoint(mock);
    await endpoint.removeMember('100', '7');
    await endpoint.kickMember(100, 7);
    await endpoint.setGroupKick(100, 7);
    const calls = mock.sent.filter((s) => s.action === Actions.GROUP_KICK);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.params).toEqual({ group_id: 100, user_id: 7 });
    }
    await endpoint.stop();
  });

  it('muteMember/banMember/setGroupMute → group_mute（默认 duration=600，可覆盖）', async () => {
    const mock = createMockIpc();
    const endpoint = await startEndpoint(mock);
    await endpoint.muteMember('100', '7');
    await endpoint.banMember(100, 7, 120);
    await endpoint.setGroupMute(100, 7, 0);
    const calls = mock.sent.filter((s) => s.action === Actions.GROUP_MUTE);
    expect(calls.map((c) => c.params)).toEqual([
      { group_id: 100, user_id: 7, duration: 600 },
      { group_id: 100, user_id: 7, duration: 120 },
      { group_id: 100, user_id: 7, duration: 0 },
    ]);
    await endpoint.stop();
  });

  it('setModerator/setAdmin/setGroupAdmin → set_group_admin（默认 enable=true，可传 false）', async () => {
    const mock = createMockIpc();
    const endpoint = await startEndpoint(mock);
    await endpoint.setModerator('100', '7');
    await endpoint.setAdmin(100, 7, false);
    await endpoint.setGroupAdmin(100, 7, true);
    const calls = mock.sent.filter((s) => s.action === Actions.SET_GROUP_ADMIN);
    expect(calls.map((c) => c.params)).toEqual([
      { group_id: 100, user_id: 7, enable: true },
      { group_id: 100, user_id: 7, enable: false },
      { group_id: 100, user_id: 7, enable: true },
    ]);
    await endpoint.stop();
  });

  it('deleteFriend/delete_friend → friend_delete', async () => {
    const mock = createMockIpc();
    const endpoint = await startEndpoint(mock);
    await endpoint.deleteFriend('7');
    await endpoint.delete_friend(8);
    const calls = mock.sent.filter((s) => s.action === Actions.FRIEND_DELETE);
    expect(calls.map((c) => c.params)).toEqual([{ user_id: 7 }, { user_id: 8 }]);
    await endpoint.stop();
  });

  it('daemon 返回 ok=false 时向上抛带操作上下文的错误', async () => {
    const mock = createMockIpc({
      onRequest(action) {
        if (action === Actions.LIST_FRIENDS || action === Actions.LIST_GROUPS) {
          return { id: '1', ok: true, data: [] };
        }
        if (action === Actions.GROUP_KICK) {
          return { id: '1', ok: false, error: 'permission denied' };
        }
        return { id: '1', ok: true, data: {} };
      },
    });
    const endpoint = await startEndpoint(mock);
    await expect(endpoint.removeMember(100, 7)).rejects.toThrow(/踢出群成员失败: permission denied/);
    await endpoint.stop();
  });

  it('friends/groups Map 供 console 直接读取（#refreshLists 填充）', async () => {
    const mock = createMockIpc();
    const endpoint = await startEndpoint(mock);
    expect(endpoint.friends.get(2)?.nickname).toBe('bob');
    expect(endpoint.groups.get(100)?.group_name).toBe('g');
    await endpoint.stop();
  });
});
