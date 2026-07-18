import { createHash } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { LarkEndpoint } from '../src/endpoint.js';
import {
  formatInboundContent,
  formatOutboundBody,
  resolveLarkConfig,
  verifySignature,
  type LarkMessage,
} from '../src/protocol.js';
import { getLarkAgentDeps, setLarkAgentDeps } from '../src/lark-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
const ENCRYPT_KEY = 'test-encrypt-key';

const baseConfig = resolveLarkConfig({
  name: 'test-lark-bot',
  appId: 'cli_test',
  appSecret: 'secret-test',
  webhookPath: '/lark/webhook',
  encryptKey: ENCRYPT_KEY,
  apiBaseUrl: 'https://open.feishu.cn/open-apis',
  isFeishu: true,
});

function signBody(
  body: string,
  timestamp: string,
  nonce: string,
  key = ENCRYPT_KEY,
): string {
  return createHash('sha256').update(`${timestamp}${nonce}${key}${body}`).digest('hex');
}

function textMessage(overrides: Partial<LarkMessage> = {}): LarkMessage {
  return {
    message_id: 'om_1',
    create_time: '1700000000000',
    chat_id: 'oc_group1',
    sender: { sender_id: { open_id: 'ou_user1' } },
    message_type: 'text',
    content: JSON.stringify({ text: 'hello' }),
    ...overrides,
  };
}

function mockFetchOk(messageId = 'sent-1'): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          code: 0,
          tenant_access_token: 'tok',
          expire: 7200,
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        code: 0,
        data: { message_id: messageId },
      }),
    };
  });
}

afterEach(async () => {
  setLarkAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('lark protocol helpers', () => {
  it('resolves plugin config with defaults', () => {
    const resolved = resolveLarkConfig({
      appId: 'cli_x',
      appSecret: 'sec',
    });
    expect(resolved.webhookPath).toBe('/lark/webhook');
    expect(resolved.apiBaseUrl).toBe('https://open.feishu.cn/open-apis');
    expect(resolved.name).toBe('lark-bot');
    expect(resolved.isFeishu).toBe(true);
  });

  it('verifies SHA256 signatures', () => {
    const body = '{"type":"event_callback"}';
    const timestamp = '1700000000';
    const nonce = 'n1';
    const signature = signBody(body, timestamp, nonce);
    expect(verifySignature(ENCRYPT_KEY, timestamp, nonce, body, signature)).toBe(true);
    expect(verifySignature(ENCRYPT_KEY, timestamp, nonce, body, 'bad')).toBe(false);
  });

  it('formats inbound content by message type', () => {
    expect(formatInboundContent(textMessage())).toBe('hello');
    expect(formatInboundContent(textMessage({
      message_type: 'image',
      content: JSON.stringify({ image_key: 'img_1' }),
    }))).toBe('[image]');
    expect(formatInboundContent(textMessage({
      message_type: 'file',
      content: JSON.stringify({ file_name: 'a.pdf' }),
    }))).toBe('[file: a.pdf]');
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundBody('pong')).toEqual({
      msg_type: 'text',
      content: JSON.stringify({ text: 'pong' }),
    });
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { id: 'ou_1', name: 'Bob' } },
    ])).toEqual({
      msg_type: 'text',
      content: JSON.stringify({ text: 'hi<at user_id="ou_1">Bob</at>' }),
    });
    expect(formatOutboundBody([
      { type: 'image', data: { file_key: 'img_k' } },
    ])).toEqual({
      msg_type: 'image',
      content: JSON.stringify({ image_key: 'img_k' }),
    });
  });
});

describe('lark plugin runtime adapter', () => {
  it('responds to url_verification challenge', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new LarkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'lark'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: { ...baseConfig, encryptKey: undefined },
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const body = JSON.stringify({ type: 'url_verification', challenge: 'c-123' });
    const res = await fetch(`http://127.0.0.1:${port}/lark/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'c-123' });
    await endpoint.stop();
  });

  it('POST webhook with valid signature admits via MessageGateway when open', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new LarkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'lark'),
      gateway,
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const payload = {
      type: 'event_callback',
      event: { message: textMessage() },
    };
    const body = JSON.stringify(payload);
    const timestamp = '1700000000';
    const nonce = 'n1';
    const res = await fetch(`http://127.0.0.1:${port}/lark/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lark-request-timestamp': timestamp,
        'x-lark-request-nonce': nonce,
        'x-lark-signature': signBody(body, timestamp, nonce),
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 0, msg: 'success' });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'oc_group1',
      content: 'hello',
      sender: 'ou_user1',
      id: 'om_1',
    }));
    await endpoint.stop();
  });

  it('rejects webhook with invalid signature', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new LarkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'lark'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const body = JSON.stringify({
      type: 'event_callback',
      event: { message: textMessage() },
    });
    const res = await fetch(`http://127.0.0.1:${port}/lark/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lark-request-timestamp': '1',
        'x-lark-request-nonce': 'n',
        'x-lark-signature': 'bad',
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
    const endpoint = new LarkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'lark'),
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

  it('send posts im/v1/messages with access token', async () => {
    const fetchMock = mockFetchOk('out-42');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new LarkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'lark'),
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
    const id = await endpoint.send({ target: 'oc_group1', payload: 'pong' });
    expect(id).toBe('out-42');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/im/v1/messages'),
      expect.objectContaining({ method: 'POST' }),
    );
    await endpoint.stop();
  });

  it('registers agent endpoint on start', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new LarkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'lark'),
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
    expect(getLarkAgentDeps().getEndpoint('test-lark-bot')).toBe(endpoint);
    await endpoint.stop();
    expect(() => getLarkAgentDeps().getEndpoint('test-lark-bot')).toThrow(/不存在/);
  });
});
