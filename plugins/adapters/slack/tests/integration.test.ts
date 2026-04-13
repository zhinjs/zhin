/**
 * Slack 适配器集成测试
 *
 * 策略：Mock 掉 @slack/bolt App 和 WebClient，
 * 测试 Bot 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { SlackAdapter } from '../src/adapter.js';
import { SlackBot } from '../src/bot.js';
import type { SlackBotConfig } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockSlackBot extends SlackBot {
  sendMock = vi.fn();

  constructor(adapter: SlackAdapter, config: SlackBotConfig) {
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
  createBot(config: SlackBotConfig): MockSlackBot {
    return new MockSlackBot(this, {
      context: 'slack',
      name: config.name || 'test-bot',
      token: 'xoxb-mock-token',
      signingSecret: 'mock-signing-secret',
      ...config,
    });
  }
}

// ── 原始消息工厂（模拟 Slack 消息事件）──

function createSlackRawEvent(overrides: any = {}): any {
  return {
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
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockSlackAdapter(plugin);
    (adapter as any).config = [{
      name: 'test-bot', context: 'slack',
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
  let bot: MockSlackBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/slack-integration.ts');
    adapter = new MockSlackAdapter(plugin);
    (adapter as any).config = [{
      name: 'test-bot', context: 'slack',
      token: 'xoxb-mock', signingSecret: 'mock',
    }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockSlackBot;
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
      const raw = createSlackRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('1700000000.000000');
      expect(msg.$adapter).toBe('slack');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('U12345');
      expect(msg.$channel.id).toBe('C001');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好世界');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('DM 应格式化为 private 类型', () => {
      const raw = createSlackRawEvent({ channel_type: 'im' });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createSlackRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'slack',
        bot: 'test-bot',
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
      const msg = bot.$formatMessage(raw);

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
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
