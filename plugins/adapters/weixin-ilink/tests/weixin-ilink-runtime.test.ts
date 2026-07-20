import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import { setContextToken, clearContextTokensForAccount } from '../src/context-store.js';
import { MessageItemType, MessageState, MessageType } from '../src/ilink-types.js';
import {
  formatInboundContent,
  formatOutboundSegments,
  resolveWeixinIlinkConfig,
  type ResolvedWeixinIlinkConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig: ResolvedWeixinIlinkConfig = resolveWeixinIlinkConfig({
  name: 'test-ilink',
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

afterEach(() => {
  clearContextTokensForAccount(baseConfig.name);
  vi.useRealTimers();
});

describe('weixin-ilink protocol helpers', () => {
  it('resolves config from plugin config', () => {
    const resolved = resolveWeixinIlinkConfig({
      name: 'my-wechat',
      botToken: 'tok',
      longPollTimeoutMs: 20_000,
    });
    expect(resolved).toMatchObject({
      context: 'weixin-ilink',
      name: 'my-wechat',
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
      { type: 'image', data: { file: '/tmp/a.png' } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { file: '/tmp/a.png' } },
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
      target: 'user-1',
      content: '你好',
      sender: 'user-1',
      id: '42',
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

    await expect(endpoint.send({ target: 'user-missing', payload: 'hi' }))
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
    setContextToken(baseConfig.name, 'user-1', 'ctx-token');

    const messageId = await endpoint.send({ target: 'user-1', payload: 'hello world' });
    expect(messageId).toBe('mid-1');
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user-1',
      text: 'hello world',
    }));

    await endpoint.stop();
  });
});
