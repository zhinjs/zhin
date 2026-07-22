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
