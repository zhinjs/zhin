import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
import type { OneBot11WsSocket } from '../src/ws-types.js';
import {
  buildSendAction,
  extractQuoteId,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  isOneBot11BotMentioned,
  parseSendTarget,
  resolveOneBot11Config,
  senderNickname,
  senderUserId,
  type OneBot11Event,
  type OneBot11WsConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig: OneBot11WsConfig = resolveOneBot11Config({
  connection: 'ws',
  name: 'test-ob11',
  url: 'ws://127.0.0.1:6700',
  access_token: 'secret',
  reconnect_interval: 50,
  heartbeat_interval: 60_000,
}) as OneBot11WsConfig;

function createMockWs(): OneBot11WsSocket & {
  emitOpen: () => void;
  emitMessage: (data: string) => void;
  emitClose: (code?: number, reason?: string) => void;
  emitError: (error: Error) => void;
  sent: string[];
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: string[] = [];
  const on = (event: string, listener: (...args: unknown[]) => void) => {
    const list = listeners.get(event) ?? [];
    list.push(listener);
    listeners.set(event, list);
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  return {
    readyState: 1,
    sent,
    send: vi.fn((data: string) => {
      sent.push(data);
    }),
    close: vi.fn(),
    ping: vi.fn(),
    on,
    emitOpen() {
      emit('open');
    },
    emitMessage(data: string) {
      emit('message', data);
    },
    emitClose(code = 1000, reason = 'bye') {
      emit('close', code, reason);
    },
    emitError(error: Error) {
      emit('error', error);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('onebot11 protocol helpers', () => {
  it('resolves ws config from plugin config', () => {
    const resolved = resolveOneBot11Config({
      connection: 'ws',
      name: 'bot',
      url: 'ws://localhost:1',
    });
    expect(resolved).toMatchObject({
      connection: 'ws',
      name: 'bot',
      url: 'ws://localhost:1',
      reconnect_interval: 5000,
      heartbeat_interval: 30_000,
    });
  });

  it('maps legacy type ws_reverse to wss', () => {
    const resolved = resolveOneBot11Config({
      endpoints: [{
        context: 'onebot11',
        type: 'ws_reverse',
        name: 'rev',
        path: '/onebot/ws',
      }],
    });
    expect(resolved).toMatchObject({
      connection: 'wss',
      name: 'rev',
      path: '/onebot/ws',
    });
  });

  it('formats inbound target and content', () => {
    const ev: OneBot11Event = {
      post_type: 'message',
      message_type: 'group',
      message_id: 1,
      group_id: 100,
      user_id: 9,
      raw_message: 'hello',
      message: [{ type: 'text', data: { text: 'hello' } }],
      time: 1,
    };
    expect(formatInboundTarget(ev)).toBe('group:100');
    expect(formatInboundContent(ev)).toBe('hello');
  });

  it('parses send targets', () => {
    expect(parseSendTarget('private:42')).toEqual({ message_type: 'private', id: '42' });
    expect(parseSendTarget('group:9')).toEqual({ message_type: 'group', id: '9' });
  });

  it('builds send_*_msg actions from target', () => {
    expect(buildSendAction('private:1', [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      action: 'send_private_msg',
      params: {
        user_id: 1,
        message: [{ type: 'text', data: { text: 'hi' } }],
      },
    });
    expect(buildSendAction('group:2', [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      action: 'send_group_msg',
      params: {
        group_id: 2,
        message: [{ type: 'text', data: { text: 'hi' } }],
      },
    });
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundSegments('pong')).toEqual([{ type: 'text', data: { text: 'pong' } }]);
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { file: 'https://x/a.png' } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { file: 'https://x/a.png' } },
    ]);
  });

  it('resolves sender as user id and nickname separately', () => {
    const ev: OneBot11Event = {
      post_type: 'message',
      message_id: 1,
      user_id: 42,
      sender: { card: '群名片', nickname: 'nick' },
    };
    expect(senderUserId(ev)).toBe('42');
    expect(senderNickname(ev)).toBe('群名片');
    expect(senderUserId({ post_type: 'message', message_id: 1 })).toBe('');
    expect(senderNickname({
      post_type: 'message',
      message_id: 1,
      user_id: 7,
      sender: { nickname: 'nick' },
    })).toBe('nick');
  });

  it('extracts quote id from reply segment or top-level reply', () => {
    expect(extractQuoteId({
      post_type: 'message',
      message_id: 1,
      message: [{ type: 'reply', data: { id: 555 } }],
    })).toBe('555');
    expect(extractQuoteId({ post_type: 'message', message_id: 1, reply: 777 })).toBe('777');
    expect(extractQuoteId({
      post_type: 'message',
      message_id: 1,
      reply: { message_id: 'm-9' },
    })).toBe('m-9');
    expect(extractQuoteId({ post_type: 'message', message_id: 1 })).toBeUndefined();
  });

  it('detects bot mention by self_id, excluding @all', () => {
    const message = [
      { type: 'at', data: { qq: '10001' } },
      { type: 'text', data: { text: ' hi' } },
    ];
    expect(isOneBot11BotMentioned({ selfId: '10001', message })).toBe(true);
    expect(isOneBot11BotMentioned({ selfId: '10002', message })).toBe(false);
    expect(isOneBot11BotMentioned({
      selfId: '10001',
      message: [{ type: 'at', data: { qq: 'all' } }],
    })).toBe(false);
    expect(isOneBot11BotMentioned({ selfId: undefined, message })).toBe(false);
    expect(isOneBot11BotMentioned({ selfId: '10001' })).toBe(false);
  });
});

describe('onebot11 plugin runtime adapter', () => {
  it('routes admitted message events through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const ws = createMockWs();
    const endpoint = new OneBot11WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      gateway,
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit({
      post_type: 'message',
      message_type: 'private',
      message_id: 42,
      user_id: 10001,
      raw_message: '你好',
      message: [{ type: 'text', data: { text: '你好' } }],
      sender: { nickname: 'Alice' },
      time: 1_700_000_000,
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'private:10001',
      content: '你好',
      sender: '10001',
      id: '42',
      metadata: expect.objectContaining({ nickname: 'Alice' }),
    }));

    await endpoint.stop();
    expect(ws.close).toHaveBeenCalled();
  });

  it('marks metadata.mentioned when a group message @s the bot self_id', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const ws = createMockWs();
    const endpoint = new OneBot11WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();
    endpoint.admit({
      post_type: 'message',
      message_type: 'group',
      message_id: 100,
      self_id: 10001,
      group_id: 200,
      user_id: 9,
      raw_message: '在吗',
      message: [
        { type: 'at', data: { qq: '10001' } },
        { type: 'text', data: { text: ' 在吗' } },
      ],
      sender: { nickname: 'bob', role: 'member' },
      time: 1_700_000_000,
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:200',
      sender: '9',
      metadata: expect.objectContaining({ mentioned: true, nickname: 'bob' }),
    }));
    await endpoint.stop();
  });

  it('does not mark metadata.mentioned when @ targets someone else or @all', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const ws = createMockWs();
    const endpoint = new OneBot11WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();

    endpoint.admit({
      post_type: 'message',
      message_type: 'group',
      message_id: 101,
      self_id: 10001,
      group_id: 200,
      user_id: 9,
      message: [
        { type: 'at', data: { qq: '10002' } },
        { type: 'text', data: { text: ' 在吗' } },
      ],
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    let metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(metadata?.mentioned).toBeUndefined();

    endpoint.admit({
      post_type: 'message',
      message_type: 'group',
      message_id: 102,
      self_id: 10001,
      group_id: 200,
      user_id: 9,
      message: [
        { type: 'at', data: { qq: 'all' } },
        { type: 'text', data: { text: ' 通知' } },
      ],
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    metadata = receive.mock.calls[1]?.[0]?.metadata as Record<string, unknown>;
    expect(metadata?.mentioned).toBeUndefined();
    await endpoint.stop();
  });

  it('forwards reply segment id as metadata.quote_id', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const ws = createMockWs();
    const endpoint = new OneBot11WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();
    endpoint.admit({
      post_type: 'message',
      message_type: 'group',
      message_id: 103,
      self_id: 10001,
      group_id: 200,
      user_id: 9,
      raw_message: '引用回复',
      message: [
        { type: 'reply', data: { id: 555 } },
        { type: 'text', data: { text: '引用回复' } },
      ],
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ quote_id: '555' }),
    }));
    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new OneBot11WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.admit({
      post_type: 'message',
      message_type: 'private',
      message_id: 1,
      user_id: 1,
      raw_message: 'nope',
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via WS send_private_msg action', async () => {
    const ws = createMockWs();
    const endpoint = new OneBot11WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();

    const sendPromise = endpoint.send({
      target: 'private:10001',
      payload: 'pong',
    });

    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    const req = JSON.parse(ws.sent[0]!) as {
      action: string;
      params: Record<string, unknown>;
      echo: string;
    };
    expect(req.action).toBe('send_private_msg');
    expect(req.params).toMatchObject({
      user_id: 10001,
      message: [{ type: 'text', data: { text: 'pong' } }],
    });

    ws.emitMessage(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: { message_id: 99 },
      echo: req.echo,
    }));

    await expect(sendPromise).resolves.toBe('99');
    await endpoint.stop();
  });

  it('admits inbound events received over the socket when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new OneBot11WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();
    ws.emitMessage(JSON.stringify({
      post_type: 'message',
      message_type: 'group',
      message_id: 7,
      group_id: 200,
      user_id: 9,
      raw_message: 'from-ws',
      message: [{ type: 'text', data: { text: 'from-ws' } }],
    }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:200',
      content: 'from-ws',
    }));
    await endpoint.stop();
  });

  it('creates reverse-wss endpoint when httpHostToken provided', async () => {
    const { default: adapter } = await import('../adapters/onebot11.js');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = adapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot11'),
      name: 'onebot11',
      config: { connection: 'wss', name: 'rev', path: '/onebot/ws' },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeDefined();
  });
});
