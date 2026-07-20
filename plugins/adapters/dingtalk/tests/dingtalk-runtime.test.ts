import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { DingTalkEndpoint } from '../src/endpoint.js';
import {
  formatInboundContent,
  formatOutboundBody,
  resolveDingTalkConfig,
  verifySignature,
  type DingTalkMessage,
} from '../src/protocol.js';
import { getDingtalkAgentDeps, setDingtalkAgentDeps } from '../src/dingtalk-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
const APP_SECRET = 'test-app-secret';

const baseConfig = resolveDingTalkConfig({
  name: 'test-dingtalk-bot',
  appKey: 'test-app-key',
  appSecret: APP_SECRET,
  webhookPath: '/dingtalk/webhook',
  robotCode: 'robot-1',
  apiBaseUrl: 'https://oapi.dingtalk.com',
});

function signTimestamp(timestamp: string, secret = APP_SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
}

function textMessage(overrides: Partial<DingTalkMessage> = {}): DingTalkMessage {
  return {
    msgtype: 'text',
    text: { content: 'hello' },
    msgId: 'msg-1',
    createAt: 1_700_000_000_000,
    conversationType: '1',
    conversationId: 'cid-1',
    senderId: 'user-1',
    senderNick: 'Alice',
    ...overrides,
  };
}

function mockFetchOk(messageId = 'sent-1'): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/gettoken')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ errcode: 0, access_token: 'tok', expires_in: 7200 }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ errcode: 0, msgId: messageId }),
    };
  });
}

afterEach(async () => {
  setDingtalkAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('dingtalk protocol helpers', () => {
  it('resolves plugin config with defaults', () => {
    const resolved = resolveDingTalkConfig({
      appKey: 'k',
      appSecret: 's',
    });
    expect(resolved.webhookPath).toBe('/dingtalk/webhook');
    expect(resolved.apiBaseUrl).toBe('https://oapi.dingtalk.com');
    expect(resolved.name).toBe('dingtalk-bot');
  });

  it('verifies HMAC-SHA256 signatures', () => {
    const timestamp = '1700000000000';
    const sign = signTimestamp(timestamp);
    expect(verifySignature(APP_SECRET, timestamp, sign)).toBe(true);
    expect(verifySignature(APP_SECRET, timestamp, 'bad')).toBe(false);
  });

  it('formats inbound content by msg type', () => {
    expect(formatInboundContent(textMessage())).toBe('hello');
    expect(formatInboundContent(textMessage({ msgtype: 'picture', text: undefined }))).toBe('[image]');
    expect(formatInboundContent(textMessage({
      msgtype: 'file',
      text: undefined,
      content: { fileName: 'a.pdf' },
    }))).toBe('[file: a.pdf]');
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundBody('pong')).toEqual({
      msgtype: 'text',
      text: { content: 'pong' },
    });
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { id: 'u1', name: 'Bob' } },
    ])).toEqual({
      msgtype: 'text',
      text: { content: 'hi@Bob ' },
      at: { atUserIds: ['u1'], isAtAll: false },
    });
    expect(formatOutboundBody([
      { type: 'markdown', data: { title: 't', content: '# title' } },
    ])).toEqual({
      msgtype: 'markdown',
      markdown: { title: 't', text: '# title' },
    });
  });
});

describe('dingtalk plugin runtime adapter', () => {
  it('POST webhook with valid signature admits via MessageGateway when open', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new DingTalkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'dingtalk'),
      gateway,
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const event = textMessage();
    const body = JSON.stringify(event);
    const timestamp = '1700000000000';
    // Real DingTalk outgoing callbacks carry timestamp/sign on the URL query.
    const query = new URLSearchParams({
      timestamp,
      sign: signTimestamp(timestamp),
    });
    const res = await fetch(`http://127.0.0.1:${port}/dingtalk/webhook?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 0, msg: 'success' });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'cid-1',
      content: 'hello',
      sender: 'user-1',
      id: 'msg-1',
    }));
    await endpoint.stop();
  });

  it('rejects webhook with invalid signature', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new DingTalkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'dingtalk'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const res = await fetch(`http://127.0.0.1:${port}/dingtalk/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        timestamp: '1700000000000',
        sign: 'invalid',
      },
      body: JSON.stringify(textMessage()),
    });
    expect(res.status).toBe(403);
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('marks metadata.mentioned when the robot is @ed', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new DingTalkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'dingtalk'),
      gateway,
      http,
      config: baseConfig, // robotCode = 'robot-1'
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    await http.listen();

    endpoint.admit({
      ...textMessage({ conversationType: '2' }),
      atUserIds: ['robot-1'],
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(receive).toHaveBeenNthCalledWith(1, expect.objectContaining({
      target: 'cid-1',
      metadata: expect.objectContaining({ mentioned: true }),
    }));

    endpoint.admit({ ...textMessage({ msgId: 'msg-2', conversationType: '2' }), isInAtList: false });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    const metadata = receive.mock.calls[1]?.[0]?.metadata as Record<string, unknown>;
    expect(metadata?.mentioned).toBeUndefined();
    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new DingTalkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'dingtalk'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    await http.listen();
    endpoint.admit(textMessage());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('send posts robot/send with access token', async () => {
    const fetchMock = mockFetchOk('out-42');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new DingTalkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'dingtalk'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: baseConfig,
      fetch: fetchMock,
    });
    await endpoint.start();
    await http.listen();
    const id = await endpoint.send({ target: 'cid-1', payload: 'pong' });
    expect(id).toBe('out-42');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/robot/send'),
      expect.objectContaining({ method: 'POST' }),
    );
    await endpoint.stop();
  });

  it('prefers sessionWebhook when cached from inbound', async () => {
    const fetchMock = mockFetchOk('session-9');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new DingTalkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'dingtalk'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: true, value: 'ok' })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: baseConfig,
      fetch: fetchMock,
    });
    await endpoint.start();
    endpoint.open();
    await http.listen();
    endpoint.admit(textMessage({
      sessionWebhook: 'https://session.example/hook',
    }));
    const id = await endpoint.send({ target: 'cid-1', payload: 'reply' });
    expect(id).toBe('session-9');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://session.example/hook',
      expect.objectContaining({ method: 'POST' }),
    );
    await endpoint.stop();
  });

  it('registers agent endpoint on start', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new DingTalkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'dingtalk'),
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
    expect(getDingtalkAgentDeps().getEndpoint('test-dingtalk-bot')).toBe(endpoint);
    await endpoint.stop();
    expect(() => getDingtalkAgentDeps().getEndpoint('test-dingtalk-bot')).toThrow(/不存在/);
  });
});
