import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { napcatRuntimeStateToken } from '../src/napcat-runtime-state.js';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineNapCatAdapter from '../adapters/napcat.js';
import { getNapcatAgentDeps } from '../src/napcat-agent-deps.js';
import {
  NapCatHttpEndpoint,
  NapCatWssEndpoint,
  NapCatWsEndpoint,
  type NapCatWsSocket,
} from '../src/index.js';
import {
  buildSendAction,
  formatInboundContent,
  formatOutboundSegments,
  napcatInboundConversation,
  napcatOutboundTarget,
  resolveNapCatConfig,
  type NapCatEvent,
  type NapCatWsConfig,
} from '../src/protocol.js';
import type { ConversationRef } from '@zhin.js/im-contract';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const testConversation = (kind: ConversationRef['kind'], id: string): ConversationRef => ({
  endpoint: { id: 'test-endpoint', adapter: 'test' },
  kind,
  id,
});

const baseConfig: NapCatWsConfig = resolveNapCatConfig({
  connection: 'ws',
  id: 'test-napcat',
  url: 'ws://127.0.0.1:3001',
  access_token: 'secret',
  reconnect_interval: 50,
  heartbeat_interval: 60_000,
}) as NapCatWsConfig;

function createMockWs(): NapCatWsSocket & {
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

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(hosts.splice(0).map((host) => host.close().catch(() => undefined)));
});

describe('napcat protocol helpers', () => {
  it('resolves ws config from plugin config', () => {
    const resolved = resolveNapCatConfig({
      connection: 'ws',
      id: 'bot',
      url: 'ws://localhost:1',
    });
    expect(resolved).toMatchObject({
      connection: 'ws',
      id: 'bot',
      url: 'ws://localhost:1',
      reconnect_interval: 5000,
      heartbeat_interval: 30_000,
    });
  });

  it('resolves http mode from legacy endpoints', () => {
    const resolved = resolveNapCatConfig({
      endpoints: [{
        context: 'napcat',
        connection: 'http',
        id: 'http-bot',
        http_url: 'http://127.0.0.1:3000',
        post_path: '/napcat/post',
      }],
    });
    expect(resolved).toMatchObject({
      connection: 'http',
      id: 'http-bot',
      http_url: 'http://127.0.0.1:3000',
      post_path: '/napcat/post',
    });
  });

  it('normalizes inbound conversation and content', () => {
    const ev: NapCatEvent = {
      post_type: 'message',
      message_type: 'group',
      message_id: 1,
      group_id: 100,
      user_id: 9,
      raw_message: 'hello',
      message: [{ type: 'text', data: { text: 'hello' } }],
      time: 1,
    };
    expect(napcatInboundConversation('napcat-endpoint', ev)).toEqual({
      endpoint: { id: 'napcat-endpoint', adapter: 'napcat-endpoint' },
      kind: 'group',
      id: '100',
    });
    expect(formatInboundContent(ev)).toBe('hello');
  });

  it('maps private temp sessions to a private conversation with group parent', () => {
    const ev: NapCatEvent = {
      post_type: 'message',
      message_type: 'private',
      sub_type: 'group',
      message_id: 1,
      group_id: 100,
      user_id: 9,
      raw_message: 'hi',
    };
    expect(napcatInboundConversation('napcat-endpoint', ev)).toEqual({
      endpoint: { id: 'napcat-endpoint', adapter: 'napcat-endpoint' },
      kind: 'private',
      id: '9',
      parent: { kind: 'group', id: '100' },
    });
  });

  it('derives outbound targets from conversation', () => {
    const conv = (kind: ConversationRef['kind'], id: string): ConversationRef => ({
      endpoint: { id: 'e', adapter: 'a' },
      kind,
      id,
    });
    expect(napcatOutboundTarget(conv('private', '42'))).toEqual({ message_type: 'private', id: '42' });
    expect(napcatOutboundTarget(conv('group', '9'))).toEqual({ message_type: 'group', id: '9' });
  });

  it('builds send_*_msg actions from target', () => {
    expect(buildSendAction({ message_type: 'private', id: '1' }, [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      action: 'send_private_msg',
      params: {
        user_id: 1,
        message: [{ type: 'text', data: { text: 'hi' } }],
      },
    });
    expect(buildSendAction({ message_type: 'group', id: '2' }, [{ type: 'text', data: { text: 'hi' } }])).toEqual({
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
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { file: 'https://x/a.png' } },
    ]);
  });

  it('maps canonical segments to OneBot wire segments', () => {
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'hi' } },
      { type: 'mention', data: { target: '10001' } },
      { type: 'reply', data: { message_id: '42' } },
      { type: 'face', data: { id: 14, name: '微笑' } },
    ])).toEqual([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { qq: '10001' } },
      { type: 'reply', data: { id: '42' } },
      { type: 'face', data: { id: 14 } },
    ]);
  });

  it('maps canonical MediaRef to OneBot file field', () => {
    expect(formatOutboundSegments([
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
    ])).toEqual([
      { type: 'image', data: { file: 'https://x/a.png' } },
    ]);
    // html→image 渲染产物（canonical base64 MediaRef）→ base64:// file
    expect(formatOutboundSegments([
      {
        type: 'image',
        data: {
          media: { kind: 'base64', value: 'QUJD', mime_type: 'image/png' },
          name: 'card.png',
        },
      },
    ])).toEqual([
      { type: 'image', data: { name: 'card.png', file: 'base64://QUJD' } },
    ]);
    expect(formatOutboundSegments([
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png' } } },
    ])).toEqual([
      { type: 'image', data: { file: 'file:///tmp/a.png' } },
    ]);
    // canonical audio → OneBot record
    expect(formatOutboundSegments([
      { type: 'audio', data: { media: { kind: 'url', value: 'https://x/a.mp3' } } },
    ])).toEqual([
      { type: 'record', data: { file: 'https://x/a.mp3' } },
    ]);
    expect(formatOutboundSegments([
      { type: 'video', data: { media: { kind: 'url', value: 'https://x/a.mp4' } } },
    ])).toEqual([
      { type: 'video', data: { file: 'https://x/a.mp4' } },
    ]);
  });

  it('drops media segments without a canonical MediaRef with a warn', () => {
    // legacy 形状（data.file / data.url / data.base64）不再回读，直接丢弃
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { file: 'https://x/a.png' } },
      { type: 'image', data: { url: 'https://x/b.png' } },
      { type: 'audio', data: { base64: 'QUJD' } },
    ])).toEqual([{ type: 'text', data: { text: 'hi' } }]);
    // 全部段被丢弃时回退空文本段
    expect(formatOutboundSegments([{ type: 'image', data: {} }]))
      .toEqual([{ type: 'text', data: { text: '' } }]);
  });

  it('keeps platform extension segments untouched', () => {
    expect(formatOutboundSegments([
      { type: 'poke', data: { qq: '10001' } },
      { type: 'at', data: { qq: 'all' } },
    ])).toEqual([
      { type: 'poke', data: { qq: '10001' } },
      { type: 'at', data: { qq: 'all' } },
    ]);
  });
});

describe('napcat plugin runtime adapter', () => {
  it('routes admitted message events through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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
      conversation: expect.objectContaining({ kind: 'private', id: '10001' }),
      message: expect.objectContaining({ id: '42' }),
      content: '你好',
      sender: expect.objectContaining({ id: '10001', name: 'Alice' }),
      metadata: expect.objectContaining({ nickname: 'Alice' }),
    }));

    await endpoint.stop();
    expect(ws.close).toHaveBeenCalled();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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

  it('filters self messages', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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
      message_type: 'private',
      message_id: 2,
      user_id: 99,
      self_id: 99,
      raw_message: 'self',
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('marks mentioned when group message @s the bot uin (self_id)', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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
      group_id: 200,
      user_id: 2,
      self_id: 10001,
      raw_message: '在吗',
      message: [
        { type: 'at', data: { qq: 10001 } },
        { type: 'text', data: { text: ' 在吗' } },
      ],
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'group', id: '200' }),
      sender: expect.objectContaining({ id: '2' }),
      mentioned: true,
    }));
    await endpoint.stop();
  });

  it('does not mark mentioned when @ targets someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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
      message_id: 102,
      group_id: 200,
      user_id: 2,
      self_id: 10001,
      message: [
        { type: 'at', data: { qq: 10002 } },
        { type: 'text', data: { text: ' 在吗' } },
      ],
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();
    await endpoint.stop();
  });

  it("does not mark mentioned for qq='all'", async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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
      group_id: 200,
      user_id: 2,
      self_id: 10001,
      message: [
        { type: 'at', data: { qq: 'all' } },
        { type: 'text', data: { text: ' 通知' } },
      ],
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();
    await endpoint.stop();
  });

  it('sends outbound payloads via WS send_private_msg action', async () => {
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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
      conversation: testConversation('private', '10001'),
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
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
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
      conversation: expect.objectContaining({ kind: 'group', id: '200' }),
      content: 'from-ws',
    }));
    await endpoint.stop();
  });

  it('creates wss endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = defineNapCatAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
      name: 'napcat',
      config: { connection: 'wss', id: 'rev', path: '/napcat/ws' },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === napcatRuntimeStateToken) return createEndpointRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(NapCatWssEndpoint);
  });

  it('creates http endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = defineNapCatAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
      name: 'napcat',
      config: {
        connection: 'http',
        id: 'http-bot',
        http_url: 'http://127.0.0.1:3000',
        post_path: '/napcat/post',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === napcatRuntimeStateToken) return createEndpointRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(NapCatHttpEndpoint);
  });

  it('handles HTTP POST and routes events through MessageGateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const callHttpAction = vi.fn(async () => ({
      status: 'ok',
      retcode: 0,
      data: { message_id: 99 },
    }));
    const endpoint = new NapCatHttpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
      gateway,
      http,
      config: resolveNapCatConfig({
        connection: 'http',
        id: 'http-bot',
        http_url: 'http://127.0.0.1:3000',
        post_path: '/napcat/post',
      }) as ReturnType<typeof resolveNapCatConfig> & { connection: 'http' },
      callHttpAction,
    });

    await endpoint.start();
    const { port } = await http.listen();
    endpoint.open();

    const res = await globalThis.fetch(`http://127.0.0.1:${port}/napcat/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        message_id: 42,
        user_id: 10001,
        raw_message: 'from-http',
      }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'private', id: '10001' }),
      message: expect.objectContaining({ id: '42' }),
      content: 'from-http',
    }));

    await endpoint.send({ conversation: testConversation('private', '10001'), payload: 'pong' });
    expect(callHttpAction).toHaveBeenCalledWith(
      expect.objectContaining({ http_url: 'http://127.0.0.1:3000' }),
      'send_private_msg',
      expect.objectContaining({ user_id: 10001 }),
    );

    await endpoint.stop();
  });
});

describe('napcat ws lifecycle', () => {
  function pingCalls(ws: ReturnType<typeof createMockWs>): number {
    return (ws.ping as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  }

  it('does not arm reconnect when the initial connect closes before open', async () => {
    let creates = 0;
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig, // reconnect_interval: 50
      createWebSocket: () => {
        creates += 1;
        const ws = createMockWs();
        queueMicrotask(() => ws.emitClose(1006, 'refused'));
        return ws;
      },
    });

    await expect(endpoint.start()).rejects.toThrow('NapCat WS closed');
    // 等超过一个 reconnect_interval，不应有重连（僵尸连接）发生
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(creates).toBe(1);
    // start 失败后 agent endpoint 已反注册
    expect(() => getNapcatAgentDeps().getEndpoint('test-napcat')).toThrow();
  });

  it('reconnects only after an established connection closes', async () => {
    const sockets: ReturnType<typeof createMockWs>[] = [];
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        const ws = createMockWs();
        sockets.push(ws);
        queueMicrotask(() => {
          if (sockets.length === 1) ws.emitOpen();
        });
        return ws;
      },
    });

    await endpoint.start();
    sockets[0]!.emitClose(1006, 'lost');
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    await endpoint.stop();
  });

  it('clears the heartbeat interval when the socket closes', async () => {
    const ws = createMockWs();
    const endpoint = new NapCatWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'napcat'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: resolveNapCatConfig({
        connection: 'ws',
        id: 'hb-napcat',
        url: 'ws://127.0.0.1:3001',
        access_token: 'secret',
        reconnect_interval: 10_000,
        heartbeat_interval: 20,
      }) as NapCatWsConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });

    await endpoint.start();
    await new Promise((resolve) => setTimeout(resolve, 70));
    const pingsBeforeClose = pingCalls(ws);
    expect(pingsBeforeClose).toBeGreaterThan(0);

    ws.emitClose(1006, 'lost');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pingCalls(ws)).toBe(pingsBeforeClose);

    await endpoint.stop();
  });
});
