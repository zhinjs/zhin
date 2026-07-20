import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineNapCatAdapter from '../adapters/napcat.js';
import {
  NapCatHttpEndpoint,
  NapCatWssEndpoint,
  NapCatWsEndpoint,
  type NapCatWsSocket,
} from '../src/index.js';
import {
  buildSendAction,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  parseSendTarget,
  resolveNapCatConfig,
  type NapCatEvent,
  type NapCatWsConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const baseConfig: NapCatWsConfig = resolveNapCatConfig({
  connection: 'ws',
  name: 'test-napcat',
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

  it('resolves http mode from legacy endpoints', () => {
    const resolved = resolveNapCatConfig({
      endpoints: [{
        context: 'napcat',
        connection: 'http',
        name: 'http-bot',
        http_url: 'http://127.0.0.1:3000',
        post_path: '/napcat/post',
      }],
    });
    expect(resolved).toMatchObject({
      connection: 'http',
      name: 'http-bot',
      http_url: 'http://127.0.0.1:3000',
      post_path: '/napcat/post',
    });
  });

  it('formats inbound target and content', () => {
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
      target: 'private:10001',
      content: '你好',
      sender: 'Alice',
      id: '42',
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
      target: 'group:200',
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
      config: { connection: 'wss', name: 'rev', path: '/napcat/ws' },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
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
        name: 'http-bot',
        http_url: 'http://127.0.0.1:3000',
        post_path: '/napcat/post',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
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
        name: 'http-bot',
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
      target: 'private:10001',
      content: 'from-http',
      id: '42',
    }));

    await endpoint.send({ target: 'private:10001', payload: 'pong' });
    expect(callHttpAction).toHaveBeenCalledWith(
      expect.objectContaining({ http_url: 'http://127.0.0.1:3000' }),
      'send_private_msg',
      expect.objectContaining({ user_id: 10001 }),
    );

    await endpoint.stop();
  });
});
