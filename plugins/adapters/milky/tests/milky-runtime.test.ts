import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { milkyRuntimeStateToken } from '../src/milky-runtime-state.js';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineMilkyAdapter from '../adapters/milky.js';
import { getMilkyAgentDeps } from '../src/milky-agent-deps.js';
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
  formatInboundSegments,
  formatOutboundSegments,
  milkyInboundConversation,
  parseMessageReceiveData,
  resolveMilkyConfig,
  type MilkyEvent,
  type MilkyIncomingMessage,
  type MilkyWsConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const milkyCapabilityId = capabilityId(rootPluginId(), adapterFeature, 'milky');
const milkyEndpointRef = {
  id: String(milkyCapabilityId),
  adapter: String(rootPluginId()),
} as const;

function milkyConversation(kind: 'private' | 'group', id: string) {
  return {
    endpoint: milkyEndpointRef,
    kind,
    id,
  } as const;
}

const baseConfig: MilkyWsConfig = resolveMilkyConfig({
  connection: 'ws',
  id: 'test-milky',
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
      id: 'bot',
      baseUrl: 'http://localhost:1',
    });
    expect(resolved).toMatchObject({
      connection: 'ws',
      id: 'bot',
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
        id: 'hook',
        baseUrl: 'http://127.0.0.1:8080',
        path: '/milky/webhook',
      }],
    });
    expect(resolved).toMatchObject({
      connection: 'webhook',
      id: 'hook',
      path: '/milky/webhook',
    });
  });

  it('builds inbound ConversationRef and content from message_receive', () => {
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
    expect(milkyInboundConversation('root\0zhin.adapter\0milky', data)).toEqual({
      endpoint: { id: 'root\0zhin.adapter\0milky', adapter: 'root' },
      kind: 'group',
      id: '100',
    });
    expect(formatInboundContent(data)).toBe('hello');
  });

  it('maps temp scene to a private conversation inside its group container', () => {
    const data = parseMessageReceiveData({
      event_type: 'message_receive',
      time: 1,
      self_id: 1,
      data: {
        message_scene: 'temp',
        peer_id: 100,
        message_seq: 9,
        sender_id: 42,
        time: 1,
        segments: [{ type: 'text', data: { text: 'hi' } }],
        group: { group_id: 7 },
      },
    })!;
    expect(milkyInboundConversation('ep', data)).toEqual({
      endpoint: { id: 'ep', adapter: 'ep' },
      kind: 'private',
      id: '100',
      parent: { kind: 'group', id: '7' },
    });
  });

  function incomingMessage(segments: MilkyIncomingMessage['segments']): MilkyIncomingMessage {
    return {
      message_scene: 'group',
      peer_id: 100,
      message_seq: 9,
      sender_id: 42,
      time: 1,
      segments,
    };
  }

  it('maps media/mention/reply/face inbound segments to canonical Segment[]', () => {
    const segments = formatInboundSegments(incomingMessage([
      { type: 'reply', data: { message_seq: 7 } },
      { type: 'mention', data: { user_id: 10001, name: 'bot' } },
      { type: 'mention_all', data: {} },
      { type: 'text', data: { text: 'hi' } },
      { type: 'face', data: { face_id: '14' } },
      {
        type: 'image',
        data: { resource_id: 'img-r1', temp_url: 'https://cdn.example/a.jpg', summary: '[图片]' },
      },
      { type: 'record', data: { resource_id: 'rec-r1', temp_url: 'https://cdn.example/a.silk' } },
      { type: 'video', data: { resource_id: 'vid-r1', temp_url: 'https://cdn.example/a.mp4' } },
      { type: 'file', data: { file_id: 'fid-1', file_name: 'a.pdf', file_size: 1024 } },
    ]));
    expect(segments).toEqual([
      { type: 'reply', data: { message_id: 'group:100:7' } },
      { type: 'mention', data: { target: '10001', name: 'bot' } },
      { type: 'mention', data: { target: 'all' } },
      { type: 'text', data: { text: 'hi' } },
      { type: 'face', data: { id: '14' } },
      {
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg' }, alt: '[图片]' },
      },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://cdn.example/a.silk' } } },
      { type: 'video', data: { media: { kind: 'url', value: 'https://cdn.example/a.mp4' } } },
      {
        type: 'file',
        data: { media: { kind: 'file', value: 'fid-1' }, name: 'a.pdf', size: 1024 },
      },
    ]);
  });

  it('falls back to resource_id (kind=file) when media temp_url is absent', () => {
    const segments = formatInboundSegments(incomingMessage([
      { type: 'image', data: { resource_id: 'img-r2' } },
    ]));
    expect(segments).toEqual([
      { type: 'image', data: { media: { kind: 'file', value: 'img-r2' } } },
    ]);
  });

  it('keeps text-only messages unchanged and passes through unknown segment types', () => {
    const segments = formatInboundSegments(incomingMessage([
      { type: 'text', data: { text: 'hello' } },
      { type: 'light_app', data: { app_name: 'app', json_payload: '{}' } },
    ]));
    expect(segments).toEqual([
      { type: 'text', data: { text: 'hello' } },
      { type: 'light_app', data: { app_name: 'app', json_payload: '{}' } },
    ]);
    // 纯文本视图不受影响
    expect(formatInboundContent(incomingMessage([{ type: 'text', data: { text: 'hello' } }])))
      .toBe('hello');
  });

  it('builds send_*_message actions from the structured conversation', () => {
    expect(buildSendAction(milkyConversation('private', '1'), [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      action: 'send_private_message',
      params: {
        user_id: 1,
        message: [{ type: 'text', data: { text: 'hi' } }],
      },
    });
    expect(buildSendAction(milkyConversation('group', '2'), [{ type: 'text', data: { text: 'hi' } }])).toEqual({
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
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { uri: 'https://x/a.png' } },
    ]);
  });

  it('sends base64 media segments directly as base64:// uri', () => {
    expect(formatOutboundSegments([
      { type: 'image', data: { media: { kind: 'base64', value: 'aGk=', mime_type: 'image/png' } } },
    ])).toEqual([
      { type: 'image', data: { uri: 'base64://aGk=' } },
    ]);
    // 已带 base64:// 前缀的值原样透传
    expect(formatOutboundSegments([
      { type: 'image', data: { media: { kind: 'base64', value: 'base64://aGk=' } } },
    ])).toEqual([
      { type: 'image', data: { uri: 'base64://aGk=' } },
    ]);
  });

  it('maps canonical audio/video media segments to milky wire segments', () => {
    expect(formatOutboundSegments([
      { type: 'audio', data: { media: { kind: 'url', value: 'https://x/a.silk' } } },
      {
        type: 'video',
        data: {
          media: { kind: 'url', value: 'https://x/a.mp4' },
          thumb_uri: 'https://x/a.jpg',
        },
      },
    ])).toEqual([
      { type: 'record', data: { uri: 'https://x/a.silk' } },
      { type: 'video', data: { uri: 'https://x/a.mp4', thumb_uri: 'https://x/a.jpg' } },
    ]);
  });

  it('drops undeliverable media segments with a warn', () => {
    // 无 canonical media 引用：丢弃
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: {} },
    ])).toEqual([{ type: 'text', data: { text: 'hi' } }]);
    // kind=path / file：Milky 资源 uri 不支持，丢弃
    expect(formatOutboundSegments([
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png' } } },
      { type: 'video', data: { media: { kind: 'file', value: 'res-1' } } },
      { type: 'text', data: { text: 'end' } },
    ])).toEqual([{ type: 'text', data: { text: 'end' } }]);
    // file 段：Milky 消息 API 无对应 wire 段，丢弃
    expect(formatOutboundSegments([
      { type: 'file', data: { media: { kind: 'file', value: 'fid-1' }, name: 'a.pdf' } },
    ])).toEqual([{ type: 'text', data: { text: '' } }]);
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
      conversation: milkyConversation('private', '10001'),
      message: {
        conversation: milkyConversation('private', '10001'),
        id: 'friend:10001:42',
      },
      content: '你好',
      sender: expect.objectContaining({ id: '10001' }),
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
      conversation: milkyConversation('private', '10001'),
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
      conversation: milkyConversation('group', '200'),
      content: 'from-ws',
    }));
    await endpoint.stop();
  });

  it('marks mentioned when a mention segment targets the bot self_id', async () => {
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
      conversation: milkyConversation('group', '200'),
      sender: expect.objectContaining({ id: '9' }),
      mentioned: true, metadata: expect.objectContaining({ nickname: 'bob' }),
    }));
    await endpoint.stop();
  });

  it('does not mark mentioned when a mention targets someone else', async () => {
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
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();
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
        id: 'hook',
        baseUrl: 'http://127.0.0.1:8080',
        path: '/milky/webhook',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === milkyRuntimeStateToken) return createEndpointRuntimeState();
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
        id: 'rev',
        baseUrl: 'http://127.0.0.1:8080',
        path: '/milky/ws',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === milkyRuntimeStateToken) return createEndpointRuntimeState();
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
        id: 'sse-bot',
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
      segments: expect.arrayContaining([
        expect.objectContaining({ type: 'text', data: { text: 'hi' } }),
        expect.objectContaining({ type: 'audio', data: { media: { kind: 'url', value: 'https://cdn.example/a.silk' } } }),
      ]),
    });
    await endpoint.stop();

    const created = defineMilkyAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      name: 'milky',
      config: {
        connection: 'sse',
        id: 'sse-bot',
        baseUrl: 'http://127.0.0.1:8080',
      },
      use: (token: unknown) => {
        if (token === messageGatewayToken) return gateway;
        if (token === milkyRuntimeStateToken) return createEndpointRuntimeState();
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
        id: 'hook',
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
      conversation: milkyConversation('private', '10001'),
      message: {
        conversation: milkyConversation('private', '10001'),
        id: 'friend:10001:42',
      },
      content: 'from-webhook',
      sender: expect.objectContaining({ id: '10001' }),
      metadata: expect.objectContaining({ nickname: 'Alice' }),
    }));

    await endpoint.stop();
  });
});

describe('milky ws lifecycle', () => {
  function pingCalls(ws: ReturnType<typeof createMockWs>): number {
    return (ws.ping as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  }

  it('resets state and does not reconnect when the initial connect closes before open', async () => {
    let attempt = 0;
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig, // reconnect_interval: 50
      callApi: vi.fn(async () => ({})),
      createWebSocket: () => {
        attempt += 1;
        const ws = createMockWs();
        queueMicrotask(() => {
          if (attempt === 1) ws.emitClose(1006, 'refused');
          else ws.emitOpen();
        });
        return ws;
      },
    });

    await expect(endpoint.start()).rejects.toThrow('Milky WS 关闭');
    // 等超过一个 reconnect_interval，不应武装重连
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(attempt).toBe(1);
    // start 失败后 agent endpoint 已反注册
    expect(() => getMilkyAgentDeps().getEndpoint('test-milky')).toThrow();
    // #started 已复位，可重新 start
    await endpoint.start();
    expect(attempt).toBe(2);
    await endpoint.stop();
  });

  it('reconnects only after an established connection closes', async () => {
    const sockets: ReturnType<typeof createMockWs>[] = [];
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      callApi: vi.fn(async () => ({})),
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
    const endpoint = new MilkyWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: resolveMilkyConfig({
        connection: 'ws',
        id: 'hb-milky',
        baseUrl: 'http://127.0.0.1:8080',
        access_token: 'secret',
        reconnect_interval: 10_000,
        heartbeat_interval: 20,
      }) as MilkyWsConfig,
      callApi: vi.fn(async () => ({})),
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

describe('milky sse lifecycle', () => {
  it('resets state and does not reconnect when the initial connect fails before open', async () => {
    let attempt = 0;
    const endpoint = new MilkySseEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: resolveMilkyConfig({
        connection: 'sse',
        id: 'sse-retry-bot',
        baseUrl: 'http://127.0.0.1:8080',
        reconnect_interval: 50,
      }) as never,
      createSseStream: (options) => {
        attempt += 1;
        if (attempt === 1) queueMicrotask(() => options.onError?.(new Error('boom')));
        else queueMicrotask(() => options.onOpen?.());
        return {
          closed: new Promise(() => undefined),
          close() { /* noop */ },
        };
      },
    });

    await expect(endpoint.start()).rejects.toThrow('boom');
    // 等超过一个 reconnect_interval，不应武装重连
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(attempt).toBe(1);
    // start 失败后 agent endpoint 已反注册
    expect(() => getMilkyAgentDeps().getEndpoint('sse-retry-bot')).toThrow();
    // #started 已复位，可重新 start
    await endpoint.start();
    expect(attempt).toBe(2);
    await endpoint.stop();
  });

  it('resolves start when the stream is stopped during connect (主动停止不算失败)', async () => {
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const endpoint = new MilkySseEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'milky'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: resolveMilkyConfig({
        connection: 'sse',
        id: 'sse-stop-bot',
        baseUrl: 'http://127.0.0.1:8080',
      }) as never,
      createSseStream: () => ({
        closed,
        close() {
          queueMicrotask(() => resolveClosed());
        },
      }),
    });

    // 基座语义：stop-during-connect 静默 settle（主动停止），start 不再 reject
    const startPromise = endpoint.start();
    await endpoint.stop();
    await expect(startPromise).resolves.toBeUndefined();
  });
});
