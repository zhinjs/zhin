import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import defineQqAdapter from '../adapters/qq.js';
import {
  QqWebsocketEndpoint,
  QqHttpEndpoint,
  type CreateQqBot,
  type QqBotTransport,
} from '../src/endpoint.js';
import {
  formatInboundContent,
  formatInboundTarget,
  formatOutboundText,
  parseSendTarget,
  resolveOutboundMessageId,
  resolveQqConfig,
  type QqInboundMessage,
} from '../src/protocol.js';
import { getQqAgentDeps, setQqAgentDeps } from '../src/qq-agent-deps.js';
import { createQqRuntimeState, qqRuntimeStateToken } from '../src/qq-runtime-state.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveQqConfig({
  name: 'test-qq-bot',
  appid: 'app-1',
  secret: 'secret-1',
  mode: 'websocket',
}) as ReturnType<typeof resolveQqConfig> & { mode: 'websocket' };

function textMessage(overrides: Partial<QqInboundMessage> = {}): QqInboundMessage {
  return {
    id: 'msg-1',
    content: 'hello',
    channelKind: 'group',
    channelId: 'group-1',
    authorId: 'user-1',
    authorName: 'alice',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function createMockBot(): QqBotTransport & {
  sent: Array<{ kind: string; id: string; message: string }>;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: Array<{ kind: string; id: string; message: string }> = [];

  return {
    sent,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    removeAllListeners: vi.fn(() => {
      listeners.clear();
    }),
    sendPrivateMessage: vi.fn(async (id: string, message: string) => {
      sent.push({ kind: 'private', id, message });
      return { id: `sent-${sent.length}` };
    }),
    sendGroupMessage: vi.fn(async (id: string, message: string) => {
      sent.push({ kind: 'group', id, message });
      return { id: `sent-${sent.length}` };
    }),
    sendGuildMessage: vi.fn(async (id: string, message: string) => {
      sent.push({ kind: 'channel', id, message });
      return { id: `sent-${sent.length}` };
    }),
    sendDirectMessage: vi.fn(async (id: string, message: string) => {
      sent.push({ kind: 'direct', id, message });
      return { id: `sent-${sent.length}` };
    }),
    getGuilds: vi.fn(async () => [{ id: 'guild-1', name: 'Guild' }]),
    getChannels: vi.fn(async () => [{ id: 'chan-1', name: 'general' }]),
    getChannelInfo: vi.fn(async (id: string) => ({ id, name: 'general' })),
    getGuildMember: vi.fn(async () => ({ user: { id: 'user-1' } })),
    getGuildRoles: vi.fn(async () => [{ id: 'role-1', name: 'Admin' }]),
    createGuildRole: vi.fn(async (_g: string, name: string) => ({ id: 'role-new', name })),
    addMemberRole: vi.fn(async () => true),
    removeMemberRole: vi.fn(async () => true),
  };
}

afterEach(() => {
  setQqAgentDeps(null);
});

describe('qq protocol helpers', () => {
  it('resolves plugin config with websocket default', () => {
    const resolved = resolveQqConfig({ appid: 'a', secret: 's' });
    expect(resolved.mode).toBe('websocket');
    expect(resolved.name).toBe('qq-bot');
  });

  it('selects deferred modes when configured', () => {
    expect(resolveQqConfig({ appid: 'a', secret: 's', mode: 'webhook' }).mode).toBe('webhook');
    expect(resolveQqConfig({ appid: 'a', secret: 's', mode: 'middleware' }).mode).toBe('middleware');
  });

  it('formats inbound target and content', () => {
    expect(formatInboundTarget(textMessage())).toBe('group:group-1');
    expect(formatInboundContent(textMessage())).toBe('hello');
    expect(parseSendTarget('channel:chan-1')).toEqual({ kind: 'channel', id: 'chan-1' });
  });

  it('formats outbound text and resolves send result ids', () => {
    expect(formatOutboundText('pong')).toBe('pong');
    expect(formatOutboundText([{ type: 'text', data: { text: 'hi' } }])).toBe('hi');
    expect(resolveOutboundMessageId({ id: 'msg-1' })).toBe('msg-1');
    expect(resolveOutboundMessageId({
      data: { message_audit: { audit_id: 'audit-1' } },
    })).toBe('audit-1');
    expect(() => resolveOutboundMessageId({ code: 40001, message: 'bad' }))
      .toThrow('QQ 发送消息失败（40001）: bad');
  });
});

describe('qq plugin runtime adapter', () => {
  it('routes admitted messages through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockBot();
    const createBot: CreateQqBot = () => mock;
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway,
      config: baseConfig,
      createBot,
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit(textMessage());

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:group-1',
      content: 'hello',
      sender: 'alice',
      id: 'msg-1',
    }));

    await endpoint.stop();
    expect(mock.start).toHaveBeenCalled();
    expect(mock.stop).toHaveBeenCalled();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const mock = createMockBot();
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    endpoint.admit(textMessage());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via QQ APIs', async () => {
    const mock = createMockBot();
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    const messageId = await endpoint.send({ target: 'group:group-1', payload: 'pong' });
    expect(messageId).toBe('group-group-1:sent-1');
    expect(mock.sent[0]).toEqual({ kind: 'group', id: 'group-1', message: 'pong' });
    await endpoint.stop();
  });

  it('registers agent endpoint for tools', async () => {
    const mock = createMockBot();
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    const guilds = await getQqAgentDeps().getEndpoint('test-qq-bot').getGuilds();
    expect(guilds).toHaveLength(1);
    await endpoint.stop();
  });

  it('normalizes guild channels through endpoint management', async () => {
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => createMockBot(),
    });
    await endpoint.start();
    await expect(endpoint.management.listChannels?.()).resolves.toEqual([
      {
        id: 'chan-1',
        name: 'general',
        parent: { type: 'guild', id: 'guild-1', name: 'Guild' },
      },
    ]);
    await endpoint.stop();
  });

  it('creates http endpoint when httpHostToken provided', () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = defineQqAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      name: 'qq',
      config: { appid: 'a', secret: 's', mode: 'middleware' },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === qqRuntimeStateToken) return createQqRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(QqHttpEndpoint);
  });

  it('routes admitted messages through http endpoint when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockBot();
    const endpoint = new QqHttpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway,
      http: createHttpHost({ host: '127.0.0.1', port: 0 }),
      config: {
        context: 'qq',
        mode: 'middleware',
        name: 'test-qq-bot',
        appid: 'app-1',
        secret: 'secret-1',
        webhookPath: '/qq/webhook',
        sandbox: false,
      },
      createBot: () => ({
        ...mock,
        middleware: vi.fn(async () => undefined),
      }),
    });
    await endpoint.start();
    endpoint.open();
    endpoint.admit(textMessage());
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    await endpoint.stop();
  });
});
