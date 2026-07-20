import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { WecomEndpoint } from '../src/endpoint.js';
import {
  formatInboundContent,
  formatOutboundBody,
  getAesKey,
  parseXmlMessage,
  resolveWecomConfig,
  verifySignature,
  type WecomMessage,
} from '../src/protocol.js';
import { getWecomAgentDeps, setWecomAgentDeps } from '../src/wecom-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

/** 32-byte key → 43-char EncodingAESKey (no padding). */
const AES_KEY_RAW = Buffer.alloc(32, 7);
const ENCODING_AES_KEY = AES_KEY_RAW.toString('base64').replace(/=+$/, '');
const CORP_ID = 'wwtestcorpid';
const TOKEN = 'wecom-test-token';

const baseConfig = resolveWecomConfig({
  name: 'test-wecom-bot',
  corpId: CORP_ID,
  agentSecret: 'test-agent-secret',
  token: TOKEN,
  encodingAESKey: ENCODING_AES_KEY,
  webhookPath: '/wecom/callback',
  apiBaseUrl: 'https://qyapi.weixin.qq.com',
});

function encryptPlain(plain: string, corpId = CORP_ID): string {
  const aesKey = getAesKey(ENCODING_AES_KEY);
  const iv = aesKey.subarray(0, 16);
  const random = randomBytes(16);
  const msgBuf = Buffer.from(plain, 'utf8');
  const corpBuf = Buffer.from(corpId, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const plaintext = Buffer.concat([random, lenBuf, msgBuf, corpBuf]);
  const padLen = 32 - (plaintext.length % 32);
  const padded = Buffer.concat([plaintext, Buffer.alloc(padLen, padLen)]);
  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function msgSignature(encrypt: string, timestamp: string, nonce: string): string {
  return createHash('sha1')
    .update([TOKEN, timestamp, nonce, encrypt].sort().join(''))
    .digest('hex');
}

function textMessage(overrides: Partial<WecomMessage> = {}): WecomMessage {
  return {
    ToUserName: 'wwbot',
    FromUserName: 'user001',
    CreateTime: 1_700_000_000,
    MsgType: 'text',
    Content: 'hello',
    MsgId: 'msg-1',
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
      json: async () => ({ errcode: 0, msgid: messageId }),
    };
  });
}

afterEach(async () => {
  setWecomAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('wecom protocol helpers', () => {
  it('resolves plugin config with defaults', () => {
    const resolved = resolveWecomConfig({
      corpId: 'c',
      agentSecret: 's',
      token: 't',
      encodingAESKey: ENCODING_AES_KEY,
    });
    expect(resolved.webhookPath).toBe('/wecom/callback');
    expect(resolved.apiBaseUrl).toBe('https://qyapi.weixin.qq.com');
    expect(resolved.name).toBe('wecom-bot');
  });

  it('verifies SHA1 msg_signature', () => {
    const timestamp = '1409659589';
    const nonce = '263014780';
    const encrypt = 'cipher-text';
    const signature = msgSignature(encrypt, timestamp, nonce);
    expect(verifySignature(TOKEN, timestamp, nonce, encrypt, signature)).toBe(true);
    expect(verifySignature(TOKEN, timestamp, nonce, encrypt, 'bad')).toBe(false);
  });

  it('parses XML text messages', () => {
    const xml = [
      '<xml>',
      '<ToUserName><![CDATA[wwbot]]></ToUserName>',
      '<FromUserName><![CDATA[user001]]></FromUserName>',
      '<CreateTime>1700000000</CreateTime>',
      '<MsgType><![CDATA[text]]></MsgType>',
      '<Content><![CDATA[hi]]></Content>',
      '<MsgId>42</MsgId>',
      '</xml>',
    ].join('');
    expect(parseXmlMessage(xml)).toEqual(expect.objectContaining({
      MsgType: 'text',
      Content: 'hi',
      FromUserName: 'user001',
      MsgId: '42',
    }));
  });

  it('formats inbound content by msg type', () => {
    expect(formatInboundContent(textMessage())).toBe('hello');
    expect(formatInboundContent(textMessage({
      MsgType: 'event',
      Event: 'enter_agent',
      Content: undefined,
    }))).toContain('enter_agent');
    expect(formatInboundContent(textMessage({
      MsgType: 'image',
      PicUrl: 'https://x/y.png',
      Content: undefined,
    }))).toContain('https://x/y.png');
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundBody('pong')).toEqual({
      msgtype: 'text',
      data: { content: 'pong' },
    });
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { id: 'u1' } },
    ])).toEqual({
      msgtype: 'text',
      data: { content: 'hi<@u1>' },
    });
    expect(formatOutboundBody([
      { type: 'markdown', data: { content: '# title' } },
    ])).toEqual({
      msgtype: 'markdown',
      data: { content: '# title' },
    });
  });
});

describe('wecom plugin runtime adapter', () => {
  it('GET verification decrypts echostr when signature is valid', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const endpoint = new WecomEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wecom'),
      gateway,
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const timestamp = '1409659589';
    const nonce = '263014780';
    const plain = '1616140317555161061';
    const echostr = encryptPlain(plain);
    const signature = msgSignature(echostr, timestamp, nonce);
    const res = await fetch(
      `http://127.0.0.1:${port}/wecom/callback?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}&echostr=${encodeURIComponent(echostr)}`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(plain);
    await endpoint.stop();
  });

  it('POST webhook with valid signature admits via MessageGateway when open', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new WecomEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wecom'),
      gateway,
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const inner = [
      '<xml>',
      '<ToUserName><![CDATA[wwbot]]></ToUserName>',
      '<FromUserName><![CDATA[user001]]></FromUserName>',
      '<CreateTime>1700000000</CreateTime>',
      '<MsgType><![CDATA[text]]></MsgType>',
      '<Content><![CDATA[hello]]></Content>',
      '<MsgId>msg-1</MsgId>',
      '</xml>',
    ].join('');
    const encrypt = encryptPlain(inner);
    const timestamp = '1700000000';
    const nonce = 'n1';
    const signature = msgSignature(encrypt, timestamp, nonce);
    const body = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;
    const res = await fetch(
      `http://127.0.0.1:${port}/wecom/callback?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('success');
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'user001',
      content: 'hello',
      sender: 'user001',
      id: 'msg-1',
    }));
    await endpoint.stop();
  });

  it('rejects webhook with invalid signature', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new WecomEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wecom'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const encrypt = encryptPlain('<xml/>');
    const body = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;
    const res = await fetch(
      `http://127.0.0.1:${port}/wecom/callback?msg_signature=bad&timestamp=1&nonce=n`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body,
      },
    );
    expect(res.status).toBe(403);
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('does not admit when closed', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new WecomEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wecom'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    await http.listen();
    // intentionally not open()
    endpoint.admit(textMessage());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('send posts message/send with access token', async () => {
    const fetchMock = mockFetchOk('out-42');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new WecomEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wecom'),
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
    const id = await endpoint.send({ target: 'user001', payload: 'pong' });
    expect(id).toBe('out-42');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/cgi-bin/message/send'),
      expect.objectContaining({ method: 'POST' }),
    );
    await endpoint.stop();
  });

  it('registers agent endpoint on start', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new WecomEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wecom'),
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
    expect(getWecomAgentDeps().getEndpoint('test-wecom-bot')).toBe(endpoint);
    await endpoint.stop();
    expect(() => getWecomAgentDeps().getEndpoint('test-wecom-bot')).toThrow(/不存在/);
  });
});
