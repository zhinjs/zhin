import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import type { EndpointEvent } from 'zhin.js/adapter';
import { wsConnectionFromMock } from '../../test-utils/http.js';
import { createEndpointHarness, createTestEndpointEventGateway, createTestEventGateway } from '../../test-utils/endpoint.js';
import { NapCatHttpEndpoint } from '../src/http-endpoint.js';
import { NapCatWsEndpoint } from '../src/ws-endpoint.js';
import { NapCatWssEndpoint } from '../src/wss-endpoint.js';
import {
  resolveNapCatConfig,
  type NapCatHttpConfig,
  type NapCatWsConfig,
  type NapCatWssConfig,
} from '../src/protocol.js';
import type { NapCatWsSocket } from '../src/ws-types.js';

const feature = featureId('zhin.adapter');
const endpointId = (label: string) => capabilityId(rootPluginId(), feature, `napcat-${label}`);

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
  } satisfies NapCatWsSocket & { emit(event: string, ...args: unknown[]): void };
}

function privateMessage(messageId: number, text: string) {
  return {
    post_type: 'message' as const,
    message_type: 'private' as const,
    message_id: messageId,
    user_id: 10001,
    self_id: 9001,
    raw_message: text,
    message: [{ type: 'text', data: { text } }],
  };
}

function textsOf(payload: unknown): { id: string; content: string } {
  if (!payload || typeof payload !== 'object') return { id: '', content: '' };
  const message = 'message' in payload && payload.message && typeof payload.message === 'object'
    ? payload.message as { id?: unknown }
    : undefined;
  const content = 'content' in payload ? payload.content : '';
  return { id: message?.id == null ? '' : String(message.id), content: String(content ?? '') };
}

describe('napcat forward WebSocket admission', () => {
  const incoming = privateMessage(7, 'first');

  function candidate() {
    const ws = socket();
    const received: EndpointEvent[] = [];
    return createEndpointHarness(() => new NapCatWsEndpoint({
      id: endpointId('candidate'),
      config: resolveNapCatConfig({
        connection: 'ws',
        id: 'candidate',
        url: 'ws://127.0.0.1:3001',
        access_token: 'secret',
        reconnect_interval: 60_000,
        heartbeat_interval: 60_000,
      }) as NapCatWsConfig,
      createWebSocket: () => {
        queueMicrotask(() => {
          ws.emit('open');
          ws.emit('message', JSON.stringify(incoming));
        });
        return ws;
      },
    }), {
      name: 'napcat-candidate',
      id: 'candidate',
      capabilities: ['inbound', 'outbound'],
      operations: ['recall'],
      gateway: createTestEndpointEventGateway({ async receive(event) { received.push(event); } }),
    }).then(harness => ({ ...harness, ws, received }));
  }

  it('keeps transport open separate from generation admission and publishes the candidate frame once', async () => {
    const f = await candidate();
    try {
      await f.start();
      expect(f.index.describe()[0]).toMatchObject({ admitted: false, transportState: 'open' });
      expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(0);
      f.open();
      expect(f.index.describe()[0]?.admitted).toBe(true);
      await vi.waitFor(() => expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(1));
      f.ws.emit('message', JSON.stringify(incoming));
      f.ws.emit('message', JSON.stringify(privateMessage(8, 'second')));
      await vi.waitFor(() => expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(2));
      expect(f.received.filter(event => event.name === 'message.receive').map(event => textsOf(event.payload))).toEqual([
        { id: '7', content: 'first' },
        { id: '8', content: 'second' },
      ]);
      expect(f.ws.send).not.toHaveBeenCalled();
    } finally {
      await f.stop();
    }
  });

  it('discards a candidate frame when the generation rolls back before admission', async () => {
    const f = await candidate();
    try {
      await f.start();
      await f.stop();
      f.endpoint.ingest(privateMessage(9, 'late'));
      await Promise.resolve();
      expect(f.received).toHaveLength(0);
      expect(f.ws.send).not.toHaveBeenCalled();
      expect(f.index.describe()[0]?.transportState).toBe('stopped');
    } finally {
      await f.stop();
    }
  });
});

describe('napcat account isolation', () => {
  const clients: WebSocket[] = [];
  const hosts: Array<ReturnType<typeof createHttpHost>> = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    await Promise.all(hosts.splice(0).map(host => host.close()));
  });

  it('keeps two forward accounts from crossing inbound messages or replies', async () => {
    async function account(label: string) {
      const ws = socket();
      const received: Array<{ id: string; content: string }> = [];
      const harness = await createEndpointHarness(() => new NapCatWsEndpoint({
        id: endpointId(label),
        config: resolveNapCatConfig({
          connection: 'ws',
          id: label,
          url: 'ws://127.0.0.1:3001',
          access_token: `token-${label}`,
          reconnect_interval: 60_000,
          heartbeat_interval: 60_000,
        }) as NapCatWsConfig,
        createWebSocket: () => {
          queueMicrotask(() => ws.emit('open'));
          return ws;
        },
      }), {
        name: `napcat-${label}`,
        capabilities: ['inbound', 'outbound'],
        operations: ['recall'],
        gateway: createTestEventGateway({ receive: (payload) => { received.push(textsOf(payload)); } }),
      });
      return { harness, received, ws };
    }
    const left = await account('left');
    const right = await account('right');
    try {
      await Promise.all([left.harness.start(), right.harness.start()]);
      left.harness.open();
      right.harness.open();
      left.ws.emit('message', JSON.stringify(privateMessage(7, 'from-left')));
      await vi.waitFor(() => expect(left.received).toEqual([{ id: '7', content: 'from-left' }]));
      expect(right.received).toEqual([]);
      right.ws.emit('message', JSON.stringify(privateMessage(7, 'from-right')));
      await vi.waitFor(() => expect(right.received).toEqual([{ id: '7', content: 'from-right' }]));
      expect(left.received).toEqual([{ id: '7', content: 'from-left' }]);

      const reply = left.harness.send({
        conversation: { endpoint: { adapter: 'napcat', id: left.harness.canonicalId }, kind: 'private', id: '10001' },
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
    } finally {
      await Promise.all([left.harness.stop(), right.harness.stop()]);
    }
  });

  it('rejects inbound from a replaced reverse socket and dedupes the current one', async () => {
    let accept!: (connection: unknown) => void;
    const http = { ws: () => ({ onConnection(fn: typeof accept) { accept = fn; return vi.fn(); } }) };
    const received: Array<{ id: string; content: string }> = [];
    const harness = await createEndpointHarness(() => new NapCatWssEndpoint({
      id: endpointId('replaced'),
      http: http as never,
      config: resolveNapCatConfig({
        connection: 'wss', id: 'replaced', path: '/napcat', access_token: 'secret', heartbeat_interval: 60_000,
      }) as NapCatWssConfig,
    }), {
      name: 'napcat-replaced',
      capabilities: ['inbound', 'outbound'],
      operations: ['recall'],
      gateway: createTestEventGateway({ receive: (payload) => { received.push(textsOf(payload)); } }),
    });
    const connect = (ws: ReturnType<typeof socket>) => accept(wsConnectionFromMock({
      socket: ws,
      request: { headers: { authorization: 'Bearer secret' }, url: '/', socket: { remoteAddress: '127.0.0.1' } },
    }));
    const first = socket();
    const second = socket();
    try {
      await harness.start();
      harness.open();
      connect(first);
      await vi.waitFor(() => expect(harness.index.describe()[0]?.transportState).toBe('open'));
      connect(second);
      await vi.waitFor(() => expect(first.close).toHaveBeenCalled());
      const ingest = vi.spyOn(harness.endpoint, 'ingest');
      first.emit('message', JSON.stringify(privateMessage(1, 'retired')));
      expect(ingest).not.toHaveBeenCalled();
      second.emit('message', JSON.stringify(privateMessage(1, 'current')));
      expect(ingest).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(received).toEqual([{ id: '1', content: 'current' }]));
      second.emit('message', JSON.stringify(privateMessage(1, 'current-again')));
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(received).toEqual([{ id: '1', content: 'current' }]);
      expect(harness.index.describe()[0]?.transportState).toBe('open');
    } finally {
      await harness.stop();
    }
  });

  it('keeps two reverse accounts on one host from crossing inbound messages or replies', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const received = { left: [] as Array<{ id: string; content: string }>, right: [] as Array<{ id: string; content: string }> };
    async function account(label: 'left' | 'right', path: string) {
      return createEndpointHarness(() => new NapCatWssEndpoint({
        id: endpointId(label),
        http,
        config: resolveNapCatConfig({
          connection: 'wss',
          id: label,
          path,
          access_token: `token-${label}`,
          heartbeat_interval: 60_000,
        }) as NapCatWssConfig,
      }), {
        name: `napcat-${label}`,
        capabilities: ['inbound', 'outbound'],
        operations: ['recall'],
        gateway: createTestEventGateway({ receive: (payload) => { received[label].push(textsOf(payload)); } }),
      });
    }
    const left = await account('left', '/napcat/left');
    const right = await account('right', '/napcat/right');
    const actions = { left: [] as Array<{ action?: string; echo?: string }>, right: [] as Array<{ action?: string; echo?: string }> };
    try {
      await Promise.all([left.start(), right.start()]);
      left.open();
      right.open();
      const { port } = await http.listen();
      const connect = (path: string, token: string, bucket: Array<{ action?: string; echo?: string }>) => new Promise<WebSocket>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        clients.push(client);
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
      const leftSocket = await connect('/napcat/left', 'token-left', actions.left);
      const rightSocket = await connect('/napcat/right', 'token-right', actions.right);
      await vi.waitFor(() => expect(left.index.describe()[0]?.transportState).toBe('open'));
      await vi.waitFor(() => expect(right.index.describe()[0]?.transportState).toBe('open'));
      const wrong = new WebSocket(`ws://127.0.0.1:${port}/napcat/right`, { headers: { Authorization: 'Bearer token-left' } });
      clients.push(wrong);
      await new Promise<void>((resolve, reject) => {
        wrong.once('close', () => resolve());
        wrong.once('error', () => undefined);
        setTimeout(() => reject(new Error('wrong-token reverse socket stayed open')), 1000);
      });
      leftSocket.send(JSON.stringify(privateMessage(7, 'from-left')));
      await vi.waitFor(() => expect(received.left).toEqual([{ id: '7', content: 'from-left' }]));
      expect(received.right).toEqual([]);
      rightSocket.send(JSON.stringify(privateMessage(7, 'from-right')));
      await vi.waitFor(() => expect(received.right).toEqual([{ id: '7', content: 'from-right' }]));
      expect(received.left).toEqual([{ id: '7', content: 'from-left' }]);

      const reply = left.send({
        conversation: { endpoint: { adapter: 'napcat', id: left.canonicalId }, kind: 'private', id: '10001' },
        payload: 'reply-left',
      });
      await vi.waitFor(() => expect(actions.left.some(action => action.action === 'send_private_msg')).toBe(true));
      expect(actions.right.filter(action => action.action === 'send_private_msg')).toEqual([]);
      await expect(reply).resolves.toBe('50');
    } finally {
      await Promise.all([left.stop(), right.stop()]);
    }
  });
});

describe('napcat HTTP offline contracts', () => {
  const hosts: Array<ReturnType<typeof createHttpHost>> = [];
  afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())); });

  it('isolates path and token, dedupes inside one generation, and rejects inbound after shutdown', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    async function account(label: string, path: string, token: string) {
      const received: Array<{ id: string; content: string }> = [];
      const config = resolveNapCatConfig({
        connection: 'http',
        id: label,
        http_url: 'http://127.0.0.1:9',
        post_path: path,
        access_token: token,
      });
      if (config.connection !== 'http') throw new Error('Expected an HTTP fixture');
      const harness = await createEndpointHarness(() => new NapCatHttpEndpoint({
        id: endpointId(label),
        http,
        config: config as NapCatHttpConfig,
        callHttpAction: vi.fn(async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } })),
      }), {
        name: `napcat-${label}`,
        capabilities: ['inbound', 'outbound'],
        operations: ['recall'],
        gateway: createTestEventGateway({ receive: (payload) => { received.push(textsOf(payload)); } }),
      });
      return { harness, received };
    }
    const left = await account('http-left', '/napcat/left', 'token-left');
    const right = await account('http-right', '/napcat/right', 'token-right');
    const post = (port: number, path: string, token: string | undefined, messageId: number, text: string) => fetch(
      `http://127.0.0.1:${port}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(privateMessage(messageId, text)),
      },
    );
    try {
      await Promise.all([left.harness.start(), right.harness.start()]);
      const { port } = await http.listen();
      expect(left.harness.index.describe()[0]).toMatchObject({ admitted: false, transportState: 'open' });
      const early = await post(port, '/napcat/left', 'token-left', 1, 'too-early');
      expect(early.status).toBe(200);
      await early.text();
      await new Promise(resolve => setImmediate(resolve));
      expect(left.received).toEqual([]);
      left.harness.open();
      right.harness.open();
      expect(left.harness.index.describe()[0]?.admitted).toBe(true);
      await new Promise(resolve => setImmediate(resolve));
      expect(left.received).toEqual([]);

      const wrongToken = await post(port, '/napcat/left', 'token-right', 2, 'wrong-token');
      expect(wrongToken.status).toBe(403);
      await wrongToken.text();
      const wrongPath = await post(port, '/napcat/right', 'token-left', 3, 'wrong-path');
      expect(wrongPath.status).toBe(403);
      await wrongPath.text();
      const missing = await post(port, '/napcat/missing', 'token-left', 4, 'missing');
      expect(missing.status).toBe(404);
      await missing.text();
      expect(left.received).toEqual([]);
      expect(right.received).toEqual([]);

      const admitted = await post(port, '/napcat/left', 'token-left', 7, 'only-left');
      expect(admitted.status).toBe(200);
      await admitted.text();
      await vi.waitFor(() => expect(left.received).toEqual([{ id: '7', content: 'only-left' }]));
      const duplicate = await post(port, '/napcat/left', 'token-left', 7, 'only-left-again');
      expect(duplicate.status).toBe(200);
      await duplicate.text();
      await new Promise(resolve => setImmediate(resolve));
      expect(left.received).toEqual([{ id: '7', content: 'only-left' }]);
      const query = await fetch(`http://127.0.0.1:${port}/napcat/left?access_token=token-left`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(privateMessage(11, 'query-token')),
      });
      expect(query.status).toBe(200);
      await query.text();
      await vi.waitFor(() => expect(left.received).toEqual([
        { id: '7', content: 'only-left' },
        { id: '11', content: 'query-token' },
      ]));
      const sameId = await post(port, '/napcat/right', 'token-right', 7, 'only-right');
      expect(sameId.status).toBe(200);
      await sameId.text();
      await vi.waitFor(() => expect(right.received).toEqual([{ id: '7', content: 'only-right' }]));
      expect(left.received).toHaveLength(2);

      await left.harness.stop();
      expect(left.harness.index.describe()[0]).toMatchObject({ admitted: false, transportState: 'stopped' });
      const afterStop = await post(port, '/napcat/left', 'token-left', 8, 'after-stop');
      expect(afterStop.status).toBe(404);
      await afterStop.text();
      expect(left.received).toHaveLength(2);
      const stillRight = await post(port, '/napcat/right', 'token-right', 9, 'right-lives');
      expect(stillRight.status).toBe(200);
      await stillRight.text();
      await vi.waitFor(() => expect(right.received).toEqual([
        { id: '7', content: 'only-right' },
        { id: '9', content: 'right-lives' },
      ]));
    } finally {
      await Promise.all([left.harness.stop(), right.harness.stop()]);
    }
  });
});
