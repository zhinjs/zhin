/**
 * QQ 官方机器人适配器集成测试
 *
 * 策略：使用框架基础 Adapter + 内联 Bot（复刻 QQBot 核心逻辑），
 * 因为 QQBot 继承 qq-official-bot SDK 的 Bot 类，其构造器校验 receiver_type 会崩溃。
 * 测试 Bot 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Adapter, Bot, Message, Plugin, segment, SendOptions, SendContent, MessageType } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';

const FIXED_TS = 1700000000000;

// ── 内联 QQBot（复刻 $formatMessage 核心逻辑）──

interface QQConfig {
  context: 'qq';
  name: string;
  appid: string;
  secret: string;
}

interface QQRawMessage {
  message_id: string;
  message_type: string;
  sub_type?: string;
  user_id: string;
  group_id?: string;
  channel_id?: string;
  guild_id?: string;
  message: any[];
  raw_message: string;
  sender: { user_id: string; user_name: string };
}

class TestQQBot extends EventEmitter implements Bot<QQConfig, QQRawMessage> {
  $connected = false;
  get $id() { return this.$config.name; }

  constructor(public adapter: Adapter, public $config: QQConfig) {
    super();
  }

  async $connect() { this.$connected = true; }
  async $disconnect() { this.$connected = false; }

  $formatMessage(msg: QQRawMessage) {
    let target_id = msg.user_id;
    if (msg.message_type === 'guild') target_id = msg.channel_id!;
    if (msg.message_type === 'group') target_id = msg.group_id!;
    if (msg.sub_type === 'direct') target_id = `direct:${msg.guild_id}`;

    const result = Message.from(msg, {
      $id: msg.message_id?.toString(),
      $adapter: 'qq' as any,
      $bot: this.$config.name,
      $sender: {
        id: msg.sender.user_id?.toString(),
        name: msg.sender.user_name?.toString(),
      },
      $channel: {
        id: target_id,
        type: (msg.message_type === 'guild' ? 'channel' : msg.message_type) as MessageType,
      },
      $content: msg.message,
      $raw: msg.raw_message,
      $timestamp: FIXED_TS,
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (content: SendContent, quote: boolean | string = true): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: 'reply', data: { id: typeof quote === 'boolean' ? result.$id : quote } });
        return await this.adapter.sendMessage({
          ...result.$channel,
          context: 'qq',
          bot: this.$config.name,
          content,
        });
      },
    });
    return result;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    return `${options.type}-${options.id}:mock-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

class TestQQAdapter extends Adapter<TestQQBot> {
  constructor(plugin: Plugin) { super(plugin, 'qq', []); }
  createBot(config: QQConfig): TestQQBot {
    const bot = new TestQQBot(this, config);
    this.bots.set(bot.$id, bot);
    return bot;
  }
  async start(): Promise<void> {
    this.plugin.root.adapters.push(this.name);
  }
}

// ── 原始消息工厂 ──

function createQQRawEvent(overrides: any = {}): QQRawMessage {
  return {
    message_id: 'qq-msg-001',
    message_type: 'group',
    sub_type: 'normal',
    user_id: '99999',
    group_id: '88888',
    message: [{ type: 'text', data: { text: '你好' } }],
    raw_message: '你好',
    sender: {
      user_id: '99999',
      user_name: '测试用户',
    },
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<TestQQAdapter, QQRawMessage>({
  adapterName: 'qq',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new TestQQAdapter(plugin);
    const bot = adapter.createBot({ context: 'qq', name: 'test-bot', appid: 'mock', secret: 'mock' });
    bot.$connected = true;
    return adapter;
  },
  createRawEvent: () => createQQRawEvent(),
});

// ============================================================================

describe('QQ 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: TestQQAdapter;
  let bot: TestQQBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/qq-integration.ts');
    adapter = new TestQQAdapter(plugin);
    await adapter.start();

    bot = adapter.createBot({ context: 'qq', name: 'test-bot', appid: 'mock', secret: 'mock' });
    await bot.$connect();
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
      const raw = createQQRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$adapter).toBe('qq');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('99999');
      expect(msg.$channel.id).toBe('88888');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化', () => {
      const raw = createQQRawEvent({
        message_type: 'private',
        group_id: undefined,
        user_id: '77777',
      });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('频道消息应格式化为 channel', () => {
      const raw = createQQRawEvent({
        message_type: 'guild',
        group_id: undefined,
        channel_id: 'guild-ch-001',
      });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('channel');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createQQRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'qq',
        bot: 'test-bot',
        id: '88888',
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
      const raw = createQQRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'qq' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createQQRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
