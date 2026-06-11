/**
 * DingTalk 适配器集成测试
 *
 * 策略：Mock 掉 HTTP 传输层（refreshAccessToken / request），测试 Endpoint 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { DingTalkAdapter } from '../src/adapter.js';
import { DingTalkEndpoint } from '../src/endpoint.js';
import type { DingTalkEndpointConfig, DingTalkMessage } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot：重写 $connect/$disconnect/$sendMessage/$recallMessage ──

class MockDingTalkEndpoint extends DingTalkEndpoint {
  sendMock = vi.fn();

  constructor(adapter: DingTalkAdapter, router: any, config: DingTalkEndpointConfig) {
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
    return `dingtalk-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {
    // DingTalk 不支持撤回
  }
}

// ── Mock Adapter ──

class MockDingTalkAdapter extends DingTalkAdapter {
  createEndpoint(config: DingTalkEndpointConfig): DingTalkEndpoint {
    const mockRouter = { post: vi.fn(), get: vi.fn() };
    return new MockDingTalkEndpoint(this, mockRouter, {
      context: 'dingtalk',
      name: config.name || 'test-endpoint',
      appKey: 'mock-key',
      appSecret: 'mock-secret',
      webhookPath: '/dingtalk/webhook',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createDingTalkRawEvent(overrides: Partial<DingTalkMessage> = {}): DingTalkMessage {
  return {
    msgId: 'dt-msg-001',
    conversationType: '2',
    conversationId: 'conv-001',
    senderId: 'sender-001',
    senderNick: '测试用户',
    text: { content: '你好' },
    createAt: FIXED_TS,
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockDingTalkAdapter, DingTalkMessage>({
  adapterName: 'dingtalk',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockDingTalkAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{
      context: 'dingtalk' as const, name: 'test-endpoint',
      appKey: 'mock-key', appSecret: 'mock-secret', webhookPath: '/dingtalk/webhook',
    }];
    return adapter;
  },
  createRawEvent: () => createDingTalkRawEvent(),
});

// ============================================================================

describe('DingTalk 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockDingTalkAdapter;
  let endpoint: MockDingTalkEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/dingtalk-integration.ts');
    adapter = new MockDingTalkAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{ name: 'test-endpoint', context: 'dingtalk', appKey: 'k', appSecret: 's', webhookPath: '/wh' }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockDingTalkEndpoint;
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
    it('群消息应正确格式化', () => {
      const raw = createDingTalkRawEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBe('dt-msg-001');
      expect(msg.$adapter).toBe('dingtalk');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBe('sender-001');
      expect(msg.$channel.id).toBe('conv-001');
      expect(msg.$channel.type).toBe('group');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化', () => {
      const raw = createDingTalkRawEvent({ conversationType: '1' });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应精确匹配 createAt', () => {
      const raw = createDingTalkRawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'dingtalk',
        endpoint: 'test-endpoint',
        id: 'conv-001',
        type: 'group',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createDingTalkRawEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'dingtalk' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createDingTalkRawEvent();
      const msg = endpoint.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
