import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { MessageGateway } from '@zhin.js/core/runtime';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import { IcqqEndpoint } from '../src/endpoint.js';
import { resolveIcqqConfig } from '../src/protocol.js';
import { setIcqqAgentDeps } from '../src/icqq-agent-deps.js';
import { createIcqqTestPorts } from './_icqq-mock.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveIcqqConfig({
  id: '10001',
  autoReconnect: false,
});

interface EndpointSetup {
  friends?: Map<number, unknown>;
  groups?: Map<number, unknown>;
  members?: Map<number, unknown>;
  systemMsg?: unknown[];
  onKick?: () => { ok: boolean; error?: string };
}

const gateway: MessageGateway = { receive: vi.fn(), send: vi.fn(async () => 'sent') };

async function startEndpoint(options: EndpointSetup = {}): Promise<IcqqEndpoint> {
  const endpoint = new IcqqEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
    gateway,
    config: baseConfig,
    ...createIcqqTestPorts(),
  });
  const friends = options.friends ?? new Map([[2, { user_id: 2, nickname: 'bob', remark: '小博', sex: 'unknown', age: 0 }]]);
  const groups = options.groups ?? new Map([[100, { group_id: 100, group_name: 'g', member_count: 1, max_member_count: 200 }]]);
  for (const [k, v] of friends) endpoint.fl.set(k, v as never);
  for (const [k, v] of groups) endpoint.gl.set(k, v as never);

  if (options.members) {
    vi.mocked(endpoint.getGroupMemberList).mockResolvedValue(options.members as never);
  }
  if (options.systemMsg) {
    vi.mocked(endpoint.getSystemMsg).mockResolvedValue(options.systemMsg as never);
  }
  if (options.onKick) {
    const onKick = options.onKick;
    vi.mocked(endpoint.setGroupKick).mockImplementation(async () => {
      const result = onKick();
      if (!result.ok) throw new Error(result.error ?? 'unknown');
      return true as never;
    });
  }

  await endpoint.start(new AbortController().signal);
  return endpoint;
}

afterEach(() => {
  setIcqqAgentDeps(null);
});

describe('icqq.endpoint management 接口', () => {
  it('management.listFriends 归一为 {user_id, nickname, remark}[]', async () => {
    const endpoint = await startEndpoint();
    const friends = await endpoint.management.listFriends!();
    expect(friends).toEqual([{ user_id: 2, nickname: 'bob', remark: '小博' }]);
    await endpoint.stop();
  });

  it('management.listFriends 缺 remark 时归一为空字符串', async () => {
    const endpoint = await startEndpoint({
      friends: new Map([[3, { user_id: 3, nickname: 'alice', sex: 'unknown', age: 0 }]]),
      groups: new Map(),
    });
    expect(await endpoint.management.listFriends!()).toEqual([{ user_id: 3, nickname: 'alice', remark: '' }]);
    await endpoint.stop();
  });

  it('management.listGroups 归一为 {group_id, name}[]', async () => {
    const endpoint = await startEndpoint();
    const groups = await endpoint.management.listGroups!();
    expect(groups).toEqual([{ group_id: 100, name: 'g' }]);
    await endpoint.stop();
  });

  it('management.listChannels 走 QQ 频道 catalog', async () => {
    const endpoint = await startEndpoint({ friends: new Map(), groups: new Map() });
    vi.mocked(endpoint.getGuildList).mockReturnValue([{ guild_id: 'g1', guild_name: 'Guild' }] as never);
    vi.mocked(endpoint.getChannelList).mockReturnValue([{ channel_id: 'c1', channel_name: 'chat' }] as never);
    await expect(endpoint.management.listChannels!()).resolves.toEqual([{
      id: 'c1',
      name: 'chat',
      parent: { type: 'guild', id: 'g1', name: 'Guild' },
    }]);
    await endpoint.stop();
  });

  it('adds inbound QQ guild channels to the management catalog', async () => {
    const endpoint = await startEndpoint({ friends: new Map(), groups: new Map() });
    (endpoint as any).emit('message.guild.normal', {
      type: 'guild',
      guild_id: 'g-live',
      guild_name: 'Live Guild',
      channel_id: 'c-live',
      channel_name: 'live-chat',
      nickname: 'Alice',
      tiny_id: '42',
      raw_message: 'hello',
      time: 1_700_000_000,
      seq: 7,
    });
    await expect(endpoint.management.listChannels!()).resolves.toEqual([{
      id: 'c-live',
      name: 'live-chat',
      parent: { type: 'guild', id: 'g-live', name: 'Live Guild' },
    }]);
    await endpoint.stop();
  });

  it('management.listGroupMembers 透传 group_id', async () => {
    const member = { user_id: 7, nickname: 'n7', card: 'c7', role: 'member', title: '' };
    const endpoint = await startEndpoint({
      friends: new Map(), groups: new Map(),
      members: new Map([[7, member]]),
    });
    expect(await endpoint.management.listGroupMembers!('100')).toEqual([member]);
    expect(endpoint.getGroupMemberList).toHaveBeenCalledWith(100);
    await endpoint.stop();
  });

  it('management.approveRequest 命中好友请求 → setFriendAddRequest', async () => {
    const endpoint = await startEndpoint({
      friends: new Map(), groups: new Map(),
      systemMsg: [
        { post_type: 'request', request_type: 'friend', user_id: 42, nickname: 'x', flag: 'flag-f1', seq: 1, time: 0 },
        { post_type: 'request', request_type: 'group', sub_type: 'add', user_id: 43, group_id: 100, flag: 'flag-g1', seq: 2, time: 0 },
      ],
    });
    await endpoint.management.approveRequest!('flag-f1', '备注A');
    expect(endpoint.setFriendAddRequest).toHaveBeenCalledWith('flag-f1', true, '备注A');
    expect(endpoint.setGroupAddRequest).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('management.approveRequest 命中群请求 → setGroupAddRequest', async () => {
    const endpoint = await startEndpoint({
      friends: new Map(), groups: new Map(),
      systemMsg: [
        { post_type: 'request', request_type: 'group', sub_type: 'add', user_id: 43, group_id: 100, flag: 'flag-g1', seq: 2, time: 0 },
      ],
    });
    await endpoint.management.approveRequest!('flag-g1');
    expect(endpoint.setGroupAddRequest).toHaveBeenCalledWith('flag-g1', true);
    expect(endpoint.setFriendAddRequest).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('management.rejectRequest 命中群请求 → setGroupAddRequest（approve=false，reason 透传）', async () => {
    const endpoint = await startEndpoint({
      friends: new Map(), groups: new Map(),
      systemMsg: [
        { post_type: 'request', request_type: 'group', sub_type: 'add', user_id: 43, group_id: 100, flag: 'flag-g1', seq: 2, time: 0 },
      ],
    });
    await endpoint.management.rejectRequest!('flag-g1', '不欢迎');
    expect(endpoint.setGroupAddRequest).toHaveBeenCalledWith('flag-g1', false, '不欢迎');
    await endpoint.stop();
  });

  it('management.rejectRequest 命中好友请求 → setFriendAddRequest（approve=false）', async () => {
    const endpoint = await startEndpoint({
      friends: new Map(), groups: new Map(),
      systemMsg: [
        { post_type: 'request', request_type: 'friend', user_id: 42, nickname: 'x', flag: 'flag-f1', seq: 1, time: 0 },
      ],
    });
    await endpoint.management.rejectRequest!('flag-f1');
    expect(endpoint.setFriendAddRequest).toHaveBeenCalledWith('flag-f1', false);
    await endpoint.stop();
  });

  it('management.approveRequest 找不到请求时抛出带上下文的错误', async () => {
    const endpoint = await startEndpoint({
      friends: new Map(), groups: new Map(),
      systemMsg: [],
    });
    await expect(endpoint.management.approveRequest!('flag-x')).rejects.toThrow(/未找到待处理请求: flag-x/);
    expect(endpoint.setFriendAddRequest).not.toHaveBeenCalled();
    expect(endpoint.setGroupAddRequest).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('management.kickGroupMember → setGroupKick（字符串收敛为数字）', async () => {
    const endpoint = await startEndpoint();
    await endpoint.management.kickGroupMember!('100', '7');
    expect(endpoint.setGroupKick).toHaveBeenCalledWith(100, 7);
    await endpoint.stop();
  });

  it('management.muteGroupMember → setGroupBan', async () => {
    const endpoint = await startEndpoint();
    await endpoint.management.muteGroupMember!('100', '7', 120);
    expect(endpoint.setGroupBan).toHaveBeenCalledWith(100, 7, 120);
    await endpoint.stop();
  });

  it('management.setGroupAdmin → setGroupAdmin', async () => {
    const endpoint = await startEndpoint();
    await endpoint.management.setGroupAdmin!('100', '7', true);
    expect(endpoint.setGroupAdmin).toHaveBeenCalledWith(100, 7, true);
    await endpoint.stop();
  });

  it('management.deleteFriend → deleteFriend', async () => {
    const endpoint = await startEndpoint();
    await endpoint.management.deleteFriend!('7');
    expect(endpoint.deleteFriend).toHaveBeenCalledWith(7);
    await endpoint.stop();
  });

  it('Client 抛出错误时向上传播', async () => {
    const endpoint = await startEndpoint({
      onKick: () => ({ ok: false, error: 'permission denied' }),
    });
    await expect(endpoint.management.kickGroupMember!('100', '7')).rejects.toThrow(/permission denied/);
    await endpoint.stop();
  });

  it('fl/gl Map 直接访问 Client 缓存', async () => {
    const endpoint = await startEndpoint();
    expect((endpoint.fl.get(2) as any)?.nickname).toBe('bob');
    expect((endpoint.gl.get(100) as any)?.group_name).toBe('g');
    await endpoint.stop();
  });
});
