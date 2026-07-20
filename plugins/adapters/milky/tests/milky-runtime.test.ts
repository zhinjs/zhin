import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineMilkyAdapter from '../adapters/milky.js';
import {
  MilkySseEndpoint,
  MilkyWebhookEndpoint,
  MilkyWssEndpoint,
  MilkyWsEndpoint,
  consumeSseBuffer,
  type MilkyWsSocket,
} from '../src/endpoint.js';
import {
  buildSendAction,
  extractInboundAudioUrl,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  parseMessageReceiveData,
  parseSendTarget,
  resolveMilkyConfig,
  type MilkyEvent,
  type MilkyWsConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const baseConfig: MilkyWsConfig = resolveMilkyConfig({
  connection: 'ws',
  name: 'test-milky',
  baseUrl: 'http://127.0.0.1:8080',
  access_token: 'secret',
  reconnect_interval: 50,
  heartbeat_interval: 60_000,
}) as MilkyWsConfig;

function createMockWs(): MilkyWsSocket & {
  emitOpen: () => void;
  emitMessage: (data: string) => void;
  emitClose: (code?: number, reason?: string) => void;
  emitError: (error: Error) => void;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
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

describe('milky protocol helpers', () => {
  it('resolves ws config from plugin config', () => {
    const resolved = resolveMilkyConfig({
      connection: 'ws',
      name: 'bot',
      baseUrl: 'http://localhost:1',
    });
    expect(resolved).toMatchObject({
      connection: 'ws',
      name: 'bot',
      baseUrl: 'http://localhost:1',
      reconnect_interval: 5000,
      heartbeat_interval: 30_000,
    });
  });

  it('resolves webhook path from legacy endpoints', () => {
    const resolved = resolveMilkyConfig({
      endpoints: [{
        context: 'milky',
        connection: 'webhook',
        name: 'hook',
        baseUrl: 'http://127.0.0.1:8080',
        path: '/milky/webhook',
      }],
    });
    expect(resolved).toMatchObject({
      connection: 'webhook',
      name: 'hook',
      path: '/milky/webhook',
    });
  });

  it('formats inbound target and content from message_receive', () => {
    const event: MilkyEvent = {
      event_type: 'message_receive',
      time: 1,
      self_id: 1,
      data: {
        message_scene: 'group',
        peer_id: 100,
        message_seq: 9,
        sender_id: 42,
        time: 1,
        segments: [{ type: 'text', data: { text: 'hello' } }],
        group_member: { user_id: 42, card: 'Alice' },
      },
    };
    const data = parseMessageReceiveData(event)!;
    expect(formatInboundTarget(data)).toBe('group:100');
    expect(formatInboundContent(data)).toBe('hello');
  });

  it('parses send targets', () => {
    expect(parseSendTarget('private:42')).toEqual({ message_type: 'private', id: '42' });
    expect(parseSendTarget('group:9')).toEqual({ message_type: 'group', id: '9' });
  });

  it('builds send_*_message actions from target', () => {
    expect(buildSendAction('private:1', [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      action: 'send_private_message',
      params: {
        user_id: 1,
        message: [{ type: 'text', data: { text: 'hi' } }],
      },
    });
    expect(buildSendAction('group:2', [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      action: 'send_group_message',
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
      { type: 'image', data: { url: 'https://x/a.png' } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { uri: 'https://x/a.png' } },
    ]);
  });
});

describe('milky plugin runtime adapter', () => {
  it('routes admitted message events through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const ws = createMockWs();
    const callApi = vi.fn(async () => ({}));
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway,
      config: baseConfig,
      callApi,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit({
      event_type: 'message_receive',
      time: 1_700_000_000,
      self_id: 1,
      data: {
        message_scene: 'friend',
        peer_id: 10001,
        message_seq: 42,
        sender_id: 10001,
        time: 1_700_000_000,
        segments: [{ type: 'text', data: { text: '你好' } }],
        friend: { user_id: 10001, nickname: 'Alice' },
      },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'private:10001',
      content: '你好',
      sender: '10001',
      id: 'friend:10001:42',
      metadata: expect.objectContaining({ nickname: 'Alice' }),
    }));

    await endpoint.stop();
    expect(ws.close).toHaveBeenCalled();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      callApi: vi.fn(async () => ({})),
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.admit({
      event_type: 'message_receive',
      time: 1,
      self_id: 1,
      data: {
        message_scene: 'friend',
        peer_id: 1,
        message_seq: 1,
        sender_id: 1,
        time: 1,
        segments: [{ type: 'text', data: { text: 'nope' } }],
      },
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via HTTP send_private_message', async () => {
    const ws = createMockWs();
    const callApi = vi.fn(async () => ({ message_seq: 99 }));
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      callApi,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();

    await expect(endpoint.send({
      target: 'private:10001',
      payload: 'pong',
    })).resolves.toBe('friend:10001:99');

    expect(callApi).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://127.0.0.1:8080' }),
      'send_private_message',
      {
        user_id: 10001,
        message: [{ type: 'text', data: { text: 'pong' } }],
      },
    );
    await endpoint.stop();
  });

  it('admits inbound events received over the socket when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      callApi: vi.fn(async () => ({})),
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();
    ws.emitMessage(JSON.stringify({
      event_type: 'message_receive',
      time: 1,
      self_id: 1,
      data: {
        message_scene: 'group',
        peer_id: 200,
        message_seq: 7,
        sender_id: 9,
        time: 1,
        segments: [{ type: 'text', data: { text: 'from-ws' } }],
      },
    }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:200',
      content: 'from-ws',
    }));
    await endpoint.stop();
  });

  it('marks metadata.mentioned when a mention segment targets the bot self_id', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const ws = createMockWs();
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      callApi: vi.fn(async () => ({})),
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();
    endpoint.admit({
      event_type: 'message_receive',
      time: 1,
      self_id: 10001,
      data: {
        message_scene: 'group',
        peer_id: 200,
        message_seq: 8,
        sender_id: 9,
        time: 1,
        segments: [
          { type: 'mention', data: { user_id: 10001 } },
          { type: 'text', data: { text: ' 在吗' } },
        ],
        group_member: { user_id: 9, nickname: 'bob' },
      },
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:200',
      sender: '9',
      metadata: expect.objectContaining({ mentioned: true, nickname: 'bob' }),
    }));
    await endpoint.stop();
  });

  it('does not mark metadata.mentioned when a mention targets someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      callApi: vi.fn(async () => ({})),
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.open();
    endpoint.admit({
      event_type: 'message_receive',
      time: 1,
      self_id: 10001,
      data: {
        message_scene: 'group',
        peer_id: 200,
        message_seq: 9,
        sender_id: 9,
        time: 1,
        segments: [
          { type: 'mention', data: { user_id: 10002 } },
          { type: 'text', data: { text: ' 在吗' } },
        ],
      },
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(metadata?.mentioned).toBeUndefined();
    await endpoint.stop();
  });

  it('creates webhook endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = defineMilkyAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      name: 'milky',
      config: {
        connection: 'webhook',
        name: 'hook',
        baseUrl: 'http://127.0.0.1:8080',
        path: '/milky/webhook',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(MilkyWebhookEndpoint);
  });

  it('creates reverse-wss endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = defineMilkyAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      name: 'milky',
      config: {
        connection: 'wss',
        name: 'rev',
        baseUrl: 'http://127.0.0.1:8080',
        path: '/milky/ws',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(MilkyWssEndpoint);
  });

  it('creates sse endpoint and admits events from stream frames', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    let onMessage!: (data: string) => void;
    let onOpen!: () => void;
    const endpoint = new MilkySseEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway,
      config: resolveMilkyConfig({
        connection: 'sse',
        name: 'sse-bot',
        baseUrl: 'http://127.0.0.1:8080',
      }) as never,
      createSseStream: (options) => {
        onMessage = options.onMessage;
        onOpen = options.onOpen ?? (() => undefined);
        queueMicrotask(() => onOpen());
        return {
          closed: new Promise(() => undefined),
          close() { /* noop */ },
        };
      },
    });
    await endpoint.start();
    endpoint.open();
    onMessage(JSON.stringify({
      event_type: 'message_receive',
      time: 1,
      self_id: 1,
      data: {
        message_scene: 'friend',
        peer_id: 100,
        message_seq: 7,
        sender_id: 100,
        time: 1,
        segments: [
          { type: 'text', data: { text: 'hi' } },
          { type: 'record', data: { uri: 'https://cdn.example/a.silk' } },
        ],
        friend: { user_id: 100, nickname: 'Bob' },
      },
    }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive.mock.calls[0]?.[0]).toMatchObject({
      content: 'hi[audio:https://cdn.example/a.silk]',
      metadata: expect.objectContaining({ audio_url: 'https://cdn.example/a.silk' }),
    });
    await endpoint.stop();

    const created = defineMilkyAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      name: 'milky',
      config: {
        connection: 'sse',
        name: 'sse-bot',
        baseUrl: 'http://127.0.0.1:8080',
      },
      use: (token: unknown) => {
        if (token === messageGatewayToken) return gateway;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(created).toBeInstanceOf(MilkySseEndpoint);
  });

  it('parses SSE data frames', () => {
    const messages: string[] = [];
    const rest = consumeSseBuffer('data: {"a":1}\n\ndata: hi\n\npartial', (data) => {
      messages.push(data);
    });
    expect(messages).toEqual(['{"a":1}', 'hi']);
    expect(rest).toBe('partial');
  });

  it('extracts inbound audio url from record segments', () => {
    expect(extractInboundAudioUrl({
      message_scene: 'friend',
      peer_id: 1,
      message_seq: 1,
      sender_id: 1,
      time: 1,
      segments: [{ type: 'record', data: { url: 'https://x/a.wav' } }],
    })).toBe('https://x/a.wav');
  });

  it('handles webhook POST and routes events through MessageGateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new MilkyWebhookEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway,
      http,
      config: resolveMilkyConfig({
        connection: 'webhook',
        name: 'hook',
        baseUrl: 'http://127.0.0.1:8080',
        path: '/milky/webhook',
      }) as ReturnType<typeof resolveMilkyConfig> & { connection: 'webhook' },
      callApi: vi.fn(async () => ({})),
    });

    await endpoint.start();
    const { port } = await http.listen();
    endpoint.open();

    const res = await globalThis.fetch(`http://127.0.0.1:${port}/milky/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'message_receive',
        time: 1,
        self_id: 1,
        data: {
          message_scene: 'friend',
          peer_id: 10001,
          message_seq: 42,
          sender_id: 10001,
          time: 1,
          segments: [{ type: 'text', data: { text: 'from-webhook' } }],
          friend: { user_id: 10001, nickname: 'Alice' },
        },
      }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'private:10001',
      content: 'from-webhook',
      sender: '10001',
      id: 'friend:10001:42',
      metadata: expect.objectContaining({ nickname: 'Alice' }),
    }));

    await endpoint.stop();
  });
});
