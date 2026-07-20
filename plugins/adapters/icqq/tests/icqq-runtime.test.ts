import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { MessageGateway } from '@zhin.js/core/runtime';
import defineIcqqAdapter from '../adapters/icqq.js';
import {
  IcqqIpcEndpoint,
  type IcqqIpcTransport,
} from '../src/endpoint.js';
import {
  Actions,
  formatInboundTarget,
  formatOutboundBody,
  parseSendTarget,
  resolveIcqqConfig,
} from '../src/protocol.js';
import { getIcqqAgentDeps, setIcqqAgentDeps } from '../src/icqq-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveIcqqConfig({
  name: '10001',
  autoReconnect: false,
});

function createMockIpc(): IcqqIpcTransport & {
  sent: Array<{ action: string; params?: Record<string, unknown> }>;
  emitEvent: (event: string, data: unknown) => void;
} {
  const handlers: Array<(event: { id: string; event: string; data: unknown }) => void> = [];
  const sent: Array<{ action: string; params?: Record<string, unknown> }> = [];
  return {
    sent,
    emitEvent(event, data) {
      for (const handler of handlers) {
        handler({ id: '*', event, data });
      }
    },
    request: vi.fn(async (action: string, params?: Record<string, unknown>) => {
      sent.push({ action, params });
      if (action === Actions.LIST_FRIENDS) {
        return { id: '1', ok: true, data: [{ user_id: 2, nickname: 'bob' }] };
      }
      if (action === Actions.LIST_GROUPS) {
        return {
          id: '1',
          ok: true,
          data: [{ group_id: 100, group_name: 'g', member_count: 1, max_member_count: 200 }],
        };
      }
      if (action === Actions.SEND_GROUP_MSG || action === Actions.SEND_PRIVATE_MSG) {
        return { id: '1', ok: true, data: { message_id: 'sent-1' } };
      }
      return { id: '1', ok: true, data: {} };
    }),
    subscribe: vi.fn((_action, _params, handler) => {
      handlers.push(handler);
      return { unsubscribe: vi.fn(async () => undefined) };
    }),
    setOnRemoteDisconnect: vi.fn(),
    close: vi.fn(),
  };
}

afterEach(() => {
  setIcqqAgentDeps(null);
});

describe('icqq protocol helpers', () => {
  it('resolves numeric name config', () => {
    const resolved = resolveIcqqConfig({ name: '12345' });
    expect(resolved.name).toBe('12345');
    expect(resolved.autoReconnect).toBe(true);
    expect(resolved.context).toBe('icqq');
  });

  it('rejects non-numeric name', () => {
    expect(() => resolveIcqqConfig({ name: 'bot' })).toThrow(/numeric name/);
  });

  it('parses send targets', () => {
    expect(parseSendTarget('group:100')).toEqual({ kind: 'group', groupId: 100 });
    expect(parseSendTarget('private:2')).toEqual({ kind: 'private', userId: 2 });
    expect(parseSendTarget('temp:100:2')).toEqual({ kind: 'temp', groupId: 100, userId: 2 });
    expect(parseSendTarget('channel:g1:c1')).toEqual({
      kind: 'channel',
      guildId: 'g1',
      channelId: 'c1',
    });
  });

  it('formats inbound targets', () => {
    expect(formatInboundTarget({ channelType: 'group', channelId: '100' })).toBe('group:100');
    expect(formatInboundTarget({
      channelType: 'private',
      channelId: '2',
      channelParentGroupId: '100',
    })).toBe('temp:100:2');
  });

  it('formats outbound CQ-ish body', () => {
    expect(formatOutboundBody('hi')).toBe('hi');
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { qq: '2' } },
    ])).toBe('hi[at:2]');
  });

  it('treats a single segment object (non-array) as a one-element array', () => {
    expect(formatOutboundBody({ type: 'text', data: { text: 'hi' } })).toBe('hi');
    expect(formatOutboundBody({ type: 'image', data: { base64: 'YQ==' } }))
      .toBe('[image:base64://YQ==]');
    // 未知段类型不会退化为 '[object Object]'，而是按空文本段兜底
    expect(formatOutboundBody({ type: 'html', data: { html: '<b>x</b>' } }))
      .toBe('​');
    // legacy { text } 简写保持原行为
    expect(formatOutboundBody({ text: 'legacy' })).toBe('legacy');
  });
});

describe('icqq plugin runtime adapter', () => {
  it('admits IPC message events via MessageGateway when open', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway,
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm1',
      raw_message: 'hello',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:100',
      content: 'hello',
      sender: '2',
      id: 'm1',
    }));
    await endpoint.stop();
  });

  it('passes quote metadata to gateway when event carries a source', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway,
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-quote',
      raw_message: '收到',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      source: {
        message_id: 'quoted-1',
        user_id: 3,
        sender: { user_id: 3, nickname: 'alice' },
        message: [{ type: 'text', text: '原文内容' }],
        time: 1_699_999_000,
      },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      id: 'm-quote',
      metadata: expect.objectContaining({
        quote_id: 'quoted-1',
        quote_sender_id: '3',
        quote_sender_name: 'alice',
        quote_content: '原文内容',
      }),
    }));
    await endpoint.stop();
  });

  it('omits quote metadata when event has no quote source', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway,
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-plain',
      raw_message: 'plain',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(metadata?.quote_id).toBeUndefined();
    expect(metadata?.quote_sender_id).toBeUndefined();
    expect(metadata?.quote_content).toBeUndefined();
    await endpoint.stop();
  });

  it('marks metadata.mentioned when group message @s the bot uin', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway,
      config: baseConfig, // name = '10001'（本机 uin）
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-at',
      raw_message: '[CQ:at,qq=10001] 在吗',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:100',
      content: '[CQ:at,qq=10001] 在吗',
      metadata: expect.objectContaining({ mentioned: true }),
    }));
    await endpoint.stop();
  });

  it('does not mark metadata.mentioned when @ targets someone else', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway,
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-other',
      raw_message: '[CQ:at,qq=10002] 在吗',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(metadata?.mentioned).toBeUndefined();
    await endpoint.stop();
  });

  it('does not admit while closed', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.admit({
      id: '1',
      target: 'group:1',
      content: 'x',
      sender: '2',
      channelType: 'group',
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('send posts group message via IPC', async () => {
    const mock = createMockIpc();
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();
    const id = await endpoint.send({ target: 'group:100', payload: 'pong' });
    expect(id).toBe('sent-1');
    expect(mock.sent.some((s) => s.action === Actions.SEND_GROUP_MSG)).toBe(true);
    await endpoint.stop();
  });

  it('send posts temp message via IPC (temp:gid:uid)', async () => {
    const mock = createMockIpc();
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();
    await endpoint.send({ target: 'temp:100:2', payload: 'hi' });
    const call = mock.sent.find((s) => s.action === Actions.SEND_TEMP_MSG);
    expect(call).toBeDefined();
    expect(call?.params).toEqual({ group_id: 100, user_id: 2, message: 'hi' });
    await endpoint.stop();
  });

  it('send posts guild channel message via IPC (channel:guild:channel)', async () => {
    const mock = createMockIpc();
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    endpoint.open();
    await endpoint.send({ target: 'channel:g1:c1', payload: 'hi' });
    const call = mock.sent.find((s) => s.action === Actions.GUILD_SEND_MSG);
    expect(call).toBeDefined();
    expect(call?.params).toEqual({ guild_id: 'g1', channel_id: 'c1', message: 'hi' });
    await endpoint.stop();
  });

  it('send throws a clear error after stop', async () => {
    const mock = createMockIpc();
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    await endpoint.stop();
    await expect(endpoint.send({ target: 'group:100', payload: 'x' })).rejects.toThrow(/未连接/);
    await expect(endpoint.request(Actions.PING)).rejects.toThrow(/未连接/);
  });

  it('registers agent endpoint with friends/groups cache', async () => {
    const mock = createMockIpc();
    const endpoint = new IcqqIpcEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createIpc: async () => mock,
    });
    await endpoint.start();
    const registered = getIcqqAgentDeps().getEndpoint('10001');
    expect(registered.friends.size).toBe(1);
    expect(registered.groups.size).toBe(1);
    expect(registered.ipc).toBe(mock);
    await endpoint.stop();
  });

  it('defineAdapter exports frozen definition', () => {
    expect(defineIcqqAdapter.$feature).toBe('zhin.adapter/1');
    expect(defineIcqqAdapter.capabilities).toEqual(['inbound', 'outbound']);
  });
});
