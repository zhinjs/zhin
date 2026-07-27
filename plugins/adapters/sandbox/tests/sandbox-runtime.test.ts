import { describe, expect, it, vi, afterEach } from 'vitest';
import WebSocket from 'ws';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { SandboxWsEndpoint } from '../src/endpoint.js';
import {
  formatSandboxOutbound,
  parseSandboxWsPayload,
  resolveSandboxEndpoint,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('sandbox plugin runtime adapter', () => {
  it('routes websocket messages through MessageGateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'pong' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', name: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    });
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      const timer = setTimeout(() => reject(new Error('timeout waiting for gateway.receive')), 3000);
      client.once('open', () => {
        client.send(JSON.stringify({ text: 'hello sandbox' }));
      });
      const interval = setInterval(() => {
        if (receive.mock.calls.length > 0) {
          clearInterval(interval);
          clearTimeout(timer);
          client.close();
          resolve();
        }
      }, 20);
      client.once('error', reject);
    });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'demo-bot',
      content: 'hello sandbox',
      sender: 'sandbox-user',
    }));
  });

  it('sends outbound payloads to the active websocket connection', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', name: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    });
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const payload = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      const timer = setTimeout(() => reject(new Error('timeout waiting for websocket reply')), 3000);
      client.once('open', () => {
        endpoint.send({ target: 'demo-bot', payload: 'pong' });
      });
      client.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as {
          content?: Array<{ type: string; data?: { text?: string } }>;
        };
        const text = parsed.content?.[0]?.data?.text;
        if (text !== 'pong') return;
        clearTimeout(timer);
        client.close();
        resolve(String(data));
      });
      client.once('error', reject);
    });

    expect(JSON.parse(payload).content).toEqual([
      { type: 'text', data: { text: 'pong' } },
    ]);
  });

  it('keeps sandbox payload parsing stable', () => {
    const parsed = parseSandboxWsPayload(JSON.stringify({ text: 'ping' }));
    expect(parsed.text).toBe('ping');
    expect(parsed.type).toBe('private');
  });

  it('prefers top-level name/owner over legacy endpoints[] entries', () => {
    // Runtime expands endpoints[i] onto the top level ({ ...base, ...entry, name }).
    const resolved = resolveSandboxEndpoint({
      name: 'expanded-bot',
      owner: 'expanded-user',
      endpoints: [{ context: 'sandbox', name: 'legacy-bot', owner: 'legacy-user' }],
    });
    expect(resolved.name).toBe('expanded-bot');
    expect(resolved.owner).toBe('expanded-user');
    expect(resolved.randomNamePerConnection).toBe(false);
  });

  it('isolates multiple endpoints on separate websocket paths', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receiveA = vi.fn(async () => Object.freeze({ matched: false }));
    const receiveB = vi.fn(async () => Object.freeze({ matched: false }));
    const gatewayA: MessageGateway = { receive: receiveA, send: vi.fn(async () => 'sent') };
    const gatewayB: MessageGateway = { receive: receiveB, send: vi.fn(async () => 'sent') };
    const endpointA = new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway: gatewayA,
      http,
      defaults: resolveSandboxEndpoint({ name: 'alpha-bot', owner: 'user-a' }),
    });
    const endpointB = new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway: gatewayB,
      http,
      defaults: resolveSandboxEndpoint({ name: 'beta-bot', owner: 'user-b' }),
    });
    endpointA.start();
    endpointA.open();
    endpointB.start();
    endpointB.open();
    const { port } = await http.listen();

    // First endpoint keeps /sandbox; the second is isolated on /sandbox/beta-bot.
    const clientA = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
    const clientB = new WebSocket(`ws://127.0.0.1:${port}/sandbox/beta-bot`);
    await new Promise<void>((resolve, reject) => {
      let opened = 0;
      const timer = setTimeout(() => reject(new Error('timeout waiting for ws open')), 3000);
      const onOpen = () => {
        opened += 1;
        if (opened === 2) {
          clearTimeout(timer);
          resolve();
        }
      };
      clientA.once('open', onOpen);
      clientB.once('open', onOpen);
      clientA.once('error', reject);
      clientB.once('error', reject);
    });

    clientA.send(JSON.stringify({ text: 'to-alpha' }));
    clientB.send(JSON.stringify({ text: 'to-beta' }));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for receives')), 3000);
      const interval = setInterval(() => {
        if (receiveA.mock.calls.length > 0 && receiveB.mock.calls.length > 0) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve();
        }
      }, 20);
    });

    // No cross-talk: each gateway saw exactly its own message.
    expect(receiveA).toHaveBeenCalledTimes(1);
    expect(receiveA).toHaveBeenCalledWith(expect.objectContaining({
      target: 'alpha-bot',
      content: 'to-alpha',
    }));
    expect(receiveB).toHaveBeenCalledTimes(1);
    expect(receiveB).toHaveBeenCalledWith(expect.objectContaining({
      target: 'beta-bot',
      content: 'to-beta',
    }));

    // Outbound reaches only the endpoint's own connection.
    endpointA.send({ target: 'alpha-bot', payload: 'reply-alpha' });
    endpointB.send({ target: 'beta-bot', payload: 'reply-beta' });
    const [wireA, wireB] = await Promise.all([
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout alpha reply')), 3000);
        clientA.on('message', (data) => {
          const parsed = JSON.parse(String(data)) as { content?: Array<{ data?: { text?: string } }> };
          if (parsed.content?.[0]?.data?.text === 'reply-alpha') {
            clearTimeout(timer);
            resolve(String(data));
          }
        });
      }),
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout beta reply')), 3000);
        clientB.on('message', (data) => {
          const parsed = JSON.parse(String(data)) as { content?: Array<{ data?: { text?: string } }> };
          if (parsed.content?.[0]?.data?.text === 'reply-beta') {
            clearTimeout(timer);
            resolve(String(data));
          }
        });
      }),
    ]);
    expect(JSON.parse(wireA).bot).toBe('alpha-bot');
    expect(JSON.parse(wireB).bot).toBe('beta-bot');

    clientA.close();
    clientB.close();
    endpointA.stop();
    endpointB.stop();
  });

  it('passes through already-wrapped outbound envelopes', () => {
    const wire = formatSandboxOutbound({
      type: 'message',
      content: [{ type: 'text', data: { text: 'hi' } }],
      timestamp: 42,
    });
    expect(JSON.parse(wire)).toEqual({
      type: 'message',
      content: [{ type: 'text', data: { text: 'hi' } }],
      timestamp: 42,
    });
  });

  it('closes the previous fixed-name client when a new one connects', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', name: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    });
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const firstClosed = await new Promise<number>((resolve, reject) => {
      const first = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      const timer = setTimeout(() => reject(new Error('timeout waiting for replace close')), 3000);
      first.once('open', () => {
        const second = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
        second.once('open', () => {
          // second client owns the target; first should be closed by server
        });
        second.once('error', reject);
      });
      first.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      first.once('error', reject);
    });

    expect(firstClosed).toBe(4000);
  });

  it('uses action segment payload as text when no text segments', () => {
    const parsed = parseSandboxWsPayload(JSON.stringify({
      content: [{ type: 'action', data: { id: 'btn-1', payload: 'pick:yes' } }],
    }));
    expect(parsed.text).toBe('pick:yes');
    expect(parsed.action).toEqual({ id: 'btn-1', payload: 'pick:yes' });
  });

  it('routes action-only websocket payload through MessageGateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'pong' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', name: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    });
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      const timer = setTimeout(() => reject(new Error('timeout waiting for gateway.receive')), 3000);
      client.once('open', () => {
        client.send(JSON.stringify({
          content: [{ type: 'action', data: { id: 'btn-1', payload: 'pick:yes' } }],
        }));
      });
      const interval = setInterval(() => {
        if (receive.mock.calls.length > 0) {
          clearInterval(interval);
          clearTimeout(timer);
          client.close();
          resolve();
        }
      }, 20);
      client.once('error', reject);
    });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'demo-bot',
      content: 'pick:yes',
      metadata: expect.objectContaining({
        action: { id: 'btn-1', payload: 'pick:yes' },
      }),
    }));
  });
});
