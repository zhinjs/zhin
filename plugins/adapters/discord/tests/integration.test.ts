/**
 * Discord 适配器集成测试
 *
 * 策略：Mock 掉 discord.js 的 Client 层（$connect/$disconnect/$sendMessage），
 * 测试 Bot 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { DiscordAdapter } from '../src/adapter.js';
import { DiscordBot } from '../src/bot.js';
import type { DiscordGatewayConfig } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot：继承 DiscordBot 但完全覆盖 SDK 相关方法 ──

class MockDiscordBot extends DiscordBot {
  sendMock = vi.fn();

  constructor(adapter: DiscordAdapter, config: DiscordGatewayConfig) {
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
    return `discord-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockDiscordAdapter extends DiscordAdapter {
  createBot(config: DiscordGatewayConfig): MockDiscordBot {
    return new MockDiscordBot(this, {
      context: 'discord',
      name: config.name || 'test-bot',
      token: 'mock-token',
      connection: 'gateway',
      ...config,
    });
  }
}

// ── 原始消息工厂（模拟 discord.js Message 结构）──

function createDiscordRawEvent(overrides: any = {}): any {
  return {
    id: 'discord-msg-001',
    content: '你好世界',
    createdTimestamp: FIXED_TS,
    author: { id: 'user-001', displayName: 'TestUser', username: 'testuser', bot: false },
    member: { displayName: 'TestMember' },
    channel: {
      id: 'ch-001',
      type: 1, // DM = 1
      messages: { fetch: vi.fn() },
    },
    attachments: new Map(),
    embeds: [],
    stickers: new Map(),
    mentions: {
      users: new Map(),
      channels: new Map(),
      roles: new Map(),
    },
    reference: null,
    delete: vi.fn(),
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockDiscordAdapter, any>({
  adapterName: 'discord',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockDiscordAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'discord', token: 'mock-token', connection: 'gateway' }];
    return adapter;
  },
  createRawEvent: () => createDiscordRawEvent(),
});

// ============================================================================

describe('Discord 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockDiscordAdapter;
  let bot: MockDiscordBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/discord-integration.ts');
    adapter = new MockDiscordAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'discord', token: 'mock-token', connection: 'gateway' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockDiscordBot;
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
    it('DM 消息应格式化为 private', () => {
      const raw = createDiscordRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('discord-msg-001');
      expect(msg.$adapter).toBe('discord');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('user-001');
      expect(msg.$channel.id).toBe('ch-001');
      expect(msg.$channel.type).toBe('private');
      expect(msg.$raw).toBe('你好世界');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('GroupDM 消息应格式化为 group', () => {
      const raw = createDiscordRawEvent({ channel: { id: 'ch-002', type: 3, messages: { fetch: vi.fn() } } }); // GroupDM = 3
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('group');
    });

    it('服务器频道消息应格式化为 channel', () => {
      const raw = createDiscordRawEvent({ channel: { id: 'ch-003', type: 0, messages: { fetch: vi.fn() } } }); // GuildText = 0
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('channel');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createDiscordRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'discord',
        bot: 'test-bot',
        id: 'ch-001',
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
      const raw = createDiscordRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'discord' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createDiscordRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
