/**
 * WeCom 适配器集成测试
 *
 * 策略：Mock 掉 HTTP 传输层（refreshAccessToken / request），测试 Endpoint 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { WecomAdapter } from '../src/adapter.js';
import { WecomEndpoint } from '../src/endpoint.js';
import type { WecomEndpointConfig, WecomMessage } from '../src/types.ts';

const FIXED_TS = 1700000000;
const FIXED_TS_MS = FIXED_TS * 1000;

// ── Mock Bot：重写 $connect/$disconnect/$sendMessage/$recallMessage ──

class MockWecomEndpoint extends WecomEndpoint {
  sendMock = vi.fn();

  constructor(adapter: WecomAdapter, router: any, config: WecomEndpointConfig) {
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
    return `wecom-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {
    // WeCom 不支持撤回
  }
}

// ── Mock Adapter ──

class MockWecomAdapter extends WecomAdapter {
  createEndpoint(config: WecomEndpointConfig): WecomEndpoint {
    const mockRouter = { post: vi.fn(), get: vi.fn() };
    return new MockWecomEndpoint(this, mockRouter, {
      context: 'wecom',
      name: config.name || 'test-endpoint',
      corpId: 'mock-corpid',
      agentSecret: 'mock-agent-secret',
      token: 'mock-token',
      encodingAESKey: 'mock-aes-key-43chars-long-enough-for-base64',
      webhookPath: '/wecom/callback',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createWecomRawMessage(overrides: Partial<WecomMessage> = {}): WecomMessage {
  return {
    ToUserName: 'mock-corpid',
    FromUserName: 'user001@test',
    CreateTime: FIXED_TS,
    MsgType: 'text',
    Content: '你好',
    MsgId: 'wecom-msg-001',
    AgentID: '1000002',
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockWecomAdapter, WecomMessage>({
  adapterName: 'wecom',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockWecomAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{
      context: 'wecom' as const, name: 'test-endpoint',
      corpId: 'mock-corpid', agentId: 'mock-agent-secret',
      token: 'mock-token', encodingAESKey: 'mock-aes-key-43chars-long-enough-for-base64',
      webhookPath: '/wecom/callback',
    }];
    return adapter;
  },
  createRawEvent: () => createWecomRawMessage(),
});

// ============================================================================

describe('WeCom 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockWecomAdapter;
  let endpoint: MockWecomEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/wecom-integration.ts');
    adapter = new MockWecomAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{
      name: 'test-endpoint', context: 'wecom',
      corpId: 'mock-corpid', agentId: 'mock-agent-secret',
      token: 'mock-token', encodingAESKey: 'mock-aes-key-43chars-long-enough-for-base64',
      webhookPath: '/wecom/callback',
    }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockWecomEndpoint;
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
      const raw = createWecomRawMessage();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBe('wecom-msg-001');
      expect(msg.$adapter).toBe('wecom');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBe('user001@test');
      expect(msg.$channel.id).toBe('user001@test');
      expect(msg.$channel.type).toBe('private');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('群消息应正确格式化', () => {
      const raw = createWecomRawMessage({ FromUserName: 'group001@chatroom' });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('group');
      expect(msg.$channel.id).toBe('group001@chatroom');
    });

    it('$timestamp 应精确匹配 CreateTime * 1000', () => {
      const raw = createWecomRawMessage();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS_MS);
    });

    it('图片消息应正确格式化', () => {
      const raw = createWecomRawMessage({
        MsgType: 'image',
        MediaId: 'media-001',
        PicUrl: 'https://example.com/pic.jpg',
      });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$content.length).toBeGreaterThan(0);
      expect(msg.$content[0].type).toBe('image');
    });

    it('事件消息应正确格式化', () => {
      const raw = createWecomRawMessage({
        MsgType: 'event',
        Event: 'subscribe',
        EventKey: '',
      });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$content.length).toBeGreaterThan(0);
      expect(msg.$content[0].type).toBe('text');
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'wecom',
        endpoint: 'test-endpoint',
        id: 'user001@test',
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
      const raw = createWecomRawMessage();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'wecom' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createWecomRawMessage();
      const msg = endpoint.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
