/**
 * NapCat 适配器集成测试
 *
 * Mock 掉 WebSocket 传输层，测试 Bot 接口合规性、消息格式化、
 * 发送/接收链路、入站治理。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { NapCatAdapter, type NapCatBot } from '../src/adapter';
import { NapCatWsClient } from '../src/bot-ws-client';
import type { NapCatWsClientConfig, NapCatMessageEvent } from '../src/types';

const FIXED_TS = 1700000000000;

class MockNapCatBot extends NapCatWsClient {
  callApiMock = vi.fn().mockResolvedValue({ message_id: 99999 });

  constructor(adapter: NapCatAdapter, config: NapCatWsClientConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async callApi(action: string, params: Record<string, any> = {}): Promise<any> {
    return this.callApiMock(action, params);
  }
}

class MockNapCatAdapter extends NapCatAdapter {
  createBot(config: any): NapCatBot {
    return new MockNapCatBot(this, {
      context: 'napcat',
      connection: 'ws',
      url: 'ws://mock:3001',
      name: config.name || 'test-bot',
      ...config,
    }) as unknown as NapCatBot;
  }
}

function createNapCatRawEvent(overrides: Partial<NapCatMessageEvent> = {}): NapCatMessageEvent {
  return {
    post_type: 'message',
    self_id: 10001,
    message_type: 'group',
    sub_type: 'normal',
    message_id: 12345,
    user_id: 99999,
    group_id: 88888,
    message: [{ type: 'text', data: { text: '你好' } }],
    raw_message: '你好',
    font: 0,
    time: Math.floor(FIXED_TS / 1000),
    sender: { user_id: 99999, nickname: '测试用户' },
    ...overrides,
  };
}

// ── Harness 标准测试套件 ──

createAdapterTestSuite<MockNapCatAdapter, NapCatMessageEvent>({
  adapterName: 'napcat',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockNapCatAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', connection: 'ws', url: 'ws://mock:3001', context: 'napcat' }];
    return adapter;
  },
  createRawEvent: () => createNapCatRawEvent(),
});

// ── NapCat 特定测试 ──

describe('NapCat 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockNapCatAdapter;
  let bot: MockNapCatBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/napcat-integration.ts');
    adapter = new MockNapCatAdapter(plugin);
    (adapter as any).config = [{ name: 'test-bot', connection: 'ws', url: 'ws://mock:3001', context: 'napcat' }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockNapCatBot;
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

    it('应实现 $addReaction 和 $removeReaction', () => {
      expect(typeof bot.$addReaction).toBe('function');
      expect(typeof bot.$removeReaction).toBe('function');
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
    it('群消息应正确格式化', () => {
      const raw = createNapCatRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('12345');
      expect(msg.$adapter).toBe('napcat');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('99999');
      expect(msg.$channel.id).toBe('88888');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好');
      expect(msg.$content).toEqual([{ type: 'text', data: { text: '你好' } }]);
    });

    it('私聊消息应正确格式化', () => {
      const raw = createNapCatRawEvent({
        message_type: 'private',
        group_id: undefined,
        user_id: 77777,
        sender: { user_id: 77777, nickname: '私聊用户' },
      });
      const msg = bot.$formatMessage(raw);

      expect(msg.$channel.id).toBe('77777');
      expect(msg.$channel.type).toBe('private');
    });

    it('字符串消息应被归一化为数组', () => {
      const raw = createNapCatRawEvent({ message: 'plain text' as any });
      const msg = bot.$formatMessage(raw);
      expect(msg.$content).toEqual([{ type: 'text', data: { text: 'plain text' } }]);
    });
  });

  describe('消息发送', () => {
    it('群消息发送应调用 send_group_msg', async () => {
      bot.callApiMock.mockResolvedValueOnce({ message_id: 67890 });

      const result = await bot.$sendMessage({
        context: 'napcat',
        bot: 'test-bot',
        id: '88888',
        type: 'group',
        content: [{ type: 'text', data: { text: 'hi' } }],
      });

      expect(bot.callApiMock).toHaveBeenCalledWith('send_group_msg', expect.objectContaining({
        group_id: 88888,
      }));
      expect(result).toBe('67890');
    });

    it('私聊消息发送应调用 send_private_msg', async () => {
      bot.callApiMock.mockResolvedValueOnce({ message_id: 67891 });

      const result = await bot.$sendMessage({
        context: 'napcat',
        bot: 'test-bot',
        id: '77777',
        type: 'private',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });

      expect(bot.callApiMock).toHaveBeenCalledWith('send_private_msg', expect.objectContaining({
        user_id: 77777,
      }));
      expect(result).toBe('67891');
    });
  });

  describe('消息撤回', () => {
    it('$recallMessage 应调用 delete_msg', async () => {
      bot.callApiMock.mockResolvedValueOnce({});
      await bot.$recallMessage('12345');
      expect(bot.callApiMock).toHaveBeenCalledWith('delete_msg', { message_id: 12345 });
    });
  });

  describe('$addReaction', () => {
    it('应调用 set_msg_emoji_like', async () => {
      bot.callApiMock.mockResolvedValueOnce({});
      const result = await bot.$addReaction('12345', '128516');
      expect(bot.callApiMock).toHaveBeenCalledWith('set_msg_emoji_like', { message_id: 12345, emoji_id: '128516' });
      expect(result).toBe('reaction:12345:128516');
    });
  });

  describe('入站消息治理', () => {
    it('自发消息 (message_sent) 不应触发 message.receive', async () => {
      const observer = vi.fn();
      adapter.on('message.receive', observer);

      const raw = createNapCatRawEvent({ post_type: 'message_sent' as any, user_id: 10001 });
      (bot as any).dispatchEvent(raw);

      await new Promise(r => setTimeout(r, 50));
      expect(observer).not.toHaveBeenCalled();
    });

    it('self_id === user_id 不应触发 message.receive', async () => {
      const observer = vi.fn();
      adapter.on('message.receive', observer);

      const raw = createNapCatRawEvent({ self_id: 10001, user_id: 10001 });
      (bot as any).dispatchEvent(raw);

      await new Promise(r => setTimeout(r, 50));
      expect(observer).not.toHaveBeenCalled();
    });

    it('重复消息应被去重', async () => {
      const observer = vi.fn();
      adapter.on('message.receive', observer);

      const raw = createNapCatRawEvent();
      (bot as any).dispatchEvent(raw);
      (bot as any).dispatchEvent(raw);

      await new Promise(r => setTimeout(r, 50));
      expect(observer).toHaveBeenCalledTimes(1);
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createNapCatRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'napcat' }),
      );
      dispatchSpy.mockRestore();
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendSpy = vi.spyOn(adapter, 'sendMessage').mockResolvedValue('reply-123');

      const raw = createNapCatRawEvent();
      const msg = bot.$formatMessage(raw);

      const result = await msg.$reply([{ type: 'text', data: { text: '回复' } }]);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0][0]).toMatchObject({
        context: 'napcat',
        bot: 'test-bot',
      });
      expect(result).toBe('reply-123');
      sendSpy.mockRestore();
    });
  });
});
