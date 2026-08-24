import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { createSandboxReadinessGate, SandboxWsEndpoint } from '../src/endpoint.js';
import {
  formatSandboxOutbound,
  parseSandboxWsPayload,
  resolveSandboxEndpoint,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
const endpointKey = String(capabilityId(rootPluginId(), adapterFeature, 'sandbox'));

function sandboxConversation(id: string, kind: ConversationRef['kind'] = 'private'): ConversationRef {
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind,
    id,
  };
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('sandbox plugin runtime adapter', () => {
  it('keeps the replacement path claim when the previous HMR endpoint stops', () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const ws = vi.spyOn(http, 'ws');
    const gateway: OutboundMessageService = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const createEndpoint = (id: string) => bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, `sandbox-${id}`),
      gateway,
      http,
      defaults: resolveSandboxEndpoint({ id, owner: 'sandbox-user' }),
    }), gateway, undefined);

    const previous = createEndpoint('demo-bot');
    const replacement = createEndpoint('demo-bot');
    previous.start();
    replacement.start();
    previous.stop();

    const other = createEndpoint('other-bot');
    other.start();
    expect(ws.mock.calls.map(([path]) => path)).toEqual([
      '/sandbox',
      '/sandbox',
      '/sandbox/other-bot',
    ]);

    replacement.stop();
    other.stop();
  });

  it('shares a delayed readiness probe and lets callers suppress stale delivery', async () => {
    let resolveProbe: ((status: {
      available: boolean;
      provider: 'docker';
      message: string;
    }) => void) | undefined;
    const probe = vi.fn(() => new Promise<{
      available: boolean;
      provider: 'docker';
      message: string;
    }>((resolve) => {
      resolveProbe = resolve;
    }));
    const gate = createSandboxReadinessGate(probe);
    const staleDelivery = vi.fn();
    const currentDelivery = vi.fn();
    let firstConnectionIsCurrent = true;

    gate.afterProbe(() => undefined);
    gate.afterProbe((status) => {
      if (firstConnectionIsCurrent) staleDelivery(status);
    });
    gate.afterProbe(currentDelivery);

    expect(probe).toHaveBeenCalledTimes(1);
    firstConnectionIsCurrent = false;
    resolveProbe?.({ available: true, provider: 'docker', message: 'Docker test' });
    await vi.waitFor(() => expect(currentDelivery).toHaveBeenCalledTimes(1));
    expect(staleDelivery).not.toHaveBeenCalled();

    gate.afterProbe(() => undefined);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('routes websocket messages through OutboundMessageService', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    let markReceived: () => void = () => {};
    const received = new Promise<void>((resolve) => {
      markReceived = resolve;
    });
    const receive = vi.fn(async () => {
      markReceived();
      return Object.freeze({ matched: true, value: 'pong' });
    });
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', id: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    }), gateway, undefined);
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send(JSON.stringify({
            type: 'group',
            id: 'workspace-room',
            messageId: 'msg-client-1',
            text: 'hello sandbox',
            agentRun: {
              workingDirectory: '/workspace/app',
              safetyMode: 'read-only',
              approvalMode: 'deny',
              networkAccess: false,
            },
          }));
          resolve();
        });
        client.once('error', reject);
      });
      await received;
    } finally {
      client.close();
    }

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: sandboxConversation('workspace-room', 'group'),
      message: { conversation: sandboxConversation('workspace-room', 'group'), id: 'msg-client-1' },
      content: 'hello sandbox',
      sender: expect.objectContaining({ id: 'sandbox-user' }),
      metadata: expect.objectContaining({
        sandboxAgentRun: {
          workingDirectory: '/workspace/app',
          safetyMode: 'read-only',
          approvalMode: 'deny',
          networkAccess: false,
        },
      }),
    }));
  });

  it('sends outbound payloads to the active websocket connection', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: OutboundMessageService = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', id: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    }), gateway, undefined);
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const payload = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      const timer = setTimeout(() => reject(new Error('timeout waiting for websocket reply')), 3000);
      let retry: ReturnType<typeof setTimeout> | undefined;
      client.once('open', () => {
        const sendWhenAccepted = () => {
          try {
            endpoint.send({ conversation: sandboxConversation('sandbox-user'), payload: 'pong' });
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'Sandbox Endpoint has no live connection') {
              clearTimeout(timer);
              reject(error);
              return;
            }
            retry = setTimeout(sendWhenAccepted, 10);
          }
        };
        sendWhenAccepted();
      });
      client.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as {
          content?: Array<{ type: string; data?: { text?: string } }>;
        };
        const text = parsed.content?.[0]?.data?.text;
        if (text !== 'pong') return;
        clearTimeout(timer);
        if (retry) clearTimeout(retry);
        client.close();
        resolve(String(data));
      });
      client.once('error', (error) => {
        clearTimeout(timer);
        if (retry) clearTimeout(retry);
        reject(error);
      });
    });

    expect(JSON.parse(payload).content).toEqual([
      { type: 'text', data: { text: 'pong' } },
    ]);
  });

  it('keeps sandbox payload parsing stable', () => {
    const parsed = parseSandboxWsPayload(JSON.stringify({ text: 'ping', messageId: 'msg-client-1' }));
    expect(parsed.text).toBe('ping');
    expect(parsed.type).toBe('private');
    expect(parsed.messageId).toBe('msg-client-1');
    expect(parseSandboxWsPayload(JSON.stringify({ text: 'ping', messageId: '../bad id' })))
      .not.toHaveProperty('messageId');
  });

  it('drops malformed run policies instead of forwarding arbitrary metadata', () => {
    expect(parseSandboxWsPayload(JSON.stringify({ text: 'ping', agentRun: 'root please' })))
      .not.toHaveProperty('agentRun');
  });

  it('prefers top-level id/owner over legacy endpoints[] entries', () => {
    // Runtime expands endpoints[i] onto the top level ({ ...base, ...entry, id }).
    const resolved = resolveSandboxEndpoint({
      id: 'expanded-bot',
      owner: 'expanded-user',
      endpoints: [{ context: 'sandbox', id: 'legacy-bot', owner: 'legacy-user' }],
    });
    expect(resolved.id).toBe('expanded-bot');
    expect(resolved.owner).toBe('expanded-user');
    expect(resolved.randomNamePerConnection).toBe(false);
  });

  it('keeps the default endpoint id stable across reconnects', () => {
    const resolved = resolveSandboxEndpoint({});
    expect(resolved.id).toBe('sandbox-bot');
    expect(resolved.randomNamePerConnection).toBe(false);
  });

  it('does not let a demo-scope websocket run Agent tasks', async () => {
    const http = createHttpHost({
      host: '127.0.0.1',
      port: 0,
      tokens: [{ token: 'demo-token', scope: 'demo' }],
    });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      defaults: resolveSandboxEndpoint({ id: 'demo-bot', owner: 'sandbox-user' }),
    }), { receive, send: vi.fn(async () => 'sent') }, undefined);
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const errorText = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox?token=demo-token`);
      const timer = setTimeout(() => reject(new Error('timeout waiting for read-only error')), 3000);
      // The permission gate is independent of the informational `ready` frame,
      // whose shell-isolation probe may be delayed on a loaded CI runner.
      client.once('open', () => {
        client.send(JSON.stringify({ text: 'run outside workspace' }));
      });
      client.on('message', (raw) => {
        const payload = JSON.parse(String(raw)) as { type?: string; content?: Array<{ data?: { text?: string } }> };
        if (payload.type === 'error') {
          clearTimeout(timer);
          client.close();
          resolve(payload.content?.[0]?.data?.text ?? '');
        }
      });
      client.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    expect(errorText).toContain('只读演示权限');
    expect(receive).not.toHaveBeenCalled();
  });

  it('isolates multiple endpoints on separate websocket paths', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receiveA = vi.fn(async () => Object.freeze({ matched: false }));
    const receiveB = vi.fn(async () => Object.freeze({ matched: false }));
    const gatewayA: OutboundMessageService = { receive: receiveA, send: vi.fn(async () => 'sent') };
    const gatewayB: OutboundMessageService = { receive: receiveB, send: vi.fn(async () => 'sent') };
    const endpointA = bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway: gatewayA,
      http,
      defaults: resolveSandboxEndpoint({ id: 'alpha-bot', owner: 'user-a' }),
    }), gatewayA, undefined);
    const endpointB = bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway: gatewayB,
      http,
      defaults: resolveSandboxEndpoint({ id: 'beta-bot', owner: 'user-b' }),
    }), gatewayB, undefined);
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

    // No cross-talk: each gateway saw exactly its own message (endpointId
    // distinguishes them — both test endpoints share one CapabilityId).
    expect(receiveA).toHaveBeenCalledTimes(1);
    expect(receiveA).toHaveBeenCalledWith(expect.objectContaining({
      conversation: sandboxConversation('sandbox-user'),
      content: 'to-alpha',
      endpointId: 'alpha-bot',
    }));
    expect(receiveB).toHaveBeenCalledTimes(1);
    expect(receiveB).toHaveBeenCalledWith(expect.objectContaining({
      conversation: sandboxConversation('sandbox-user'),
      content: 'to-beta',
      endpointId: 'beta-bot',
    }));

    // Outbound reaches only the endpoint's own connection.
    endpointA.send({ conversation: sandboxConversation('sandbox-user'), payload: 'reply-alpha' });
    endpointB.send({ conversation: sandboxConversation('sandbox-user'), payload: 'reply-beta' });
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

  it('sends canonical url media segments directly', () => {
    const wire = formatSandboxOutbound([
      { type: 'text', data: { text: '看图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } },
    ]);
    expect(JSON.parse(wire).content).toEqual([
      { type: 'text', data: { text: '看图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } },
    ]);
  });

  it('inlines canonical base64 media with a base64:// prefix', () => {
    const wire = formatSandboxOutbound([
      { type: 'image', data: { media: { kind: 'base64', value: 'aGk=', mime_type: 'image/png' } } },
    ]);
    expect(JSON.parse(wire).content).toEqual([
      {
        type: 'image',
        data: {
          media: { kind: 'base64', value: 'base64://image/png;base64,aGk=', mime_type: 'image/png' },
        },
      },
    ]);
  });

  it('materializes canonical path media from disk into base64', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhin-sandbox-media-'));
    try {
      const file = join(dir, 'a.png');
      writeFileSync(file, Buffer.from('hi'));
      const wire = formatSandboxOutbound([
        { type: 'image', data: { media: { kind: 'path', value: file, mime_type: 'image/png' } } },
      ]);
      expect(JSON.parse(wire).content).toEqual([
        {
          type: 'image',
          data: {
            media: { kind: 'base64', value: 'base64://image/png;base64,aGk=', mime_type: 'image/png' },
          },
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops media segments without a canonical data.media ref', () => {
    // legacy 形状（data.url / data.base64）不再可读，warn + 丢弃
    const wire = formatSandboxOutbound([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { url: 'https://example.com/a.png' } },
      { type: 'video', data: { base64: 'aGk=' } },
    ]);
    expect(JSON.parse(wire).content).toEqual([
      { type: 'text', data: { text: 'hi' } },
    ]);
  });

  it('drops unsupported file-kind media and normalizes envelope content', () => {
    const wire = formatSandboxOutbound({
      type: 'message',
      content: [
        { type: 'file', data: { media: { kind: 'file', value: 'opaque-file-id' } } },
        { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/a.mp3' } } },
      ],
      timestamp: 42,
    });
    expect(JSON.parse(wire)).toEqual({
      type: 'message',
      content: [
        { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/a.mp3' } } },
      ],
      timestamp: 42,
    });
  });

  it('closes the previous fixed-name client when a new one connects', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: OutboundMessageService = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', id: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    }), gateway, undefined);
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

  it('routes action-only websocket payload through OutboundMessageService', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    let markReceived: () => void = () => {};
    const received = new Promise<void>((resolve) => {
      markReceived = resolve;
    });
    const receive = vi.fn(async () => {
      markReceived();
      return Object.freeze({ matched: true, value: 'pong' });
    });
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const defaults = resolveSandboxEndpoint({
      endpoints: [{ context: 'sandbox', id: 'demo-bot', owner: 'sandbox-user' }],
    });
    const endpoint = bindTestEndpoint(new SandboxWsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'sandbox'),
      gateway,
      http,
      defaults,
    }), gateway, undefined);
    endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send(JSON.stringify({
            content: [{ type: 'action', data: { id: 'btn-1', payload: 'pick:yes' } }],
          }));
          resolve();
        });
        client.once('error', reject);
      });
      await received;
    } finally {
      client.close();
    }

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: sandboxConversation('sandbox-user'),
      content: 'pick:yes',
      metadata: expect.objectContaining({
        action: { id: 'btn-1', payload: 'pick:yes' },
      }),
    }));
  });
});
