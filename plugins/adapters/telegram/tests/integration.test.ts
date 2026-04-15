/**
 * Telegram 适配器集成测试
 *
 * 策略：Mock 掉 Telegraf SDK 层（$connect/$disconnect/$sendMessage），
 * 测试 Bot 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { TelegramAdapter } from '../src/adapter.js';
import { TelegramBot } from '../src/bot.js';
import type { TelegramBotConfig } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockTelegramBot extends TelegramBot {
  sendMock = vi.fn();

  constructor(adapter: TelegramAdapter, config: TelegramBotConfig) {
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
    return `tg-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockTelegramAdapter extends TelegramAdapter {
  createBot(config: TelegramBotConfig): MockTelegramBot {
    return new MockTelegramBot(this, {
      context: 'telegram',
      name: config.name || 'test-bot',
      token: 'mock:telegram-token',
      ...config,
    });
  }
}

// ── 原始消息工厂（模拟 Telegram Message 结构）──

function createTelegramRawEvent(overrides: any = {}): any {
  return {
    message_id: 12345,
    from: { id: 99999, first_name: 'Test', username: 'testuser' },
    chat: { id: -100001, type: 'group' },
    text: '你好世界',
    date: Math.floor(FIXED_TS / 1000),
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockTelegramAdapter, any>({
  adapterName: 'telegram',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockTelegramAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'telegram', token: 'mock:telegram-token' }];
    return adapter;
  },
  createRawEvent: () => createTelegramRawEvent(),
});

// ============================================================================

describe('Telegram 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockTelegramAdapter;
  let bot: MockTelegramBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/telegram-integration.ts');
    adapter = new MockTelegramAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'telegram', token: 'mock:telegram-token' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockTelegramBot;
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
      const raw = createTelegramRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('12345');
      expect(msg.$adapter).toBe('telegram');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('99999');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好世界');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应格式化为 private', () => {
      const raw = createTelegramRawEvent({
        chat: { id: 77777, type: 'private' },
      });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应为毫秒级正整数', () => {
      const raw = createTelegramRawEvent();
      const msg = bot.$formatMessage(raw);
      // Telegram uses date * 1000
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'telegram',
        bot: 'test-bot',
        id: '-100001',
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
      const raw = createTelegramRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'telegram' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createTelegramRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
