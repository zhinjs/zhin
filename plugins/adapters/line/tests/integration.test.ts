/**
 * LINE Messaging API 适配器集成测试
 *
 * 策略：Mock 掉 LINE API 层（$connect/$disconnect/$sendMessage），
 * 测试 Endpoint 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { LineAdapter } from '../src/adapter.js';
import { LineEndpoint } from '../src/endpoint.js';
import type { LineEndpointConfig, LineEvent } from '../src/types.js';
import type { Router } from '@zhin.js/host-router/router';

const FIXED_TS = 1700000000000;

// ── Mock Router ──

function createMockRouter(): Router {
  return {
    post: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    put: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  } as unknown as Router;
}

// ── Mock Endpoint ──

class MockLineEndpoint extends LineEndpoint {
  sendMock = vi.fn();

  constructor(adapter: LineAdapter, router: Router, config: LineEndpointConfig) {
    super(adapter, router, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.sendMock(options);
    return `line-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockLineAdapter extends LineAdapter {
  #mockRouter: Router;
  constructor(plugin: Plugin) {
    const router = createMockRouter();
    super(plugin, router);
    this.#mockRouter = router;
  }

  createEndpoint(config: LineEndpointConfig): MockLineEndpoint {
    return new MockLineEndpoint(this, this.#mockRouter, {
      context: 'line',
      name: config.name || 'test-endpoint',
      channelSecret: 'test-channel-secret',
      channelAccessToken: 'test-access-token',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createLineTextEvent(overrides: Partial<LineEvent> = {}): LineEvent {
  return {
    type: 'message',
    message: {
      id: 'msg-001',
      type: 'text',
      text: 'Hello LINE',
    },
    source: {
      type: 'user',
      userId: 'U12345',
    },
    replyToken: 'reply-token-001',
    timestamp: FIXED_TS,
    ...overrides,
  };
}

function createLineGroupEvent(overrides: Partial<LineEvent> = {}): LineEvent {
  return {
    type: 'message',
    message: {
      id: 'msg-002',
      type: 'text',
      text: 'group message',
    },
    source: {
      type: 'group',
      userId: 'U12345',
      groupId: 'G67890',
    },
    replyToken: 'reply-token-002',
    timestamp: FIXED_TS,
    ...overrides,
  };
}

// ── Harness 标准测试套件 ──

createAdapterTestSuite<MockLineAdapter, LineEvent>({
  adapterName: 'line',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockLineAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'line', channelSecret: 'test', channelAccessToken: 'test' }];
    return adapter;
  },
  createRawEvent: () => createLineTextEvent(),
});

// ── LINE 适配器特定测试 ──

describe('LINE 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockLineAdapter;
  let endpoint: MockLineEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/line-integration.ts');
    adapter = new MockLineAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'line', channelSecret: 'test', channelAccessToken: 'test' }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockLineEndpoint;
  });

  afterEach(async () => {
    try { await adapter.stop(); } catch { /* ignore */ }
  });

  describe('Endpoint 接口合规性', () => {
    it('$id 应为配置的 name', () => {
      expect(endpoint.$id).toBe('test-endpoint');
    });

    it('$connected 启动后应为 true', () => {
      expect(endpoint.$connected).toBe(true);
    });

    it('应实现所有 Endpoint 接口方法', () => {
      expect(typeof endpoint.$formatMessage).toBe('function');
      expect(typeof endpoint.$connect).toBe('function');
      expect(typeof endpoint.$disconnect).toBe('function');
      expect(typeof endpoint.$sendMessage).toBe('function');
      expect(typeof endpoint.$recallMessage).toBe('function');
    });
  });

  describe('生命周期', () => {
    it('start() 应注册 endpoint', () => {
      expect(adapter.endpoints.has('test-endpoint')).toBe(true);
    });

    it('stop() 应清空 endpoints', async () => {
      await adapter.stop();
      expect(adapter.endpoints.size).toBe(0);
    });

    it('stop() 后 endpoint 应 disconnected', async () => {
      await adapter.stop();
      expect(endpoint.$connected).toBe(false);
    });
  });

  describe('$formatMessage 消息格式化', () => {
    it('私聊消息应正确格式化', () => {
      const raw = createLineTextEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBe('msg-001');
      expect(msg.$adapter).toBe('line');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBe('U12345');
      expect(msg.$channel.type).toBe('private');
      expect(msg.$channel.id).toBe('U12345');
      expect(msg.$raw).toBe('Hello LINE');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('群消息应格式化为 group', () => {
      const raw = createLineGroupEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('group');
      expect(msg.$channel.id).toBe('G67890');
    });

    it('$timestamp 应为事件时间戳', () => {
      const raw = createLineTextEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });

    it('follow 事件应格式化为系统消息', () => {
      const raw: LineEvent = {
        type: 'follow',
        source: { type: 'user', userId: 'U99999' },
        replyToken: 'rp-follow',
        timestamp: FIXED_TS,
      };
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
      expect(msg.$raw).toBe('[follow]');
    });

    it('join 事件应格式化为系统消息', () => {
      const raw: LineEvent = {
        type: 'join',
        source: { type: 'group', groupId: 'G11111', userId: 'U22222' },
        replyToken: 'rp-join',
        timestamp: FIXED_TS,
      };
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('[join]');
    });

    it('image 消息应返回 image segment', () => {
      const raw: LineEvent = {
        type: 'message',
        message: { id: 'img-001', type: 'image' },
        source: { type: 'user', userId: 'U12345' },
        timestamp: FIXED_TS,
      };
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$content[0].type).toBe('image');
    });

    it('sticker 消息应返回 sticker segment', () => {
      const raw: LineEvent = {
        type: 'message',
        message: { id: 'stk-001', type: 'sticker', packageId: '1', stickerId: '100' },
        source: { type: 'user', userId: 'U12345' },
        timestamp: FIXED_TS,
      };
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$content[0].type).toBe('sticker');
      expect(msg.$content[0].data.package_id).toBe('1');
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'line',
        endpoint: 'test-endpoint',
        id: 'U12345',
        type: 'private',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createLineTextEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'line' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createLineTextEvent();
      const msg = endpoint.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });

  describe('签名验证', () => {
    it('verifySignature 应验证正确的 HMAC-SHA256 签名', () => {
      // endpoint.$config.channelSecret is 'test' (set via adapter config spread)
      const secret = endpoint.$config.channelSecret;
      const body = '{"events":[]}';
      const hmac = createHmac('sha256', secret);
      hmac.update(body);
      const validSignature = hmac.digest('base64');

      // 访问 private method via cast
      expect((endpoint as any).verifySignature(body, validSignature)).toBe(true);
      expect((endpoint as any).verifySignature(body, 'invalid-signature')).toBe(false);
    });
  });
});
