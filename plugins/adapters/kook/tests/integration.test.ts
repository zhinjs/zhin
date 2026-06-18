/**
 * Kook 适配器集成测试
 *
 * 策略：Mock 掉 kook-client 的 Client 层（$connect/$disconnect/$sendMessage），
 * 测试 Endpoint 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, segment, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { KookAdapter } from '../src/adapter.js';
import { KookEndpoint } from '../src/endpoint.js';
import type { KookEndpointConfig } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Endpoint ──

class MockKookEndpoint extends KookEndpoint {
  sendMock = vi.fn();

  constructor(adapter: KookAdapter, config: KookEndpointConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    await super.$disconnect();
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.sendMock(options);
    return `kook-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

// ── Mock Adapter ──

class MockKookAdapter extends KookAdapter {
  createEndpoint(config: KookEndpointConfig): MockKookEndpoint {
    return new MockKookEndpoint(this, {
      context: 'kook',
      name: config.name || 'test-endpoint',
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
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockKookAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'kook', token: 'mock-token' }];
    return adapter;
  },
  createRawEvent: () => createKookRawEvent(),
});

// ============================================================================

describe('Kook 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockKookAdapter;
  let endpoint: MockKookEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/kook-integration.ts');
    adapter = new MockKookAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'kook', token: 'mock-token' }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockKookEndpoint;
  });

  afterEach(async () => {
    try { await adapter.stop(); } catch { /* ignore */ }
  });

  describe('Endpoint 接口合规性', () => {
    it('$id 应为配置的 name', () => {
      expect(endpoint.$id).toBe('test-endpoint');
    });

    it('$connected 启动后应为 true', () => {
      expect(endpoint.$connected).toBe(true);
    });

    it('应实现所有 Endpoint 接口方法', () => {
      expect(typeof endpoint.$formatMessage).toBe('function');
      expect(typeof endpoint.$connect).toBe('function');
      expect(typeof endpoint.$disconnect).toBe('function');
      expect(typeof endpoint.$sendMessage).toBe('function');
      expect(typeof endpoint.$recallMessage).toBe('function');
    });
  });

  describe('生命周期', () => {
    it('start() 应注册 endpoint', () => {
      expect(adapter.endpoints.has('test-endpoint')).toBe(true);
    });

    it('stop() 应清空 endpoints', async () => {
      await adapter.stop();
      expect(adapter.endpoints.size).toBe(0);
    });

    it('stop() 后 endpoint 应 disconnected', async () => {
      await adapter.stop();
      expect(endpoint.$connected).toBe(false);
    });
  });

  describe('$formatMessage 消息格式化', () => {
    it('频道消息应正确格式化', () => {
      const raw = createKookRawEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBeDefined();
      expect(msg.$adapter).toBe('kook');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBeDefined();
      expect(msg.$channel.id).toBe('ch-001');
      expect(msg.$channel.type).toBe('channel');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应格式化为 private', () => {
      const raw = createKookRawEvent({ message_type: 'private', channel_id: undefined });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createKookRawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });

    it('(met)userId(met) @ 提及应解析为 user_id 而非 @undefined', () => {
      const raw = createKookRawEvent({
        message: [{ type: 'markdown', text: '(met)970972780(met) 你好' }],
        raw_message: '(met)970972780(met) 你好',
      });
      const msg = endpoint.$formatMessage(raw);
      const atSeg = msg.$content.find((s) => s.type === 'at');
      expect(atSeg?.data?.user_id).toBe('970972780');
      expect(segment.raw(msg.$content)).toBe('@970972780 你好');
    });

    it('at 消息段应带 user_id 供预览与 @endpoint 匹配', () => {
      const raw = createKookRawEvent({
        message: [{ type: 'at', user_id: '970972780' }, { type: 'text', text: ' 你好' }],
      });
      const msg = endpoint.$formatMessage(raw);
      expect(segment.raw(msg.$content)).toBe('@970972780 你好');
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回带路由的 kook:channel: msg ref', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'send-ref',
        token: 'mock-token',
      });
      vi.spyOn(realBot as unknown as { sendChannelMsg: (...args: unknown[]) => Promise<{ msg_id: string }> }, 'sendChannelMsg')
        .mockResolvedValue({ msg_id: 'out-99' });

      const result = await realBot.$sendMessage({
        context: 'kook',
        endpoint: 'send-ref',
        id: 'ch-001',
        type: 'group',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });
      expect(result).toBe('kook:channel:out-99');
    });

    it('base64 图片应先 uploadMedia 再以 image 段发送', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'send-img',
        token: 'mock-token',
      });
      vi.spyOn(realBot, 'uploadMedia').mockResolvedValue('https://img.kookapp.cn/assets/zt.png');
      const sendSpy = vi.spyOn(
        realBot as unknown as { sendChannelMsg: (...args: unknown[]) => Promise<{ msg_id: string }> },
        'sendChannelMsg',
      ).mockResolvedValue({ msg_id: 'out-img' });

      await realBot.$sendMessage({
        context: 'kook',
        endpoint: 'send-img',
        id: 'ch-001',
        type: 'group',
        content: [{ type: 'image', data: { url: 'base64://YQ==' } }],
      });

      expect(realBot.uploadMedia).toHaveBeenCalledWith(expect.any(Buffer));
      expect(sendSpy).toHaveBeenCalledWith('ch-001', [
        { type: 'image', url: 'https://img.kookapp.cn/assets/zt.png' },
      ]);
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createKookRawEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'kook' }),
      );
    });
  });

  describe('$addReaction / $removeReaction', () => {
    it('应走 KOOK add/delete-reaction API 并在 reactionId 记录路由', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'reaction-test',
        token: 'mock-token',
      });
      const postSpy = vi.spyOn(realBot.request, 'post')
        .mockResolvedValueOnce({ code: 0 })
        .mockResolvedValueOnce({ code: 0 });

      const rid = await realBot.$addReaction('msg-1', '⏳', { sceneType: 'channel' });
      expect(rid).toBe('reaction:channel:msg-1:⏳');
      expect(postSpy).toHaveBeenCalledWith('/v3/message/add-reaction', { msg_id: 'msg-1', emoji: '⏳' });

      await realBot.$removeReaction('msg-1', rid);
      expect(postSpy).toHaveBeenCalledWith('/v3/message/delete-reaction', { msg_id: 'msg-1', emoji: '⏳' });
      expect(postSpy).not.toHaveBeenCalledWith('/v3/direct-message/delete-reaction', expect.anything());
      postSpy.mockRestore();
    });

    it('delete 已移除的 reaction 时不应抛错（404 异常）', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'reaction-gone',
        token: 'mock-token',
      });
      const postSpy = vi.spyOn(realBot.request, 'post')
        .mockRejectedValueOnce(new Error('request "/v3/message/delete-reaction" error with code(404): 该数据不存在'));

      await expect(
        realBot.$removeReaction('msg-1', 'reaction:channel:msg-1:⏳'),
      ).resolves.toBeUndefined();
      expect(postSpy).toHaveBeenCalledTimes(1);
      postSpy.mockRestore();
    });

    it('delete 已移除的 reaction 时不应抛错（非 0 响应体）', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'reaction-gone-body',
        token: 'mock-token',
      });
      const postSpy = vi.spyOn(realBot.request, 'post')
        .mockResolvedValueOnce({ code: 404, message: '该数据不存在或者你没有权限操作' });

      await expect(
        realBot.$removeReaction('msg-1', 'reaction:direct:msg-1:⏳'),
      ).resolves.toBeUndefined();
      postSpy.mockRestore();
    });
  });

  describe('$recallMessage', () => {
    it('出站 kook:channel: ref 应只打频道删除 API', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'recall-test',
        token: 'mock-token',
      });
      const postSpy = vi.spyOn(realBot.request, 'post').mockResolvedValueOnce({ code: 0 });

      await realBot.$recallMessage('kook:channel:ch-msg-1');
      expect(postSpy).toHaveBeenCalledWith('/v3/message/delete', { msg_id: 'ch-msg-1' });
      expect(postSpy).not.toHaveBeenCalledWith('/v3/direct-message/delete', expect.anything());
      postSpy.mockRestore();
    });

    it('入站 plain msgId + route 提示应只打对应 API', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'recall-dm',
        token: 'mock-token',
      });
      const postSpy = vi.spyOn(realBot.request, 'post').mockResolvedValueOnce({ code: 0 });

      await realBot.$recallMessage('dm-001', { route: 'direct' });
      expect(postSpy).toHaveBeenCalledWith('/v3/direct-message/delete', { msg_id: 'dm-001' });
      postSpy.mockRestore();
    });

    it('双路由时第一次删除已成功（无 code）不应再打第二条', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'recall-no-double',
        token: 'mock-token',
      });
      const postSpy = vi.spyOn(realBot.request, 'post').mockResolvedValueOnce({});

      await realBot.$removeReaction('msg-1', 'reaction:msg-1:⏳');
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy).toHaveBeenCalledWith('/v3/message/delete-reaction', { msg_id: 'msg-1', emoji: '⏳' });
      postSpy.mockRestore();
    });

    it('无路由信息时双路由尝试', async () => {
      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'recall-fallback',
        token: 'mock-token',
      });
      const postSpy = vi.spyOn(realBot.request, 'post')
        .mockResolvedValueOnce({ code: 1 })
        .mockResolvedValueOnce({ code: 0 });

      await realBot.$recallMessage('unknown-001');
      expect(postSpy).toHaveBeenCalledWith('/v3/message/delete', { msg_id: 'unknown-001' });
      expect(postSpy).toHaveBeenCalledWith('/v3/direct-message/delete', { msg_id: 'unknown-001' });
      postSpy.mockRestore();
    });
  });

  describe('gateway notice 事件', () => {
    it('receiver 系统消息应触发 notice.receive', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const adapterEmitSpy = vi.spyOn(adapter, 'emit');

      const realBot = new KookEndpoint(adapter, {
        context: 'kook',
        name: 'notice-test',
        token: 'mock-token',
      });

      const receiver = realBot.receiver as import('node:events').EventEmitter;
      receiver.emit('event', {
        channel_type: 'GROUP',
        type: 255,
        target_id: 'guild-100',
        msg_id: 'sys-msg-1',
        msg_timestamp: FIXED_TS,
        extra: {
          type: 'joined_guild',
          body: { user_id: 'new-user-1' },
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      expect(adapterEmitSpy).toHaveBeenCalledWith(
        'notice.receive',
        expect.objectContaining({
          $adapter: 'kook',
          $type: 'group_member_increase',
          $target: expect.objectContaining({ id: 'new-user-1' }),
        }),
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        'notice.receive',
        expect.objectContaining({ $type: 'group_member_increase' }),
      );

      dispatchSpy.mockRestore();
      adapterEmitSpy.mockRestore();
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createKookRawEvent();
      const msg = endpoint.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
