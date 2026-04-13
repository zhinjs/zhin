/**
 * OneBot12 适配器集成测试
 *
 * 策略：Mock 掉 WebSocket 传输层和 callAction，测试 Bot 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { OneBot12Adapter } from '../src/adapter.js';
import { OneBot12WsClient } from '../src/bot-ws.js';
import type { OneBot12WsConfig, OneBot12Event } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockOneBot12Bot extends OneBot12WsClient {
  callActionMock = vi.fn();

  constructor(adapter: OneBot12Adapter, config: OneBot12WsConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.callActionMock('send_message', options);
    return `ob12-msg-${Date.now()}`;
  }

  async $recallMessage(id: string): Promise<void> {
    this.callActionMock('delete_message', { message_id: id });
  }
}

// ── Mock Adapter ──

class MockOneBot12Adapter extends OneBot12Adapter {
  createBot(config: OneBot12WsConfig): MockOneBot12Bot {
    return new MockOneBot12Bot(this, {
      context: 'onebot12',
      name: config.name || 'test-bot',
      url: 'ws://mock:8080',
      connection: 'ws',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createOneBot12RawEvent(overrides: Partial<OneBot12Event> = {}): OneBot12Event {
  return {
    id: 'evt-001',
    time: Math.floor(FIXED_TS / 1000),
    type: 'message',
    detail_type: 'group',
    sub_type: '',
    message_id: 'msg-001',
    message: [{ type: 'text', data: { text: '你好' } }],
    alt_message: '你好',
    user_id: '99999',
    group_id: '88888',
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockOneBot12Adapter, OneBot12Event>({
  adapterName: 'onebot12',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockOneBot12Adapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'onebot12', url: 'ws://mock:8080', connection: 'ws' }];
    return adapter;
  },
  createRawEvent: () => createOneBot12RawEvent(),
});

// ============================================================================

describe('OneBot12 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockOneBot12Adapter;
  let bot: MockOneBot12Bot;

  beforeEach(async () => {
    plugin = new Plugin('/test/onebot12-integration.ts');
    adapter = new MockOneBot12Adapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', context: 'onebot12', url: 'ws://mock:8080', connection: 'ws' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockOneBot12Bot;
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
      const raw = createOneBot12RawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('msg-001');
      expect(msg.$adapter).toBe('onebot12');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('99999');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$channel.id).toBe('88888');
      expect(msg.$raw).toBe('你好');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化', () => {
      const raw = createOneBot12RawEvent({
        detail_type: 'private',
        group_id: undefined,
        user_id: '77777',
      });
      const msg = bot.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createOneBot12RawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(Math.floor(FIXED_TS / 1000));
    });

    it('$content 应为消息段数组', () => {
      const raw = createOneBot12RawEvent();
      const msg = bot.$formatMessage(raw);
      expect(Array.isArray(msg.$content)).toBe(true);
      expect(msg.$content.length).toBeGreaterThan(0);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'onebot12',
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
      const raw = createOneBot12RawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'onebot12' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createOneBot12RawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
