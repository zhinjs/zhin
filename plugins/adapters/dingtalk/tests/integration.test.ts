/**
 * DingTalk 适配器集成测试
 *
 * 策略：Mock 掉 HTTP 传输层（refreshAccessToken / request），测试 Bot 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { DingTalkAdapter } from '../src/adapter.js';
import { DingTalkBot } from '../src/bot.js';
import type { DingTalkBotConfig, DingTalkMessage } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot：重写 $connect/$disconnect/$sendMessage/$recallMessage ──

class MockDingTalkBot extends DingTalkBot {
  sendMock = vi.fn();

  constructor(adapter: DingTalkAdapter, router: any, config: DingTalkBotConfig) {
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
  createBot(config: DingTalkBotConfig): DingTalkBot {
    const mockRouter = { post: vi.fn(), get: vi.fn() };
    return new MockDingTalkBot(this, mockRouter, {
      context: 'dingtalk',
      name: config.name || 'test-bot',
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
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockDingTalkAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{
      context: 'dingtalk' as const, name: 'test-bot',
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
  let bot: MockDingTalkBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/dingtalk-integration.ts');
    adapter = new MockDingTalkAdapter(plugin, { post: vi.fn(), get: vi.fn() });
    (adapter as any).config = [{ name: 'test-bot', context: 'dingtalk', appKey: 'k', appSecret: 's', webhookPath: '/wh' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockDingTalkBot;
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

    it('stop() 后 bot 应 disconnected', async () => {
      await adapter.stop();
      expect(bot.$connected).toBe(false);
    });
  });

  describe('$formatMessage 消息格式化', () => {
    it('群消息应正确格式化', () => {
      const raw = createDingTalkRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('dt-msg-001');
      expect(msg.$adapter).toBe('dingtalk');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('sender-001');
      expect(msg.$channel.id).toBe('conv-001');
      expect(msg.$channel.type).toBe('group');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化', () => {
      const raw = createDingTalkRawEvent({ conversationType: '1' });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应精确匹配 createAt', () => {
      const raw = createDingTalkRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'dingtalk',
        bot: 'test-bot',
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
      const msg = bot.$formatMessage(raw);

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
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
