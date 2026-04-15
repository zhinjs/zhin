/**
 * ICQQ 适配器集成测试
 *
 * 策略：Mock 掉 IPC 传输层，测试 Bot 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { IcqqAdapter } from '../src/adapter.js';
import { IcqqBot } from '../src/bot.js';
import type { IcqqBotConfig } from '../src/types.js';
import type { IpcMessageEventData } from '../src/protocol.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockIcqqBot extends IcqqBot {
  sendMock = vi.fn();

  constructor(adapter: IcqqAdapter, config: IcqqBotConfig) {
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
    return `icqq-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockIcqqAdapter extends IcqqAdapter {
  createBot(config: IcqqBotConfig): MockIcqqBot {
    return new MockIcqqBot(this, {
      context: 'icqq',
      name: config.name || '10001',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createIcqqRawEvent(overrides: Partial<IpcMessageEventData> = {}): IpcMessageEventData {
  return {
    type: 'group',
    user_id: 99999,
    from_id: 99999,
    raw_message: '你好世界',
    time: Math.floor(FIXED_TS / 1000),
    group_id: 88888,
    nickname: '测试用户',
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockIcqqAdapter, IpcMessageEventData>({
  adapterName: 'icqq',
  botId: '10001',
  createAdapter: (plugin) => {
    const adapter = new MockIcqqAdapter(plugin);
    (adapter as any).config = [{ name: '10001', context: 'icqq' }];
    return adapter;
  },
  createRawEvent: () => createIcqqRawEvent(),
});

// ============================================================================

describe('ICQQ 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockIcqqAdapter;
  let bot: MockIcqqBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/icqq-integration.ts');
    adapter = new MockIcqqAdapter(plugin);
    (adapter as any).config = [{ name: '10001', context: 'icqq' }];
    await adapter.start();
    bot = adapter.bots.get('10001') as MockIcqqBot;
  });

  afterEach(async () => {
    try { await adapter.stop(); } catch { /* ignore */ }
  });

  describe('Bot 接口合规性', () => {
    it('$id 应为 QQ 号', () => {
      expect(bot.$id).toBe('10001');
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
      expect(adapter.bots.has('10001')).toBe(true);
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
      const raw = createIcqqRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$adapter).toBe('icqq');
      expect(msg.$bot).toBe('10001');
      expect(msg.$sender.id).toBe('99999');
      expect(msg.$channel.id).toBe('88888');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好世界');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化', () => {
      const raw = createIcqqRawEvent({
        type: 'private',
        group_id: undefined,
        from_id: 77777,
      });
      const msg = bot.$formatMessage(raw);

      expect(msg.$channel.type).toBe('private');
      expect(msg.$channel.id).toBe('77777');
    });

    it('$timestamp 应为毫秒级正整数', () => {
      const raw = createIcqqRawEvent();
      const msg = bot.$formatMessage(raw);
      // IcqqBot uses time * 1000
      expect(msg.$timestamp).toBe(FIXED_TS);
    });

    it('$content 应为消息段数组', () => {
      const raw = createIcqqRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(Array.isArray(msg.$content)).toBe(true);
      expect(msg.$content.length).toBeGreaterThan(0);
      expect(msg.$content[0].type).toBe('text');
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'icqq',
        bot: '10001',
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
      const raw = createIcqqRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'icqq' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createIcqqRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
