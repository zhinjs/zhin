/**
 * Satori 适配器集成测试
 *
 * 策略：Mock 掉 WebSocket 传输层和 callApi，测试 Bot 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { SatoriAdapter } from '../src/adapter.js';
import { SatoriWsClient } from '../src/bot-ws.js';
import type { SatoriWsConfig } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockSatoriBot extends SatoriWsClient {
  callApiMock = vi.fn();

  constructor(adapter: SatoriAdapter, config: SatoriWsConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.callApiMock('message.create', options);
    return `satori-msg-${Date.now()}`;
  }

  async $recallMessage(id: string): Promise<void> {
    this.callApiMock('message.delete', { message_id: id });
  }
}

// ── Mock Adapter ──

class MockSatoriAdapter extends SatoriAdapter {
  createBot(config: SatoriWsConfig): MockSatoriBot {
    return new MockSatoriBot(this, {
      context: 'satori',
      name: config.name || 'test-bot',
      baseUrl: 'ws://mock:5500',
      connection: 'ws',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createSatoriRawEvent(): any {
  return {
    id: 1,
    type: 'message-created',
    platform: 'test',
    self_id: 'bot-001',
    timestamp: FIXED_TS,
    message: {
      id: 'satori-msg-001',
      content: '你好世界',
      channel: { id: 'ch-001', type: 0 },
      user: { id: 'user-001', name: '测试用户' },
      member: { nick: '群昵称' },
    },
    channel: { id: 'ch-001', type: 0 },
    user: { id: 'user-001', name: '测试用户' },
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockSatoriAdapter, any>({
  adapterName: 'satori',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockSatoriAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'satori', baseUrl: 'ws://mock:5500', connection: 'ws' }];
    return adapter;
  },
  createRawEvent: () => createSatoriRawEvent(),
});

// ============================================================================

describe('Satori 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockSatoriAdapter;
  let bot: MockSatoriBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/satori-integration.ts');
    adapter = new MockSatoriAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'satori', baseUrl: 'ws://mock:5500', connection: 'ws' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockSatoriBot;
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
    it('消息应正确格式化', () => {
      const raw = createSatoriRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$adapter).toBe('satori');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('user-001');
      expect(msg.$channel.id).toBe('ch-001');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createSatoriRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'satori',
        bot: 'test-bot',
        id: 'ch-001',
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
      const raw = createSatoriRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'satori' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createSatoriRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
