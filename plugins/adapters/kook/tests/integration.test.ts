/**
 * Kook 适配器集成测试
 *
 * 策略：Mock 掉 kook-client 的 Client 层（$connect/$disconnect/$sendMessage），
 * 测试 Bot 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { KookAdapter } from '../src/adapter.js';
import { KookBot } from '../src/bot.js';
import type { KookBotConfig } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockKookBot extends KookBot {
  sendMock = vi.fn();

  constructor(adapter: KookAdapter, config: KookBotConfig) {
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
    return `kook-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockKookAdapter extends KookAdapter {
  createBot(config: KookBotConfig): MockKookBot {
    return new MockKookBot(this, {
      context: 'kook',
      name: config.name || 'test-bot',
      token: 'mock-token',
      ...config,
    });
  }
}

// ── 原始消息工厂（模拟 kook-client 消息结构）──

function createKookRawEvent(overrides: any = {}): any {
  return {
    message_id: 'kook-msg-001',
    message_type: 'channel',
    author_id: 'user-001',
    message: '你好世界',
    raw_message: '你好世界',
    timestamp: FIXED_TS,
    channel_id: 'ch-001',
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockKookAdapter, any>({
  adapterName: 'kook',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockKookAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'kook', token: 'mock-token' }];
    return adapter;
  },
  createRawEvent: () => createKookRawEvent(),
});

// ============================================================================

describe('Kook 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockKookAdapter;
  let bot: MockKookBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/kook-integration.ts');
    adapter = new MockKookAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'kook', token: 'mock-token' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockKookBot;
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
    it('频道消息应正确格式化', () => {
      const raw = createKookRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBeDefined();
      expect(msg.$adapter).toBe('kook');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBeDefined();
      expect(msg.$channel.id).toBe('ch-001');
      expect(msg.$channel.type).toBe('channel');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应格式化为 private', () => {
      const raw = createKookRawEvent({ message_type: 'private', channel_id: undefined });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createKookRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'kook',
        bot: 'test-bot',
        id: 'ch-001',
        type: 'channel',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createKookRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'kook' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createKookRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
