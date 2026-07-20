import { describe, expect, it, vi, afterEach } from 'vitest';
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
      target: 'ch-1',
      content: '你好',
      sender: 'alice',
      id: 'ch-1:msg-1',
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
      target: 'ch-1',
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
      target: 'channel-a',
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
      target: 'ch-9',
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
      target: 'ch-1',
      content: 'from-webhook',
      sender: 'alice',
      id: 'ch-1:msg-1',
    }));

    const messageId = await endpoint.send({ target: 'ch-9', payload: 'pong' });
    expect(messageId).toBe('ch-9:out-1');

    await endpoint.stop();
  });
});
