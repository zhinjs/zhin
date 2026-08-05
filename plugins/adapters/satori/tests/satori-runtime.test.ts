import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEndpointRuntimeState, listEndpointManagementCapabilities } from '@zhin.js/adapter';
import { satoriRuntimeStateToken } from '../src/satori-runtime-state.js';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineSatoriAdapter from '../adapters/satori.js';
import {
  SatoriWebhookEndpoint,
  SatoriWsEndpoint,
  type CreateSatoriWebSocket,
  type SatoriWsSocket,
} from '../src/endpoint.js';
import {
  SatoriOpcode,
  buildWsUrl,
  formatInboundContent,
  formatSatoriOutbound,
  isMessageEvent,
  resolveSatoriConfig,
  type SatoriEventBody,
} from '../src/protocol.js';
import { verifySatoriToken } from '../src/webhook.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const baseConfig = resolveSatoriConfig({
  name: 'test-satori',
  connection: 'ws',
  baseUrl: 'http://127.0.0.1:5140',
  token: 'secret',
  heartbeat_interval: 60_000,
});

function createMockSocket(): SatoriWsSocket & {
  emit(event: 'open' | 'message' | 'close' | 'error', ...args: unknown[]): void;
  sent: string[];
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: string[] = [];
  return {
    readyState: 1,
    sent,
    send(data: string) {
      sent.push(data);
    },
    close() {
      /* noop */
    },
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
}

function createWsFactory(socket: ReturnType<typeof createMockSocket>): CreateSatoriWebSocket {
  return () => {
    queueMicrotask(() => socket.emit('open'));
    return socket;
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(hosts.splice(0).map((host) => host.close().catch(() => undefined)));
});

describe('satori protocol helpers', () => {
  it('resolves ws config from plugin config', () => {
    const resolved = resolveSatoriConfig({
      name: 'bot',
      baseUrl: 'http://sdk.local',
      token: 't',
    });
    expect(resolved).toMatchObject({
      context: 'satori',
      connection: 'ws',
      name: 'bot',
      baseUrl: 'http://sdk.local',
      token: 't',
      heartbeat_interval: 10_000,
    });
  });

  it('resolves webhook config from plugin config', () => {
    const resolved = resolveSatoriConfig({
      connection: 'webhook',
      baseUrl: 'http://sdk.local',
      path: '/satori/webhook',
      token: 't',
    });
    expect(resolved).toMatchObject({
      connection: 'webhook',
      baseUrl: 'http://sdk.local',
      path: '/satori/webhook',
      token: 't',
    });
  });

  it('builds ws url with access_token', () => {
    expect(buildWsUrl('http://127.0.0.1:5140/', 'tok')).toContain('access_token=tok');
  });

  it('detects message events', () => {
    expect(isMessageEvent({
      type: 'message-created',
      message: { id: 'm1', content: 'hi' },
    })).toBe(true);
    expect(isMessageEvent({ type: 'guild-added' })).toBe(false);
  });

  it('formats inbound content', () => {
    expect(formatInboundContent({
      type: 'message-created',
      message: { id: '1', content: 'hello' },
    })).toBe('hello');
  });

  it('formats outbound string and segments', () => {
    expect(formatSatoriOutbound('pong')).toBe('pong');
    expect(formatSatoriOutbound([
      { type: 'text', data: { text: 'hi ' } },
      { type: 'mention', data: { name: 'Bot' } },
    ])).toBe('hi @Bot');
  });

  it('formats outbound media segments from canonical data.media', () => {
    expect(formatSatoriOutbound([
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } },
    ])).toBe('[image:https://example.com/a.png]');
    expect(formatSatoriOutbound([
      { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/a.mp3' } } },
      { type: 'file', data: { media: { kind: 'base64', value: 'aGk=', mime_type: 'text/plain' } } },
    ])).toBe('[audio:https://example.com/a.mp3][file:base64://aGk=]');
    // 已带 base64:// 前缀的值不重复加前缀
    expect(formatSatoriOutbound([
      { type: 'video', data: { media: { kind: 'base64', value: 'base64://aGk=' } } },
    ])).toBe('[video:base64://aGk=]');
  });

  it('drops outbound media segments without a deliverable canonical media ref', () => {
    expect(formatSatoriOutbound([
      { type: 'text', data: { text: 'a' } },
      { type: 'image', data: {} },
      { type: 'video', data: { media: { kind: 'path', value: '/tmp/a.mp4' } } },
      { type: 'file', data: { media: { kind: 'file', value: 'opaque-id' } } },
    ])).toBe('a');
  });
});

describe('satori plugin runtime adapter', () => {
  it('routes admitted events through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const socket = createMockSocket();
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway,
      config: baseConfig,
      createWebSocket: createWsFactory(socket),
    });

    await endpoint.start();
    endpoint.open();

    const body: SatoriEventBody = {
      type: 'message-created',
      message: { id: 'msg-1', content: '你好' },
      channel: { id: 'ch-1', type: 0 },
      user: { id: 'u-1', name: 'alice' },
    };
    endpoint.admit(body);

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'group', id: 'ch-1' }),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: '你好',
      sender: 'alice',
    }));

    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const socket = createMockSocket();
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway,
      config: baseConfig,
      createWebSocket: createWsFactory(socket),
    });
    await endpoint.start();
    endpoint.admit({
      type: 'message-created',
      message: { id: '1', content: 'nope' },
      channel: { id: 'ch' },
      user: { id: 'u' },
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('marks metadata.mentioned when an at element targets the login selfId', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const socket = createMockSocket();
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway,
      config: baseConfig,
      createWebSocket: createWsFactory(socket),
    });
    await endpoint.start();
    endpoint.open();
    endpoint.setLogin({ platform: 'test', user: { id: 'bot-1' } });

    endpoint.admit({
      type: 'message-created',
      message: { id: 'm-at', content: '<at id="bot-1"/> 在吗' },
      channel: { id: 'ch-1', type: 0 },
      user: { id: 'u-1', name: 'alice' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'group', id: 'ch-1' }),
      content: '<at id="bot-1"/> 在吗',
      metadata: expect.objectContaining({ mentioned: true }),
    }));
    await endpoint.stop();
  });

  it('does not mark metadata.mentioned when the at element targets someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const socket = createMockSocket();
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway,
      config: baseConfig,
      createWebSocket: createWsFactory(socket),
    });
    await endpoint.start();
    endpoint.open();
    endpoint.setLogin({ platform: 'test', user: { id: 'bot-1' } });

    endpoint.admit({
      type: 'message-created',
      message: { id: 'm-other', content: '<at id="user-2"/> 在吗' },
      channel: { id: 'ch-1', type: 0 },
      user: { id: 'u-1', name: 'alice' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(metadata?.mentioned).toBeUndefined();
    await endpoint.stop();
  });

  it('sends IDENTIFY on ws open', async () => {
    const socket = createMockSocket();
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createWebSocket: createWsFactory(socket),
    });
    await endpoint.start();
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
    const identify = JSON.parse(socket.sent[0]!) as { op: number; body: { token?: string } };
    expect(identify.op).toBe(SatoriOpcode.IDENTIFY);
    expect(identify.body.token).toBe('secret');
    await endpoint.stop();
  });

  it('admits EVENT signals from the websocket', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const socket = createMockSocket();
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: createWsFactory(socket),
    });
    await endpoint.start();
    endpoint.open();
    socket.emit('message', JSON.stringify({
      op: SatoriOpcode.EVENT,
      body: {
        type: 'message-created',
        sn: 3,
        message: { id: 'm2', content: 'from-ws' },
        channel: { id: 'channel-a', type: 1 },
        user: { id: 'user-a' },
      },
    }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'private', id: 'channel-a' }),
      content: 'from-ws',
      metadata: expect.objectContaining({ channelType: 'private' }),
    }));
    await endpoint.stop();
  });

  it('sends outbound payloads via Satori API', async () => {
    const callApi = vi.fn(async () => [{ id: 'out-1' }]);
    const socket = createMockSocket();
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createWebSocket: createWsFactory(socket),
      callApi,
    });
    await endpoint.start();
    endpoint.open();
    endpoint.setLogin({ platform: 'test', user: { id: 'bot-1' } });
    const messageId = await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'ch-9',
      },
      payload: 'pong',
    });
    expect(messageId).toBe('ch-9:out-1');
    expect(callApi).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'test', userId: 'bot-1' }),
      'message',
      'create',
      { channel_id: 'ch-9', content: 'pong' },
    );
    await endpoint.stop();
  });

  it('creates webhook endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = defineSatoriAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      name: 'satori',
      config: {
        connection: 'webhook',
        baseUrl: 'http://127.0.0.1:5140',
        path: '/satori/webhook',
        token: 'secret',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === satoriRuntimeStateToken) return createEndpointRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(SatoriWebhookEndpoint);
  });

  it('handles webhook EVENT and routes messages through MessageGateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new SatoriWebhookEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway,
      http,
      config: resolveSatoriConfig({
        connection: 'webhook',
        name: 'hook',
        baseUrl: 'http://127.0.0.1:5140',
        path: '/satori/webhook',
        token: 'secret',
      }) as ReturnType<typeof resolveSatoriConfig> & { connection: 'webhook' },
      callApi: vi.fn(async () => [{ id: 'out-1' }]),
    });

    await endpoint.start();
    const { port } = await http.listen();
    endpoint.open();

    const res = await globalThis.fetch(`http://127.0.0.1:${port}/satori/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
        'Satori-Opcode': String(SatoriOpcode.EVENT),
      },
      body: JSON.stringify({
        type: 'message-created',
        message: { id: 'msg-1', content: 'from-webhook' },
        channel: { id: 'ch-1', type: 0 },
        user: { id: 'u-1', name: 'alice' },
        login: { platform: 'test', user: { id: 'bot-1' } },
      }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'group', id: 'ch-1' }),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: 'from-webhook',
      sender: 'alice',
    }));

    const messageId = await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'ch-9',
      },
      payload: 'pong',
    });
    expect(messageId).toBe('ch-9:out-1');

    await endpoint.stop();
  });
});

describe('satori webhook auth', () => {
  it('verifySatoriToken compares constant-time and tolerates length mismatch', () => {
    const req = (auth?: string) => ({
      headers: auth === undefined ? {} : { authorization: auth },
    }) as never;
    expect(verifySatoriToken(undefined, req())).toBe(true);
    expect(verifySatoriToken('secret', req('Bearer secret'))).toBe(true);
    expect(verifySatoriToken('secret', req('Bearer wrong!'))).toBe(false);
    // 长度不一致不能抛异常（timingSafeEqual 等长前置检查）
    expect(verifySatoriToken('secret', req('Bearer secret-longer'))).toBe(false);
    expect(verifySatoriToken('secret', req())).toBe(false);
  });
});

describe('satori ws heartbeat', () => {
  it('settles start() silently when stop() races the initial connect', async () => {
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createWebSocket: () => createMockSocket(), // 永不 open，模拟连接挂起
    });

    const startPromise = endpoint.start();
    await endpoint.stop();
    // stop-during-connect 视为主动停止：start() 静默 resolve，不拒绝、不武装重连
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('closes the socket after two heartbeat rounds without PONG', async () => {
    vi.useFakeTimers();
    const socket = createMockSocket();
    const closeSpy = vi.fn(() => socket.emit('close', 1000, 'heartbeat timeout'));
    socket.close = closeSpy;
    const endpoint = new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: resolveSatoriConfig({
        name: 'test-satori',
        connection: 'ws',
        baseUrl: 'http://127.0.0.1:5140',
        token: 'secret',
        heartbeat_interval: 1_000,
      }),
      createWebSocket: createWsFactory(socket),
    });
    await endpoint.start();

    // 第 1 轮：发出 PING，未超时
    await vi.advanceTimersByTimeAsync(1_000);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(socket.sent.some((raw) => (JSON.parse(raw) as { op: number }).op === SatoriOpcode.PING))
      .toBe(true);

    // PONG 回包重置计数
    socket.emit('message', JSON.stringify({ op: SatoriOpcode.PONG, body: {} }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(closeSpy).not.toHaveBeenCalled();

    // 连续两轮无回包 → 下一轮心跳主动 close 触发重连
    await vi.advanceTimersByTimeAsync(1_000);
    expect(closeSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    await endpoint.stop();
  });
});


describe('satori.endpoint management', () => {
  function createManagementCallApi() {
    return vi.fn(async (
      _options: unknown,
      resource: string,
      method: string,
      params: Record<string, unknown>,
    ): Promise<unknown> => {
      if (resource === 'guild' && method === 'list') {
        if (params.next === 'p2') return { data: [{ id: 'guild-2' }] };
        return { data: [{ id: '1234567890123456789', name: 'Guild' }], next: 'p2' };
      }
      if (resource === 'channel' && method === 'list') {
        if (params.guild_id === 'guild-2') return { data: [] };
        return {
          data: [
            { id: 'ch-text', name: 'general', type: 0 },
            { id: 'ch-voice', name: 'Voice', type: 3 },
            { id: 'ch-cat', name: 'Category', type: 2 },
          ],
        };
      }
      if (resource === 'guild-member' && method === 'list') {
        return {
          data: [
            { user: { id: 'user-1', name: 'alice' }, nick: 'Alice', roles: ['role-1'] },
          ],
        };
      }
      throw new Error(`unexpected api call: ${resource}.${method}`);
    });
  }

  function createManagementEndpoint(callApi: ReturnType<typeof createManagementCallApi>) {
    return new SatoriWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      callApi,
    });
  }

  it('advertises only implemented management capabilities', () => {
    const endpoint = createManagementEndpoint(createManagementCallApi());
    expect(listEndpointManagementCapabilities(endpoint)).toEqual([
      'listGroups',
      'listChannels',
      'listGroupMembers',
    ]);
  });

  it('lists guilds across pages without losing id precision', async () => {
    const callApi = createManagementCallApi();
    const endpoint = createManagementEndpoint(callApi);
    // id 超 Number.MAX_SAFE_INTEGER，保留原始字符串
    await expect(endpoint.management.listGroups?.()).resolves.toEqual([
      { group_id: '1234567890123456789', name: 'Guild' },
      { group_id: 'guild-2', name: 'guild-2' },
    ]);
    expect(callApi).toHaveBeenCalledWith(
      expect.anything(), 'guild', 'list', { next: 'p2' },
    );
  });

  it('lists only text channels with guild parent', async () => {
    const endpoint = createManagementEndpoint(createManagementCallApi());
    await expect(endpoint.management.listChannels?.()).resolves.toEqual([
      {
        id: 'ch-text',
        name: 'general',
        parent: { type: 'guild', id: '1234567890123456789', name: 'Guild' },
      },
    ]);
  });

  it('lists guild members in platform shape', async () => {
    const callApi = createManagementCallApi();
    const endpoint = createManagementEndpoint(callApi);
    await expect(endpoint.management.listGroupMembers?.('guild-1')).resolves.toEqual([
      { user: { id: 'user-1', name: 'alice' }, nick: 'Alice', roles: ['role-1'] },
    ]);
    expect(callApi).toHaveBeenCalledWith(
      expect.anything(), 'guild-member', 'list', { guild_id: 'guild-1' },
    );
  });

  it('exposes management on the webhook endpoint too', () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new SatoriWebhookEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'satori'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      http,
      config: resolveSatoriConfig({
        connection: 'webhook',
        name: 'hook',
        baseUrl: 'http://127.0.0.1:5140',
        path: '/satori/webhook',
        token: 'secret',
      }) as ReturnType<typeof resolveSatoriConfig> & { connection: 'webhook' },
      callApi: createManagementCallApi(),
    });
    expect(listEndpointManagementCapabilities(endpoint)).toEqual([
      'listGroups',
      'listChannels',
      'listGroupMembers',
    ]);
  });
});
