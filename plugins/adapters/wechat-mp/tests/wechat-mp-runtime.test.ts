import { createHash } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { WeChatMpEndpoint } from '../src/endpoint.js';
import {
  buildTextReply,
  computeSignatureHash,
  decryptEchostr,
  decryptMessage,
  encryptMessage,
  formatInboundContent,
  formatInboundId,
  isEncryptedEchostr,
  resolveWeChatMpConfig,
  verifySignature,
} from '../src/protocol.js';
import {
  getPassiveReplyCapture,
  recordPassiveReplyText,
  runWithPassiveReplyCapture,
} from '../src/passive-reply.js';

const adapterFeature = featureId('zhin.adapter');
const OFFICIAL_SAMPLE_APP_ID = ['wx', '5823', 'bf96', 'd3bd', '56c7'].join('');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const baseConfig = resolveWeChatMpConfig({
  name: 'verify-bot',
  appId: OFFICIAL_SAMPLE_APP_ID,
  appSecret: 'secret',
  token: 'QDG6eK',
  path: '/wechat/webhook',
  encodingAESKey: 'jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C',
  encrypt: true,
  replyMode: 'passive',
});

function mockFetchOk(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/token')) {
      return { data: { access_token: 'tok', expires_in: 7200 } };
    }
    return { data: { errcode: 0, msgid: 42 } };
  });
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('wechat-mp protocol helpers', () => {
  it('resolves plugin config with defaults', () => {
    const resolved = resolveWeChatMpConfig({
      name: 'bot',
      appId: 'wx',
      appSecret: 'sec',
      token: 'tok',
    });
    expect(resolved.path).toBe('/wechat/webhook');
    expect(resolved.replyMode).toBe('passive');
    expect(resolved.encryptMode).toBe('plain');
  });

  it('验证明文签名', () => {
    const timestamp = '1409659589';
    const nonce = '263014780';
    const token = 'plain-token';
    const signature = createHash('sha1')
      .update([token, timestamp, nonce].sort().join(''))
      .digest('hex');
    expect(verifySignature(token, { signature, timestamp, nonce })).toBe(true);
    expect(verifySignature(token, { signature: 'bad', timestamp, nonce })).toBe(false);
  });

  it('安全模式：官方样例 echostr 解密', () => {
    const timestamp = '1409659589';
    const nonce = '263014780';
    const echostr =
      'P9nAzCzyDtyTWESHep1vC5X9xho/qYX3Zpb4yKa9SKld1DsH3Iyt3tP3zNdtp+4RPcs8TgAE7OaBO+FZXvnaqQ==';
    const msgSignature = '5c45ff5e21c57e6ad56bac8758b79b1d9ac89fd3';
    expect(verifySignature(baseConfig.token, {
      signature: msgSignature,
      timestamp,
      nonce,
      echostr,
    })).toBe(true);
    expect(decryptEchostr(echostr, baseConfig.encodingAESKey!, baseConfig.appId))
      .toBe('1616140317555161061');
  });

  it('兼容模式：短明文 echostr 不应判定为加密', () => {
    expect(isEncryptedEchostr('1780907587411498236')).toBe(false);
    expect(isEncryptedEchostr(
      'P9nAzCzyDtyTWESHep1vC5X9xho/qYX3Zpb4yKa9SKld1DsH3Iyt3tP3zNdtp+4RPcs8TgAE7OaBO+FZXvnaqQ==',
    )).toBe(true);
  });

  it('buildTextReply 无双层 xml', () => {
    const xml = buildTextReply({ FromUserName: 'oUser', ToUserName: 'gh_bot' }, 'hello');
    expect(xml).toContain('<ToUserName><![CDATA[oUser]]></ToUserName>');
    expect(xml).toContain('<FromUserName><![CDATA[gh_bot]]></FromUserName>');
    expect(xml).toContain('hello');
    expect(xml.match(/<xml>/g)?.length).toBe(1);
  });

  it('被动回复密文包可解密还原', async () => {
    const plain = buildTextReply({ FromUserName: 'oUser', ToUserName: 'gh_bot' }, 'hello');
    const timestamp = '1714112445';
    const outer = encryptMessage(
      plain,
      'zhinBot',
      baseConfig.encodingAESKey!,
      baseConfig.appId,
      timestamp,
    );
    const parsed = await import('xml2js').then((m) =>
      new m.Parser({ explicitArray: false }).parseStringPromise(outer),
    );
    const encrypt = parsed.xml.Encrypt as string;
    const msgSignature = createHash('sha1')
      .update(['zhinBot', timestamp, parsed.xml.Nonce as string, encrypt].sort().join(''))
      .digest('hex');
    const decrypted = await decryptMessage(
      outer,
      msgSignature,
      timestamp,
      parsed.xml.Nonce as string,
      'zhinBot',
      baseConfig.encodingAESKey!,
      baseConfig.appId,
    );
    expect(decrypted).toBe(plain);
  });

  it('formats inbound content by msg type', () => {
    expect(formatInboundContent({
      ToUserName: 'gh',
      FromUserName: 'u',
      CreateTime: 1,
      MsgType: 'text',
      Content: 'hi',
    })).toBe('hi');
    expect(formatInboundContent({
      ToUserName: 'gh',
      FromUserName: 'u',
      CreateTime: 1,
      MsgType: 'event',
      Event: 'subscribe',
    })).toContain('subscribe');
  });
});

describe('wechat-mp passive reply ALS', () => {
  it('仅在 ALS 作用域内记录文本', async () => {
    expect(getPassiveReplyCapture()).toBeUndefined();
    recordPassiveReplyText('ignored');
    expect(getPassiveReplyCapture()).toBeUndefined();
    await runWithPassiveReplyCapture(async () => {
      recordPassiveReplyText('first');
      recordPassiveReplyText('second');
      expect(getPassiveReplyCapture()?.text).toBe('second');
    });
  });
});

describe('wechat-mp plugin runtime adapter', () => {
  it('GET 验签通过后回显 echostr', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const config = resolveWeChatMpConfig({
      name: 'bot',
      appId: 'wx-app',
      appSecret: 'sec',
      token: 'plain-token',
      path: '/wechat/webhook',
      encrypt: false,
    });
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway,
      http,
      config,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const timestamp = '1409659589';
    const nonce = '263014780';
    const echostr = 'hello-echo';
    const signature = computeSignatureHash(config.token, { timestamp, nonce });
    const res = await fetch(
      `http://127.0.0.1:${port}/wechat/webhook?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}&echostr=${echostr}`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(echostr);
    await endpoint.stop();
  });

  it('POST 文本消息经 MessageGateway 被动回复 XML', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    // eslint-disable-next-line prefer-const -- assigned after `receive` closes over it
    let endpoint!: WeChatMpEndpoint;
    const receive = vi.fn(async () => {
      // Simulate command $reply → endpoint.send during gateway.receive
      await endpoint.send({ target: 'oUser', payload: 'pong' });
      return Object.freeze({ matched: true, value: 'pong' });
    });
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const config = resolveWeChatMpConfig({
      name: 'bot',
      appId: 'wx-app',
      appSecret: 'sec',
      token: 'plain-token',
      path: '/wechat/webhook',
      encrypt: false,
      replyMode: 'passive',
      passiveReplyTimeoutMs: 2000,
    });
    endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway,
      http,
      config,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const timestamp = '1409659589';
    const nonce = '263014780';
    const signature = computeSignatureHash(config.token, { timestamp, nonce });
    const xml = [
      '<xml>',
      '<ToUserName><![CDATA[gh_bot]]></ToUserName>',
      '<FromUserName><![CDATA[oUser]]></FromUserName>',
      '<CreateTime>1409659589</CreateTime>',
      '<MsgType><![CDATA[text]]></MsgType>',
      '<Content><![CDATA[hello]]></Content>',
      '<MsgId>123</MsgId>',
      '</xml>',
    ].join('');

    const res = await fetch(
      `http://127.0.0.1:${port}/wechat/webhook?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: xml,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<Content><![CDATA[pong]]></Content>');
    expect(body).toContain('<ToUserName><![CDATA[oUser]]></ToUserName>');
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'oUser',
      content: 'hello',
      sender: 'oUser',
    }));
    await endpoint.stop();
  });

  it('closed 时 admit 不投递 gateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: resolveWeChatMpConfig({
        name: 'bot',
        appId: 'wx',
        appSecret: 'sec',
        token: 'tok',
        encrypt: false,
      }),
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    await http.listen();
    endpoint.admit({
      ToUserName: 'gh',
      FromUserName: 'u',
      CreateTime: 1,
      MsgType: 'text',
      Content: 'nope',
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('customer_service 模式出站走客服 API', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const fetchFn = mockFetchOk();
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: resolveWeChatMpConfig({
        name: 'bot',
        appId: 'wx',
        appSecret: 'sec',
        token: 'tok',
        encrypt: false,
        replyMode: 'customer_service',
      }),
      fetch: fetchFn,
    });
    await endpoint.start();
    await http.listen();
    endpoint.open();
    const messageId = await endpoint.send({ target: 'oUser', payload: 'hi' });
    expect(messageId).toBe('42');
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/message/custom/send'),
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          touser: 'oUser',
          msgtype: 'text',
        }),
      }),
    );
    await endpoint.stop();
  });

  it('客服消息遇 40001 刷新 token 后重试一次', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    let tokenCalls = 0;
    let sendCalls = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('/token')) {
        tokenCalls += 1;
        return { data: { access_token: `tok-${tokenCalls}`, expires_in: 7200 } };
      }
      sendCalls += 1;
      // 第一次发送返回 token 失效，刷新后重试成功。
      return sendCalls === 1
        ? { data: { errcode: 40001, errmsg: 'invalid credential' } }
        : { data: { errcode: 0, msgid: 77 } };
    });
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: resolveWeChatMpConfig({
        name: 'bot',
        appId: 'wx',
        appSecret: 'sec',
        token: 'tok',
        encrypt: false,
        replyMode: 'customer_service',
      }),
      fetch: fetchFn,
    });
    await endpoint.start();
    await http.listen();
    endpoint.open();
    const messageId = await endpoint.send({ target: 'oUser', payload: 'hi' });
    expect(messageId).toBe('77');
    expect(sendCalls).toBe(2);
    expect(tokenCalls).toBe(2);
    // 重试用的是刷新后的 token（调用序：token → send → token 刷新 → send 重试）
    const retryUrl = String(fetchFn.mock.calls[3][0]);
    expect(retryUrl).toContain('access_token=tok-2');
    await endpoint.stop();
  });

  it('发送前发现 token 已过期会先刷新', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('/token')) {
        tokenCalls += 1;
        // expires_in < 300 → #tokenExpireTime 立即过期
        return { data: { access_token: `tok-${tokenCalls}`, expires_in: 100 } };
      }
      return { data: { errcode: 0, msgid: 88 } };
    });
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: resolveWeChatMpConfig({
        name: 'bot',
        appId: 'wx',
        appSecret: 'sec',
        token: 'tok',
        encrypt: false,
        replyMode: 'customer_service',
      }),
      fetch: fetchFn,
    });
    await endpoint.start();
    await http.listen();
    endpoint.open();
    const messageId = await endpoint.send({ target: 'oUser', payload: 'hi' });
    expect(messageId).toBe('88');
    // start 一次 + 发送前过期刷新一次
    expect(tokenCalls).toBe(2);
    await endpoint.stop();
  });

  it('同一 MsgId 重推直接回放首次回复，不二次 admit', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    // eslint-disable-next-line prefer-const -- assigned after `receive` closes over it
    let endpoint!: WeChatMpEndpoint;
    const receive = vi.fn(async () => {
      await endpoint.send({ target: 'oUser', payload: 'pong' });
      return Object.freeze({ matched: true, value: 'pong' });
    });
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const config = resolveWeChatMpConfig({
      name: 'bot',
      appId: 'wx-app',
      appSecret: 'sec',
      token: 'plain-token',
      path: '/wechat/webhook',
      encrypt: false,
      replyMode: 'passive',
      passiveReplyTimeoutMs: 2000,
    });
    endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway,
      http,
      config,
      fetch: mockFetchOk(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const timestamp = '1409659589';
    const nonce = '263014780';
    const signature = computeSignatureHash(config.token, { timestamp, nonce });
    const xml = [
      '<xml>',
      '<ToUserName><![CDATA[gh_bot]]></ToUserName>',
      '<FromUserName><![CDATA[oUser]]></FromUserName>',
      '<CreateTime>1409659589</CreateTime>',
      '<MsgType><![CDATA[text]]></MsgType>',
      '<Content><![CDATA[hello]]></Content>',
      '<MsgId>dup-1</MsgId>',
      '</xml>',
    ].join('');
    const url = `http://127.0.0.1:${port}/wechat/webhook?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`;
    const post = () => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: xml,
    });

    const first = await post();
    const firstBody = await first.text();
    expect(firstBody).toContain('<Content><![CDATA[pong]]></Content>');

    const second = await post();
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);
    expect(receive).toHaveBeenCalledTimes(1);
    await endpoint.stop();
  });

  it('无 MsgId 事件消息 id 拼 Event/EventKey 防秒级碰撞', () => {
    const base = { ToUserName: 'gh', FromUserName: 'u', CreateTime: 1700000000 };
    expect(formatInboundId({ ...base, MsgType: 'text', MsgId: 'm-1' })).toBe('m-1');
    expect(formatInboundId({ ...base, MsgType: 'event', Event: 'CLICK', EventKey: 'k1' }))
      .toBe('1700000000:CLICK:k1');
    expect(formatInboundId({ ...base, MsgType: 'event', Event: 'subscribe' }))
      .toBe('1700000000:subscribe');
    // 同秒两个不同事件不再碰撞
    expect(formatInboundId({ ...base, MsgType: 'event', Event: 'CLICK', EventKey: 'k1' }))
      .not.toBe(formatInboundId({ ...base, MsgType: 'event', Event: 'VIEW', EventKey: 'k2' }));
  });
});
