/**
 * WeChat MP (微信公众号) 适配器集成测试
 *
 * 策略：Mock 掉 HTTP 传输层和路由，测试 Endpoint 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { WeChatMPAdapter } from '../src/adapter.js';
import { WeChatMPEndpoint } from '../src/endpoint.js';
import type { WeChatMPConfig, WeChatMessage } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Endpoint ──

class MockWeChatMPEndpoint extends WeChatMPEndpoint {
  sendMock = vi.fn();

  constructor(adapter: WeChatMPAdapter, router: any, config: WeChatMPConfig) {
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
    return `wechat-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {
    // 微信公众号不支持撤回
  }
}

// ── Mock Adapter ──

class MockWeChatMPAdapter extends WeChatMPAdapter {
  createEndpoint(config: WeChatMPConfig): MockWeChatMPEndpoint {
    const mockRouter = { post: vi.fn(), get: vi.fn() };
    return new MockWeChatMPEndpoint(this, mockRouter, {
      context: 'wechat-mp',
      name: config.name || 'test-endpoint',
      appId: 'mock-app-id',
      appSecret: 'mock-app-secret',
      token: 'mock-token',
      path: '/wechat/webhook',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createWeChatRawEvent(overrides: Partial<WeChatMessage> = {}): WeChatMessage {
  return {
    ToUserName: 'gh_bot_account',
    FromUserName: 'oUser001',
    CreateTime: Math.floor(FIXED_TS / 1000),
    MsgType: 'text',
    MsgId: 'wx-msg-001',
    Content: '你好',
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockWeChatMPAdapter, WeChatMessage>({
  adapterName: 'wechat-mp',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const mockRouter = { post: vi.fn(), get: vi.fn() };
    const adapter = new MockWeChatMPAdapter(plugin, mockRouter as any);
    (adapter as any).config = [{
      name: 'test-endpoint', context: 'wechat-mp',
      appId: 'aid', appSecret: 'as', token: 'tk', path: '/wh',
    }];
    return adapter;
  },
  createRawEvent: () => createWeChatRawEvent(),
});

// ============================================================================

describe('WeChat MP 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockWeChatMPAdapter;
  let endpoint: MockWeChatMPEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/wechat-mp-integration.ts');
    const mockRouter = { post: vi.fn(), get: vi.fn() };
    adapter = new MockWeChatMPAdapter(plugin, mockRouter as any);
    (adapter as any).config = [{
      name: 'test-endpoint', context: 'wechat-mp',
      appId: 'aid', appSecret: 'as', token: 'tk', path: '/wh',
    }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockWeChatMPEndpoint;
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
  });

  describe('$formatMessage 消息格式化', () => {
    it('公众号消息应格式化为 private 类型', () => {
      const raw = createWeChatRawEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBe('wx-msg-001');
      expect(msg.$adapter).toBe('wechat-mp');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBe('oUser001');
      expect(msg.$channel.id).toBe('oUser001');
      expect(msg.$channel.type).toBe('private');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('$timestamp 应为毫秒级正整数', () => {
      const raw = createWeChatRawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'wechat-mp',
        endpoint: 'test-endpoint',
        id: 'oUser001',
        type: 'private',
        content: [{ type: 'text', data: { text: '回复' } }],
      });
      expect(typeof result).toBe('string');
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createWeChatRawEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'wechat-mp' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createWeChatRawEvent();
      const msg = endpoint.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
