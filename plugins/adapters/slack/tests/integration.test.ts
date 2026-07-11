/**
 * Slack 适配器集成测试
 *
 * 策略：Mock 掉 WebClient 和传输层，
 * 测试 Endpoint 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { SlackAdapter } from '../src/adapter.js';
import { SlackEndpoint } from '../src/endpoint.js';
import type { SlackEndpointConfig } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Endpoint ──

class MockSlackEndpoint extends SlackEndpoint {
  sendMock = vi.fn();

  constructor(adapter: SlackAdapter, config: SlackEndpointConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.sendMock(options);
    return `slack-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockSlackAdapter extends SlackAdapter {
  createEndpoint(config: SlackEndpointConfig): MockSlackEndpoint {
    return new MockSlackEndpoint(this, {
      context: 'slack',
      name: config.name || 'test-endpoint',
      token: 'xoxb-mock-token',
      signingSecret: 'mock-signing-secret',
      ...config,
    });
  }
}

// ── 原始消息工厂（模拟 Slack 消息事件）──

function createSlackRawEvent(overrides: any = {}): any {
  return {
    type: 'message',
    ts: '1700000000.000000',
    user: 'U12345',
    username: 'testuser',
    channel: 'C001',
    channel_type: 'channel',
    text: '你好世界',
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockSlackAdapter, any>({
  adapterName: 'slack',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockSlackAdapter(plugin);
    (adapter as any).config = [{
      name: 'test-endpoint', context: 'slack',
      token: 'xoxb-mock', signingSecret: 'mock',
    }];
    return adapter;
  },
  createRawEvent: () => createSlackRawEvent(),
});

// ============================================================================

describe('Slack 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockSlackAdapter;
  let endpoint: MockSlackEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/slack-integration.ts');
    adapter = new MockSlackAdapter(plugin);
    (adapter as any).config = [{
      name: 'test-endpoint', context: 'slack',
      token: 'xoxb-mock', signingSecret: 'mock',
    }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockSlackEndpoint;
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
    it('频道消息应正确格式化', () => {
      const raw = createSlackRawEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBe('C001:1700000000.000000');
      expect(msg.$adapter).toBe('slack');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBe('U12345');
      expect(msg.$channel.id).toBe('C001');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好世界');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('DM 应格式化为 private 类型', () => {
      const raw = createSlackRawEvent({ channel_type: 'im' });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createSlackRawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });

    it('thread_ts 应映射为 $quote_id', () => {
      const raw = createSlackRawEvent({ thread_ts: '1699999999.000000' });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$quote_id).toBe('1699999999.000000');
    });

    it('thread_ts 等于 ts 时 $quote_id 应为 undefined', () => {
      const raw = createSlackRawEvent({ thread_ts: '1700000000.000000' });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$quote_id).toBeUndefined();
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'slack',
        endpoint: 'test-endpoint',
        id: 'C001',
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
      const raw = createSlackRawEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'slack' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createSlackRawEvent();
      const msg = endpoint.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });

  describe('adapter interactivePolicy', () => {
    it('should be native', () => {
      expect(SlackAdapter.interactivePolicy).toBe('native');
    });
  });

  describe('editMessage', () => {
    it('editMessage 应调用 endpoint.$editMessage', async () => {
      const editSpy = vi.spyOn(endpoint, '$editMessage').mockResolvedValue();
      await adapter.editMessage('test-endpoint', 'C001', '1700000000.000000', [
        { type: 'text', data: { text: 'updated' } },
      ]);
      expect(editSpy).toHaveBeenCalledWith(expect.objectContaining({
        messageId: '1700000000.000000',
        context: 'slack',
        endpoint: 'test-endpoint',
        id: 'C001',
        type: 'group',
      }));
    });

    it('core EditMessageOptions 应委托 super.editMessage', async () => {
      const editSpy = vi.spyOn(endpoint, '$editMessage').mockResolvedValue();
      const result = await adapter.editMessage({
        messageId: 'C001:1700000000.000000',
        context: 'slack',
        endpoint: 'test-endpoint',
        id: 'C001',
        type: 'group',
        content: [{ type: 'text', data: { text: 'updated' } }],
      });
      expect(editSpy).toHaveBeenCalled();
      expect(result).toBe('C001:1700000000.000000');
    });
  });
});
