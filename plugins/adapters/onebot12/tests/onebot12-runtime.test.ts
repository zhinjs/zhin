import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineOneBot12Adapter from '../adapters/onebot12.js';
import { OneBot12WebhookEndpoint } from '../src/webhook.js';
import { OneBot12WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot12WssEndpoint } from '../src/wss-endpoint.js';
import type { OneBot12WsSocket } from '../src/ws-types.js';
import {
  buildSendMessageParams,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  parseSendTarget,
  resolveOneBot12Config,
  type OneBot12Event,
  type OneBot12WsConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const baseConfig: OneBot12WsConfig = resolveOneBot12Config({
  connection: 'ws',
  name: 'test-ob12',
  url: 'ws://127.0.0.1:6700',
  access_token: 'secret',
  reconnect_interval: 50,
  heartbeat_interval: 60_000,
}) as OneBot12WsConfig;

function createMockWs(): OneBot12WsSocket & {
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

describe('onebot12 protocol helpers', () => {
  it('resolves ws config from plugin config', () => {
    const resolved = resolveOneBot12Config({
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

  it('formats inbound target and content', () => {
    const ev: OneBot12Event = {
      id: 'e1',
      time: 1,
      type: 'message',
      detail_type: 'group',
      sub_type: '',
      message_id: 'm1',
      group_id: '100',
      user_id: 'u1',
      alt_message: 'hello',
      message: [{ type: 'text', data: { text: 'hello' } }],
    };
    expect(formatInboundTarget(ev)).toBe('group:100');
    expect(formatInboundContent(ev)).toBe('hello');
  });

  it('parses send targets including channel with guild', () => {
    expect(parseSendTarget('private:42')).toEqual({ detail_type: 'private', id: '42' });
    expect(parseSendTarget('group:9')).toEqual({ detail_type: 'group', id: '9' });
    expect(parseSendTarget('channel:g1:c1')).toEqual({
      detail_type: 'channel',
      guild_id: 'g1',
      id: 'c1',
    });
  });

  it('builds send_message params from target', () => {
    expect(buildSendMessageParams('private:1', [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      message: [{ type: 'text', data: { text: 'hi' } }],
      detail_type: 'private',
      user_id: '1',
    });
    expect(buildSendMessageParams('group:2', [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      message: [{ type: 'text', data: { text: 'hi' } }],
      detail_type: 'group',
      group_id: '2',
    });
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundSegments('pong')).toEqual([{ type: 'text', data: { text: 'pong' } }]);
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { url: 'https://x/a.png' } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { url: 'https://x/a.png' } },
    ]);
  });
});

describe('onebot12 plugin runtime adapter', () => {
  it('routes admitted message events through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const ws = createMockWs();
    const endpoint = new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
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
      id: 'e1',
      time: 1_700_000_000,
      type: 'message',
      detail_type: 'private',
      sub_type: '',
      message_id: 'msg-1',
      user_id: '10001',
      alt_message: '你好',
      message: [{ type: 'text', data: { text: '你好' } }],
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'private:10001',
      content: '你好',
      sender: '10001',
      id: 'msg-1',
    }));

    await endpoint.stop();
    expect(ws.close).toHaveBeenCalled();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    });
    await endpoint.start();
    endpoint.admit({
      id: 'e1',
      time: 1,
      type: 'message',
      detail_type: 'private',
      sub_type: '',
      message_id: 'm',
      user_id: '1',
      alt_message: 'nope',
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via WS send_message action', async () => {
    const ws = createMockWs();
    const endpoint = new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
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
    expect(req.action).toBe('send_message');
    expect(req.params).toMatchObject({
      detail_type: 'private',
      user_id: '10001',
      message: [{ type: 'text', data: { text: 'pong' } }],
    });

    ws.emitMessage(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: { message_id: 'out-1' },
      message: '',
      echo: req.echo,
    }));

    await expect(sendPromise).resolves.toBe('out-1');
    await endpoint.stop();
  });

  it('admits inbound events received over the socket when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
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
      id: 'e2',
      time: 2,
      type: 'message',
      detail_type: 'group',
      sub_type: '',
      message_id: 'gm-1',
      group_id: '200',
      user_id: '9',
      alt_message: 'from-ws',
      message: [{ type: 'text', data: { text: 'from-ws' } }],
    }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'group:200',
      content: 'from-ws',
    }));
    await endpoint.stop();
  });

  it('creates webhook endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const endpoint = defineOneBot12Adapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      name: 'onebot12',
      config: {
        connection: 'webhook',
        name: 'hook',
        path: '/onebot12/webhook',
        api_url: 'http://127.0.0.1:6700',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) return gateway;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(OneBot12WebhookEndpoint);
  });

  it('creates reverse-wss endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = defineOneBot12Adapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      name: 'onebot12',
      config: { connection: 'wss', name: 'rev', path: '/onebot12/ws' },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(OneBot12WssEndpoint);
  });

  it('handles webhook POST and routes events through MessageGateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const callAction = vi.fn(async () => ({
      status: 'ok' as const,
      retcode: 0,
      data: { message_id: 'out-1' },
      message: '',
    }));
    const endpoint = new OneBot12WebhookEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway,
      http,
      config: resolveOneBot12Config({
        connection: 'webhook',
        name: 'hook',
        path: '/onebot12/webhook',
        api_url: 'http://127.0.0.1:6700',
      }) as ReturnType<typeof resolveOneBot12Config> & { connection: 'webhook' },
      callAction,
    });

    await endpoint.start();
    const { port } = await http.listen();
    endpoint.open();

    const res = await globalThis.fetch(`http://127.0.0.1:${port}/onebot12/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'e1',
        time: 1,
        type: 'message',
        detail_type: 'private',
        sub_type: '',
        message_id: 'msg-1',
        user_id: '10001',
        alt_message: 'from-webhook',
      }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'private:10001',
      content: 'from-webhook',
      id: 'msg-1',
    }));

    await endpoint.send({ target: 'private:10001', payload: 'pong' });
    expect(callAction).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://127.0.0.1:6700' }),
      'send_message',
      expect.objectContaining({ detail_type: 'private', user_id: '10001' }),
    );

    await endpoint.stop();
  });
});
