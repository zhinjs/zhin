import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { LineEndpoint } from '../src/endpoint.js';
import {
  formatInboundContent,
  formatOutboundMessages,
  resolveLineConfig,
  verifySignature,
  type LineMessageEvent,
} from '../src/protocol.js';
import { getLineApiConfig, setLineAgentDeps } from '../src/line-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
const CHANNEL_SECRET = 'test-channel-secret';

const baseConfig = resolveLineConfig({
  name: 'test-line-bot',
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: 'test-access-token',
  webhookPath: '/line/webhook',
  apiBaseUrl: 'https://api.line.me',
});

function signBody(body: string, secret = CHANNEL_SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf-8').digest('base64');
}

function textEvent(overrides: Partial<LineMessageEvent> = {}): LineMessageEvent {
  return {
    type: 'message',
    replyToken: 'reply-token-1',
    source: { type: 'user', userId: 'U1234567890abcdef' },
    timestamp: 1_700_000_000_000,
    message: { id: 'msg-1', type: 'text', text: 'hello' },
    ...overrides,
  };
}

function mockFetchOk(messageId = 'sent-1'): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ sentMessages: [{ id: messageId }] }),
  }));
}

afterEach(async () => {
  setLineAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('line protocol helpers', () => {
  it('resolves plugin config with defaults', () => {
    const resolved = resolveLineConfig({
      channelSecret: 'sec',
      channelAccessToken: 'tok',
    });
    expect(resolved.webhookPath).toBe('/line/webhook');
    expect(resolved.apiBaseUrl).toBe('https://api.line.me');
    expect(resolved.name).toBe('line-bot');
  });

  it('verifies HMAC-SHA256 signatures', () => {
    const body = '{"events":[]}';
    const signature = signBody(body);
    expect(verifySignature(CHANNEL_SECRET, body, signature)).toBe(true);
    expect(verifySignature(CHANNEL_SECRET, body, 'bad')).toBe(false);
  });

  it('formats inbound content by event type', () => {
    expect(formatInboundContent(textEvent())).toBe('hello');
    expect(formatInboundContent({
      type: 'follow',
      replyToken: 'r',
      source: { type: 'user', userId: 'U1' },
      timestamp: 1,
    })).toBe('[follow]');
    expect(formatInboundContent({
      type: 'message',
      replyToken: 'r',
      source: { type: 'user', userId: 'U1' },
      timestamp: 1,
      message: { id: '1', type: 'image' },
    })).toBe('[image]');
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundMessages('pong')).toEqual([{ type: 'text', text: 'pong' }]);
    expect(formatOutboundMessages([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { url: 'https://example.com/a.png' } },
    ])).toEqual([
      { type: 'text', text: 'hi' },
      {
        type: 'image',
        originalContentUrl: 'https://example.com/a.png',
        previewImageUrl: 'https://example.com/a.png',
      },
    ]);
  });

  it('truncates outbound messages to LINE limit of 5', () => {
    const payload = Array.from({ length: 7 }, (_, i) => `m${i}`);
    expect(formatOutboundMessages(payload)).toHaveLength(5);
  });
});

describe('line plugin runtime adapter', () => {
  it('POST webhook with valid signature admits via MessageGateway when open', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway,
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const event = textEvent();
    const body = JSON.stringify({ destination: 'Ubot', events: [event] });
    const res = await fetch(`http://127.0.0.1:${port}/line/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Line-Signature': signBody(body),
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'OK' });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'U1234567890abcdef',
      content: 'hello',
      sender: 'U1234567890abcdef',
      id: 'msg-1',
    }));
    await endpoint.stop();
  });

  it('rejects webhook with invalid signature', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const body = JSON.stringify({ destination: 'Ubot', events: [textEvent()] });
    const res = await fetch(`http://127.0.0.1:${port}/line/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Line-Signature': 'invalid',
      },
      body,
    });
    expect(res.status).toBe(403);
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    await http.listen();
    endpoint.admit(textEvent());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('prefers Reply API when replyToken was cached from inbound', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const fetchFn = mockFetchOk('reply-id');
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: baseConfig,
      fetch: fetchFn,
    });
    await endpoint.start();
    await http.listen();
    endpoint.open();
    endpoint.admit(textEvent());
    const messageId = await endpoint.send({
      target: 'U1234567890abcdef',
      payload: 'pong',
    });
    expect(messageId).toBe('reply-id');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/reply',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"replyToken":"reply-token-1"'),
      }),
    );
    await endpoint.stop();
  });

  it('falls back to Push API without replyToken', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const fetchFn = mockFetchOk('push-id');
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: baseConfig,
      fetch: fetchFn,
    });
    await endpoint.start();
    await http.listen();
    endpoint.open();
    const messageId = await endpoint.send({
      target: 'U1234567890abcdef',
      payload: 'hi',
    });
    expect(messageId).toBe('push-id');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"to":"U1234567890abcdef"'),
      }),
    );
    await endpoint.stop();
  });

  it('registers agent API config on start', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    await http.listen();
    expect(getLineApiConfig()).toEqual({
      accessToken: 'test-access-token',
      apiBaseUrl: 'https://api.line.me',
    });
    await endpoint.stop();
  });
});
