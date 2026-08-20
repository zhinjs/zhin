import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import {
  setContextToken,
  clearContextTokensForAccount,
  flushContextTokenPersist,
} from '../src/context-store.js';
import { saveSyncBuf } from '../src/credentials.js';
import { MessageItemType, MessageState, MessageType } from '../src/ilink-types.js';
import {
  formatInboundContent,
  formatOutboundSegments,
  resolveWeixinIlinkConfig,
  type ResolvedWeixinIlinkConfig,
} from '../src/protocol.js';

vi.mock('../src/credentials.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/credentials.js')>();
  return { ...actual, saveSyncBuf: vi.fn(actual.saveSyncBuf) };
});

const mockedSaveSyncBuf = vi.mocked(saveSyncBuf);

const adapterFeature = featureId('zhin.adapter');

const testEndpointId = String(capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'));

function privateConversation(userId: string) {
  return {
    endpoint: { id: testEndpointId, adapter: testEndpointId.split('\0')[0] ?? testEndpointId },
    kind: 'private' as const,
    id: userId,
  };
}

const baseConfig: ResolvedWeixinIlinkConfig = resolveWeixinIlinkConfig({
  id: 'test-ilink',
  botToken: 'test-token',
  longPollTimeoutMs: 1000,
});

function idleGetUpdates(opts: { abortSignal?: AbortSignal }) {
  return new Promise<{ msgs: []; get_updates_buf: string }>((resolve) => {
    if (opts.abortSignal?.aborted) {
      resolve({ msgs: [], get_updates_buf: '' });
      return;
    }
    opts.abortSignal?.addEventListener('abort', () => {
      resolve({ msgs: [], get_updates_buf: '' });
    }, { once: true });
  });
}

let tmpDataDir: string;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-ilink-test-'));
  vi.stubEnv('ZHIN_DATA_DIR', tmpDataDir);
  mockedSaveSyncBuf.mockClear();
});

afterEach(() => {
  clearContextTokensForAccount(baseConfig.id);
  flushContextTokenPersist();
  vi.unstubAllEnvs();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('weixin-ilink protocol helpers', () => {
  it('resolves config from plugin config', () => {
    const resolved = resolveWeixinIlinkConfig({
      id: 'my-wechat',
      botToken: 'tok',
      longPollTimeoutMs: 20_000,
    });
    expect(resolved).toMatchObject({
      context: 'weixin-ilink',
      id: 'my-wechat',
      botToken: 'tok',
      longPollTimeoutMs: 20_000,
    });
    expect(resolved.baseUrl).toContain('ilinkai.weixin.qq.com');
  });

  it('formats inbound text and media placeholders', () => {
    expect(formatInboundContent({
      from_user_id: 'u1',
      to_user_id: 'bot',
      client_id: 'c1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'hello' } }],
    })).toBe('hello');

    expect(formatInboundContent({
      from_user_id: 'u1',
      to_user_id: 'bot',
      client_id: 'c1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'hi' } }],
      _media: { decryptedPicPath: '/tmp/a.png' },
    })).toContain('[image: /tmp/a.png]');
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundSegments('pong')).toEqual([{ type: 'text', data: { text: 'pong' } }]);
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png' } } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png' } } },
    ]);
  });
});

describe('weixin-ilink plugin runtime adapter', () => {
  it('routes admitted messages through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new WeixinIlinkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
      gateway,
      config: baseConfig,
      resolveCredentials: async () => ({ botToken: 'tok' }),
    });

    endpoint.open();
    endpoint.admit({
      from_user_id: 'user-1',
      to_user_id: 'bot',
      client_id: 'c1',
      message_id: 42,
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: 'ctx-1',
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: '你好' } }],
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: privateConversation('user-1'),
      message: { conversation: privateConversation('user-1'), id: '42' },
      content: '你好',
      sender: expect.objectContaining({ id: 'user-1' }),
    }));
  });

  it('does not admit when closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new WeixinIlinkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
      gateway,
      config: baseConfig,
      resolveCredentials: async () => ({ botToken: 'tok' }),
    });

    endpoint.admit({
      from_user_id: 'user-1',
      to_user_id: 'bot',
      client_id: 'c1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'x' } }],
    });

    await Promise.resolve();
    expect(receive).not.toHaveBeenCalled();
  });

  it('refuses send without context_token', async () => {
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const endpoint = new WeixinIlinkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
      gateway,
      config: baseConfig,
      resolveCredentials: async () => ({ botToken: 'tok' }),
      notifyStart: vi.fn(async () => undefined),
      notifyStop: vi.fn(async () => undefined),
      getUpdates: idleGetUpdates as never,
    });
    await endpoint.start();
    endpoint.open();

    await expect(endpoint.send({ conversation: privateConversation('user-missing'), payload: 'hi' }))
      .rejects.toThrow(/missing context_token/);

    await endpoint.stop();
  });

  it('sends text when context_token is present', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'mid-1' }));
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const endpoint = new WeixinIlinkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
      gateway,
      config: baseConfig,
      resolveCredentials: async () => ({ botToken: 'tok', baseUrl: 'https://ilink.mock' }),
      notifyStart: vi.fn(async () => undefined),
      notifyStop: vi.fn(async () => undefined),
      getUpdates: idleGetUpdates as never,
      sendText: sendText as never,
    });

    await endpoint.start();
    endpoint.open();
    setContextToken(baseConfig.id, 'user-1', 'ctx-token');

    const messageId = await endpoint.send({ conversation: privateConversation('user-1'), payload: 'hello world' });
    expect(messageId).toBe('mid-1');
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user-1',
      text: 'hello world',
    }));

    await endpoint.stop();
  });

  it('分发成功后才推进 sync buf（崩溃不丢消息）', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    let polled = 0;
    const endpoint = new WeixinIlinkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      resolveCredentials: async () => ({ botToken: 'tok' }),
      notifyStart: vi.fn(async () => undefined),
      notifyStop: vi.fn(async () => undefined),
      getUpdates: (async (opts: { abortSignal?: AbortSignal }) => {
        polled += 1;
        if (polled === 1) {
          return {
            get_updates_buf: 'buf-1',
            msgs: [{
              from_user_id: 'user-1',
              to_user_id: 'bot',
              client_id: 'c1',
              message_id: 42,
              message_type: MessageType.USER,
              message_state: MessageState.FINISH,
              item_list: [{ type: MessageItemType.TEXT, text_item: { text: '你好' } }],
            }],
          };
        }
        return idleGetUpdates(opts);
      }) as never,
    });

    endpoint.open();
    await endpoint.start();
    await vi.waitFor(() => {
      expect(mockedSaveSyncBuf).toHaveBeenCalledWith(baseConfig.id, 'buf-1');
    });
    expect(receive).toHaveBeenCalled();
    // 旧实现先 saveSyncBuf 再分发；现在必须先 receive 后推进 buf
    expect(receive.mock.invocationCallOrder[0]!)
      .toBeLessThan(mockedSaveSyncBuf.mock.invocationCallOrder[0]!);
    await endpoint.stop();
  });

  it('context token 防抖批量落盘', () => {
    setContextToken(baseConfig.id, 'u1', 't1');
    setContextToken(baseConfig.id, 'u2', 't2');
    const file = path.join(
      tmpDataDir,
      'weixin-ilink',
      'context-tokens',
      `${baseConfig.id}.context-tokens.json`,
    );
    // 防抖窗口内不落盘
    expect(fs.existsSync(file)).toBe(false);
    flushContextTokenPersist(baseConfig.id);
    expect(fs.existsSync(file)).toBe(true);
    const tokens = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>;
    expect(tokens).toEqual({ u1: 't1', u2: 't2' });
  });

  it('start 时清扫超过 TTL 的入站媒体', async () => {
    const mediaDir = path.join(tmpDataDir, 'weixin-ilink', 'media', 'inbound');
    fs.mkdirSync(mediaDir, { recursive: true });
    const oldFile = path.join(mediaDir, 'old.png');
    const newFile = path.join(mediaDir, 'new.png');
    fs.writeFileSync(oldFile, 'old');
    fs.writeFileSync(newFile, 'new');
    const oldTime = new Date(Date.now() - 48 * 3_600_000);
    fs.utimesSync(oldFile, oldTime, oldTime);

    const endpoint = new WeixinIlinkEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      resolveCredentials: async () => ({ botToken: 'tok' }),
      notifyStart: vi.fn(async () => undefined),
      notifyStop: vi.fn(async () => undefined),
      getUpdates: idleGetUpdates as never,
    });
    await endpoint.start();
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
    await endpoint.stop();
  });
});
