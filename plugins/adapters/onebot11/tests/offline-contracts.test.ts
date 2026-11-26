import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot11WssEndpoint } from '../src/wss-endpoint.js';
import { resolveOneBot11Config, type OneBot11WsConfig, type OneBot11WssConfig } from '../src/protocol.js';
import type { OneBot11WsSocket } from '../src/ws-types.js';

const feature = featureId('zhin.adapter');

function socket() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    readyState: 1,
    send: vi.fn<(data: string) => void>(),
    close: vi.fn(),
    ping: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  } satisfies OneBot11WsSocket & { emit(event: string, ...args: unknown[]): void };
}

function privateMessage(messageId: number, text: string): string {
  return JSON.stringify({
    post_type: 'message',
    message_type: 'private',
    message_id: messageId,
    user_id: 10001,
    self_id: 20002,
    message: [{ type: 'text', data: { text } }],
  });
}

function textsOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('content' in payload)) return '';
  return String(payload.content);
}

async function forwardAccount(label: string, ws: ReturnType<typeof socket>) {
  const received: string[] = [];
  const config = resolveOneBot11Config({
    connection: 'ws',
    id: label,
    url: 'ws://127.0.0.1:6700',
    access_token: `token-${label}`,
    reconnect_interval: 60_000,
    heartbeat_interval: 60_000,
  }) as OneBot11WsConfig;
  const harness = await createEndpointHarness(() => new OneBot11WsEndpoint({
    id: capabilityId(rootPluginId(), feature, `onebot11-${label}`),
    config,
    createWebSocket: () => {
      queueMicrotask(() => ws.emit('open'));
      return ws;
    },
  }), {
    name: `onebot11-${label}`,
    capabilities: ['inbound', 'outbound'],
    operations: ['recall'],
    gateway: createTestEventGateway({ receive: (payload) => { received.push(textsOf(payload)); } }),
  });
  return { harness, received, ws };
}

describe('onebot11 offline account isolation', () => {
  const sockets: WebSocket[] = [];
  const hosts: Array<ReturnType<typeof createHttpHost>> = [];

  afterEach(async () => {
    for (const client of sockets.splice(0)) client.terminate();
    await Promise.all(hosts.splice(0).map(host => host.close()));
  });

  it('keeps two forward accounts from crossing inbound messages or replies', async () => {
    const left = await forwardAccount('left', socket());
    const right = await forwardAccount('right', socket());
    try {
      await Promise.all([left.harness.start(), right.harness.start()]);
      left.harness.open();
      right.harness.open();
      left.ws.emit('message', privateMessage(7, 'from-left'));
      await vi.waitFor(() => expect(left.received).toEqual(['from-left']));
      expect(right.received).toEqual([]);
      right.ws.emit('message', privateMessage(7, 'from-right'));
      await vi.waitFor(() => expect(right.received).toEqual(['from-right']));
      expect(left.received).toEqual(['from-left']);

      const reply = left.harness.send({
        conversation: { endpoint: { adapter: 'onebot11', id: left.harness.canonicalId }, kind: 'private', id: '10001' },
        payload: 'reply-left',
      });
      await vi.waitFor(() => expect(left.ws.send).toHaveBeenCalled());
      expect(right.ws.send).not.toHaveBeenCalled();
      const frame = JSON.parse(left.ws.send.mock.calls.at(-1)![0]) as { echo: string; action: string; params: unknown };
      expect(frame).toMatchObject({
        action: 'send_private_msg',
        params: { user_id: 10001, message: [{ type: 'text', data: { text: 'reply-left' } }] },
      });
      right.ws.emit('message', JSON.stringify({ echo: frame.echo, status: 'ok', retcode: 0, data: { message_id: 99 } }));
      left.ws.emit('message', JSON.stringify({ echo: frame.echo, status: 'ok', retcode: 0, data: { message_id: 50 } }));
      await expect(reply).resolves.toBe('50');
      expect(right.ws.send).not.toHaveBeenCalled();
    } finally {
      await Promise.all([left.harness.stop(), right.harness.stop()]);
    }
  });

  it('keeps two reverse accounts on one host from crossing inbound messages or replies', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const received = { left: [] as string[], right: [] as string[] };
    async function account(label: 'left' | 'right', path: string) {
      const config = resolveOneBot11Config({
        connection: 'wss',
        id: label,
        path,
        access_token: `token-${label}`,
        heartbeat_interval: 60_000,
      }) as OneBot11WssConfig;
      return createEndpointHarness(() => new OneBot11WssEndpoint({
        id: capabilityId(rootPluginId(), feature, `onebot11-${label}`),
        http,
        config,
      }), {
        name: `onebot11-${label}`,
        capabilities: ['inbound', 'outbound'],
        operations: ['recall'],
        gateway: createTestEventGateway({ receive: (payload) => { received[label].push(textsOf(payload)); } }),
      });
    }
    const left = await account('left', '/ob11/left');
    const right = await account('right', '/ob11/right');
    const actions = { left: [] as Array<{ action?: string; echo?: string }>, right: [] as Array<{ action?: string; echo?: string }> };
    try {
      await Promise.all([left.start(), right.start()]);
      left.open();
      right.open();
      const { port } = await http.listen();
      const connect = (path: string, token: string, bucket: Array<{ action?: string; echo?: string }>) => new Promise<WebSocket>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        sockets.push(client);
        client.on('message', (raw) => {
          const request = JSON.parse(String(raw)) as { action?: string; echo?: string };
          bucket.push(request);
          if (request.action === 'send_private_msg' && request.echo) {
            client.send(JSON.stringify({ status: 'ok', retcode: 0, echo: request.echo, data: { message_id: 50 } }));
          }
        });
        client.once('open', () => resolve(client));
        client.once('error', reject);
      });
      const leftSocket = await connect('/ob11/left', 'token-left', actions.left);
      const rightSocket = await connect('/ob11/right', 'token-right', actions.right);
      await vi.waitFor(() => expect(left.index.describe()[0]?.transportState).toBe('open'));
      await vi.waitFor(() => expect(right.index.describe()[0]?.transportState).toBe('open'));
      const wrong = new WebSocket(`ws://127.0.0.1:${port}/ob11/left`, { headers: { Authorization: 'Bearer token-right' } });
      sockets.push(wrong);
      await new Promise<void>((resolve, reject) => {
        wrong.once('close', () => resolve());
        wrong.once('error', () => undefined);
        setTimeout(() => reject(new Error('wrong-token reverse socket stayed open')), 1000);
      });

      leftSocket.send(privateMessage(7, 'from-left'));
      await vi.waitFor(() => expect(received.left).toEqual(['from-left']));
      expect(received.right).toEqual([]);
      rightSocket.send(privateMessage(7, 'from-right'));
      await vi.waitFor(() => expect(received.right).toEqual(['from-right']));
      expect(received.left).toEqual(['from-left']);

      const reply = left.send({
        conversation: { endpoint: { adapter: 'onebot11', id: left.canonicalId }, kind: 'private', id: '10001' },
        payload: 'reply-left',
      });
      await vi.waitFor(() => expect(actions.left.some(action => action.action === 'send_private_msg')).toBe(true));
      expect(actions.right.filter(action => action.action === 'send_private_msg')).toEqual([]);
      const frame = actions.left.find(action => action.action === 'send_private_msg');
      expect(frame).toBeDefined();
      await expect(reply).resolves.toBe('50');
    } finally {
      await Promise.all([left.stop(), right.stop()]);
    }
  });
});
