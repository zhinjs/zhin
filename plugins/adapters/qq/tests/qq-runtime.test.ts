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
  formatOutboundText,
  resolveOutboundMessageId,
  resolveQqConfig,
  type QqInboundMessage,
} from '../src/protocol.js';
import { formatOutbound, type QqOutboundMessage } from '../src/outbound.js';
import { getQqAgentDeps, setQqAgentDeps } from '../src/qq-agent-deps.js';
import { createQqRuntimeState, qqRuntimeStateToken } from '../src/qq-runtime-state.js';
import { stopQqOfficialBot } from '../src/ws.js';

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
  sent: Array<{ kind: string; id: string; message: QqOutboundMessage }>;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: Array<{ kind: string; id: string; message: QqOutboundMessage }> = [];

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
    sendPrivateMessage: vi.fn(async (id: string, message: QqOutboundMessage) => {
      sent.push({ kind: 'private', id, message });
      return { id: `sent-${sent.length}` };
    }),
    sendGroupMessage: vi.fn(async (id: string, message: QqOutboundMessage) => {
      sent.push({ kind: 'group', id, message });
      return { id: `sent-${sent.length}` };
    }),
    sendGuildMessage: vi.fn(async (id: string, message: QqOutboundMessage) => {
      sent.push({ kind: 'channel', id, message });
      return { id: `sent-${sent.length}` };
    }),
    sendDirectMessage: vi.fn(async (id: string, message: QqOutboundMessage) => {
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
  it('destroys SDK managers before stopping to suppress reconnect', async () => {
    const calls: string[] = [];
    const sessionManager = {
      userClose: false,
      connectionManager: {
        destroy: vi.fn(() => calls.push('connection.destroy')),
      },
      authManager: {
        destroy: vi.fn(() => calls.push('auth.destroy')),
      },
    };
    const bot = {
      sessionManager,
      stop: vi.fn(async () => {
        calls.push('bot.stop');
      }),
    };

    await stopQqOfficialBot(bot);

    expect(sessionManager.userClose).toBe(true);
    expect(calls).toEqual(['connection.destroy', 'bot.stop', 'auth.destroy']);
  });

  it('resolves plugin config with websocket default', () => {
    const resolved = resolveQqConfig({ appid: 'a', secret: 's' });
    expect(resolved.mode).toBe('websocket');
    expect(resolved.name).toBe('qq-bot');
  });

  it('selects deferred modes when configured', () => {
    expect(resolveQqConfig({ appid: 'a', secret: 's', mode: 'webhook' }).mode).toBe('webhook');
    expect(resolveQqConfig({ appid: 'a', secret: 's', mode: 'middleware' }).mode).toBe('middleware');
  });

  it('formats inbound content', () => {
    expect(formatInboundContent(textMessage())).toBe('hello');
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
      conversation: expect.objectContaining({ kind: 'group', id: 'group-1' }),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: 'hello',
      sender: 'alice',
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
    const messageId = await endpoint.send({ conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'group-1',
      }, payload: 'pong' });
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

  it('removes the endpoint from runtime state on stop', async () => {
    const state = createQqRuntimeState();
    const endpoint = defineQqAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      name: 'qq',
      config: { appid: 'a', secret: 's', mode: 'websocket', name: 'ep-stop' },
      use: (token: unknown) => {
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === qqRuntimeStateToken) return state;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(state.endpoints.has('ep-stop')).toBe(true);
    await endpoint.stop?.();
    expect(state.endpoints.has('ep-stop')).toBe(false);
  });

  it('keeps URL images in the text view and drops source-less images with a warn', () => {
    expect(formatOutboundText([{ type: 'image', data: { url: 'https://example.com/a.png' } }]))
      .toBe('https://example.com/a.png');
    expect(formatOutboundText([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { file: 'base64-blob' } },
    ])).toBe('hi');
    expect(formatOutboundText([{ type: 'image', data: {} }])).toBe('');
  });

  it('sends http(s) image segments directly as URL media', async () => {
    const mock = createMockBot();
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'group-1',
      },
      payload: [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } }],
    });
    expect(mock.sent[0]).toEqual({
      kind: 'group',
      id: 'group-1',
      message: { type: 'image', data: { url: 'https://example.com/a.png' } },
    });
    await endpoint.stop();
  });

  it('uploads base64 / local image segments via the media file field', async () => {
    const mock = createMockBot();
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'private',
        id: 'user-1',
      },
      payload: [
        { type: 'text', data: { text: '看图' } },
        { type: 'image', data: { media: { kind: 'base64', value: 'aGk=', mime_type: 'image/png' } } },
      ],
    });
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'private',
        id: 'user-1',
      },
      payload: [{ type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png' } } }],
    });
    expect(mock.sent[0]?.message).toEqual([
      '看图',
      { type: 'image', data: { file: 'base64://aGk=' } },
    ]);
    expect(mock.sent[1]?.message).toEqual({
      type: 'image',
      data: { file: '/tmp/a.png' },
    });
    await endpoint.stop();
  });

  it('sends markdown segments as msg_type=2 payloads', async () => {
    const mock = createMockBot();
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'group-1',
      },
      payload: [{ type: 'markdown', data: { content: '**粗体**' } }],
    });
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'group-1',
      },
      payload: [{
        type: 'markdown',
        data: { custom_template_id: 'tpl-1', params: [{ key: 'k', values: 'v' }] },
      }],
    });
    expect(mock.sent[0]?.message).toEqual({
      type: 'markdown',
      data: { content: '**粗体**' },
    });
    expect(mock.sent[1]?.message).toEqual({
      type: 'markdown',
      data: { custom_template_id: 'tpl-1', params: [{ key: 'k', values: 'v' }] },
    });
    await endpoint.stop();
  });

  it('expands keyboard rows into button segments with preceding text as markdown', async () => {
    const mock = createMockBot();
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'group-1',
      },
      payload: [
        { type: 'text', data: { text: '请操作' } },
        {
          type: 'keyboard',
          data: {
            rows: [
              [
                { id: 'b1', label: '确认', payload: 'ok', mode: 'command', command: { enter: true } },
                { id: 'b2', label: '取消', payload: 'cancel' },
              ],
            ],
          },
        },
      ],
    });
    expect(mock.sent[0]?.message).toEqual([
      { type: 'markdown', data: { content: '请操作' } },
      {
        type: 'button',
        data: {
          buttons: [
            expect.objectContaining({
              id: 'b1',
              action: expect.objectContaining({ type: 2, data: 'ok', enter: true }),
            }),
            expect.objectContaining({
              id: 'b2',
              action: expect.objectContaining({ type: 1, data: 'cancel' }),
            }),
          ],
        },
      },
    ]);
    await endpoint.stop();
  });

  it('passes template keyboards through as-is', () => {
    expect(formatOutbound([{ type: 'keyboard', data: { id: 'kbd-1' } }]))
      .toEqual({ type: 'keyboard', data: { id: 'kbd-1' } });
  });

  it('degrades unknown segments to text and drops unusable media with a warn', () => {
    expect(formatOutbound([
      { type: 'text', data: { text: 'a' } },
      { type: 'music', data: { text: 'b' } },
    ])).toBe('ab');
    expect(formatOutbound([{ type: 'image', data: {} }])).toBe('');
    expect(formatOutbound([{ type: 'markdown', data: {} }])).toBe('');
  });

  it('propagates SDK send failures to the caller', async () => {
    const mock = createMockBot();
    mock.sendGroupMessage = vi.fn(async () => {
      throw new Error('QQ API 500');
    });
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    await expect(endpoint.send({ conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'group-1',
      }, payload: 'pong' }))
      .rejects.toThrow('QQ API 500');
    await endpoint.stop();
  });

  it('rejects when the send result carries no message id', async () => {
    const mock = createMockBot();
    mock.sendGroupMessage = vi.fn(async () => ({ code: 304023, message: 'audit rejected' }));
    const endpoint = new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'qq'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createBot: () => mock,
    });
    await endpoint.start();
    await expect(endpoint.send({ conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'group-1',
      }, payload: 'pong' }))
      .rejects.toThrow('QQ 发送消息失败（304023）: audit rejected');
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
