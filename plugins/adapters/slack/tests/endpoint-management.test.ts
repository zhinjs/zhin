import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import { SlackEndpoint, type SlackSocketLike, type SlackWebClientLike } from '../src/endpoint.js';
import { resolveSlackConfig } from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const socketConfig = resolveSlackConfig({
  id: 'test-slack-mgmt',
  token: 'xoxb-test-token',
  appToken: 'xapp-test-token',
  socketMode: true,
});

function mockSocket(): SlackSocketLike {
  return {
    on: () => {},
    start: async () => {},
    disconnect: async () => {},
  };
}

function mockClient(overrides: {
  conversationsList?: SlackWebClientLike['conversations']['list'];
  usersList?: SlackWebClientLike['users']['list'];
  conversationsMembers?: SlackWebClientLike['conversations']['members'];
} = {}): SlackWebClientLike {
  return {
    auth: { test: vi.fn(async () => ({ user_id: 'U_BOT' })) },
    chat: {
      postMessage: vi.fn(async () => ({ ts: '1.0' })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    conversations: {
      invite: vi.fn(async () => ({})),
      kick: vi.fn(async () => ({})),
      setTopic: vi.fn(async () => ({})),
      setPurpose: vi.fn(async () => ({})),
      archive: vi.fn(async () => ({})),
      unarchive: vi.fn(async () => ({})),
      rename: vi.fn(async () => ({})),
      members: overrides.conversationsMembers ?? vi.fn(async () => ({ members: [] })),
      info: vi.fn(async () => ({ channel: {} })),
      list: overrides.conversationsList
        ?? vi.fn(async () => ({ channels: [], response_metadata: { next_cursor: '' } })),
    },
    users: {
      info: vi.fn(async () => ({ user: {} })),
      list: overrides.usersList
        ?? vi.fn(async () => ({ members: [], response_metadata: { next_cursor: '' } })),
    },
    reactions: { add: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
    pins: { add: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
  };
}

function gateway(): OutboundMessageService {
  return { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
}

async function startedEndpoint(client: SlackWebClientLike): Promise<SlackEndpoint> {
  const endpoint = bindTestEndpoint(new SlackEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
    gateway: gateway(),
    config: socketConfig,
    createClient: () => client,
    createSocket: () => mockSocket(),
  }), gateway(), undefined);
  await endpoint.start();
  return endpoint;
}

describe('slack.endpoint management', () => {
  it('只暴露已实现的能力（listFriends/listGroups/listGroupMembers）', async () => {
    const endpoint = await startedEndpoint(mockClient());
    expect(listEndpointManagementCapabilities(endpoint)).toEqual([
      'listFriends',
      'listGroups',
      'listGroupMembers',
    ]);
    expect(endpoint.management.listChannels).toBeUndefined();
    expect(endpoint.management.kickGroupMember).toBeUndefined();
    await endpoint.stop();
  });

  it('listGroups：conversations.list 归一 public channel，cursor 翻页', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({
        channels: [{ id: 'C1', name: 'general' }, { no_id: true }],
        response_metadata: { next_cursor: 'page-2' },
      })
      .mockResolvedValueOnce({
        channels: [{ id: 'C2', name: 'random' }],
        response_metadata: { next_cursor: '' },
      });
    const endpoint = await startedEndpoint(mockClient({ conversationsList: list }));

    const groups = await endpoint.management.listGroups!();

    expect(groups).toEqual([
      { group_id: 'C1', name: 'general' },
      { group_id: 'C2', name: 'random' },
    ]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0]?.[0]).toMatchObject({ types: 'public_channel', exclude_archived: true });
    expect(list.mock.calls[1]?.[0]).toMatchObject({ cursor: 'page-2' });
    await endpoint.stop();
  });

  it('listFriends：users.list 归一 nickname=real_name||name，过滤 deleted，remark 为空', async () => {
    const usersList = vi.fn(async () => ({
      members: [
        { id: 'U1', name: 'alice', profile: { real_name: 'Alice A' } },
        { id: 'U2', name: 'bob' },
        { id: 'U3', name: 'ghost', deleted: true },
      ],
      response_metadata: { next_cursor: '' },
    }));
    const endpoint = await startedEndpoint(mockClient({ usersList }));

    const friends = await endpoint.management.listFriends!();

    expect(friends).toEqual([
      { user_id: 'U1', nickname: 'Alice A', remark: '' },
      { user_id: 'U2', nickname: 'bob', remark: '' },
    ]);
    await endpoint.stop();
  });

  it('listGroupMembers：conversations.members 返回平台 user id 列表', async () => {
    const members = vi.fn(async () => ({ members: ['U1', 'U2'] }));
    const endpoint = await startedEndpoint(mockClient({ conversationsMembers: members }));

    const result = await endpoint.management.listGroupMembers!('C1');

    expect(result).toEqual(['U1', 'U2']);
    expect(members).toHaveBeenCalledWith({ channel: 'C1' });
    await endpoint.stop();
  });

  it('未连接时抛错而不是静默返回空', async () => {
    const endpoint = bindTestEndpoint(new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway: gateway(),
      config: socketConfig,
      createClient: () => mockClient(),
      createSocket: () => mockSocket(),
    }), gateway(), undefined);
    await expect(endpoint.management.listGroups!()).rejects.toThrow(/not connected/);
  });
});
