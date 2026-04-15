/**
 * Lark (飞书) 适配器集成测试
 *
 * 策略：Mock 掉 HTTP 传输层（refreshAccessToken / axiosInstance），
 * 测试 Bot 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { LarkAdapter } from '../src/adapter.js';
import { LarkBot } from '../src/bot.js';
import type { LarkBotConfig, LarkMessage } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockLarkBot extends LarkBot {
  sendMock = vi.fn();

  constructor(adapter: LarkAdapter, router: any, config: LarkBotConfig) {
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
    return `lark-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockLarkAdapter extends LarkAdapter {
  createBot(config: LarkBotConfig): MockLarkBot {
    const mockRouter = { post: vi.fn(), get: vi.fn() };
    return new MockLarkBot(this, mockRouter, {
      context: 'lark',
      name: config.name || 'test-bot',
      appId: 'mock-app-id',
      appSecret: 'mock-app-secret',
      webhookPath: '/lark/webhook',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createLarkRawEvent(overrides: Partial<LarkMessage> = {}): LarkMessage {
  return {
    message_id: 'om_msg001',
    chat_id: 'oc_group001',
    sender: {
      sender_id: { open_id: 'ou_user001', user_id: 'user001' },
      sender_type: 'user',
    },
    message_type: 'text',
    content: JSON.stringify({ text: '你好' }),
    create_time: String(FIXED_TS),
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockLarkAdapter, LarkMessage>({
  adapterName: 'lark',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockLarkAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{ name: 'test-bot', context: 'lark', appId: 'a', appSecret: 's', webhookPath: '/wh' }];
    return adapter;
  },
  createRawEvent: () => createLarkRawEvent(),
});

// ============================================================================

describe('Lark 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockLarkAdapter;
  let bot: MockLarkBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/lark-integration.ts');
    adapter = new MockLarkAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{ name: 'test-bot', context: 'lark', appId: 'a', appSecret: 's', webhookPath: '/wh' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockLarkBot;
  });

  afterEach(async () => {
    try { await adapter.stop(); } catch { /* ignore */ }
  });

  describe('Bot 接口合规性', () => {
    it('$id 应为配置的 name', () => {
      expect(bot.$id).toBe('test-bot');
    });

    it('$connected 启动后应为 true', () => {
      expect(bot.$connected).toBe(true);
    });

    it('应实现所有 Bot 接口方法', () => {
      expect(typeof bot.$formatMessage).toBe('function');
      expect(typeof bot.$connect).toBe('function');
      expect(typeof bot.$disconnect).toBe('function');
      expect(typeof bot.$sendMessage).toBe('function');
      expect(typeof bot.$recallMessage).toBe('function');
    });
  });

  describe('生命周期', () => {
    it('start() 应注册 bot', () => {
      expect(adapter.bots.has('test-bot')).toBe(true);
    });

    it('stop() 应清空 bots', async () => {
      await adapter.stop();
      expect(adapter.bots.size).toBe(0);
    });
  });

  describe('$formatMessage 消息格式化', () => {
    it('群消息应正确格式化 (chat_id 以 oc_ 开头)', () => {
      const raw = createLarkRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('om_msg001');
      expect(msg.$adapter).toBe('lark');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('ou_user001');
      expect(msg.$channel.id).toBe('oc_group001');
      expect(msg.$channel.type).toBe('group');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化 (chat_id 不以 oc_ 开头)', () => {
      const raw = createLarkRawEvent({ chat_id: 'p2p_private001' });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createLarkRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'lark',
        bot: 'test-bot',
        id: 'oc_group001',
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
      const raw = createLarkRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'lark' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createLarkRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
