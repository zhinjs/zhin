/**
 * OneBot11 适配器集成测试
 *
 * 策略：Mock 掉 WebSocket 传输层，测试 Endpoint 接口合规性、消息格式化、
 * 发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { OneBot11Adapter, type OneBot11Bot } from '../src/adapter';
import { OneBot11WsClient } from '../src/endpoint-ws-client';
import type { OneBot11WsClientConfig, OneBot11Message } from '../src/types';

const FIXED_TS = 1700000000000;

// ── Mock 掉 WS 传输：重写 $connect/$disconnect/callApi ──

class MockOneBot11Endpoint extends OneBot11WsClient {
  callApiMock = vi.fn().mockResolvedValue({ message_id: 99999 });

  constructor(adapter: OneBot11Adapter, config: OneBot11WsClientConfig) {
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

// ── Mock OneBot11Adapter：使用 MockEndpoint 代替真实 WS Endpoint ──

class MockOneBot11Adapter extends OneBot11Adapter {
  createEndpoint(config: any): OneBot11Bot {
    return new MockOneBot11Endpoint(this, {
      context: 'onebot11',
      connection: 'ws',
      url: 'ws://mock:6700',
      name: config.name || 'test-endpoint',
      ...config,
    }) as unknown as OneBot11Bot;
  }
}

// ── 测试用原始消息工厂 ──

function createOneBot11RawEvent(overrides: Partial<OneBot11Message> = {}): OneBot11Message {
  return {
    post_type: 'message',
    self_id: '10001',
    message_type: 'group',
    sub_type: 'normal',
    message_id: 12345,
    user_id: 99999,
    group_id: 88888,
    message: [{ type: 'text', data: { text: '你好' } }],
    raw_message: '你好',
    time: Math.floor(FIXED_TS / 1000),
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockOneBot11Adapter, OneBot11Message>({
  adapterName: 'onebot11',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockOneBot11Adapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', connection: 'ws', url: 'ws://mock:6700', context: 'onebot11' }];
    return adapter;
  },
  createRawEvent: () => createOneBot11RawEvent(),
});

// ============================================================================
// 测试
// ============================================================================

describe('OneBot11 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockOneBot11Adapter;
  let endpoint: MockOneBot11Endpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/onebot11-integration.ts');
    // 不通过 provide 注册，直接创建测试用适配器
    adapter = new MockOneBot11Adapter(plugin);

    // 手动注入 config（模拟 start 从 config 获取 endpoint 列表）
    // OneBot11Adapter 构造函数传空 config[]，我们通过覆盖 config 来提供
    (adapter as any).config = [{ name: 'test-endpoint', connection: 'ws', url: 'ws://mock:6700', context: 'onebot11' }];

    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockOneBot11Endpoint;
  });

  afterEach(async () => {
    try {
      await adapter.stop();
    } catch { /* ignore */ }
  });

  // ── Endpoint 接口 ──

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

  // ── 生命周期 ──

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

  // ── $formatMessage ──

  describe('$formatMessage 消息格式化', () => {
    it('群消息应正确格式化', () => {
      const raw = createOneBot11RawEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBe('12345');
      expect(msg.$adapter).toBe('onebot11');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBe('99999');
      expect(msg.$channel.id).toBe('88888');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好');
      expect(msg.$content).toEqual([{ type: 'text', data: { text: '你好' } }]);
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化', () => {
      const raw = createOneBot11RawEvent({
        message_type: 'private',
        group_id: undefined,
        user_id: 77777,
      });
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$channel.id).toBe('77777');
      expect(msg.$channel.type).toBe('private');
      expect(msg.$sender.id).toBe('77777');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createOneBot11RawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(Math.floor(FIXED_TS / 1000));
    });
  });

  // ── 消息发送 ──

  describe('消息发送', () => {
    it('群消息发送应调用 send_group_msg', async () => {
      endpoint.callApiMock.mockResolvedValueOnce({ message_id: 67890 });

      const result = await endpoint.$sendMessage({
        context: 'onebot11',
        endpoint: 'test-endpoint',
        id: '88888',
        type: 'group',
        content: [{ type: 'text', data: { text: 'hi' } }],
      });

      expect(endpoint.callApiMock).toHaveBeenCalledWith('send_group_msg', expect.objectContaining({
        group_id: 88888,
      }));
      expect(result).toBe('67890');
    });

    it('私聊消息发送应调用 send_private_msg', async () => {
      endpoint.callApiMock.mockResolvedValueOnce({ message_id: 67891 });

      const result = await endpoint.$sendMessage({
        context: 'onebot11',
        endpoint: 'test-endpoint',
        id: '77777',
        type: 'private',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });

      expect(endpoint.callApiMock).toHaveBeenCalledWith('send_private_msg', expect.objectContaining({
        user_id: 77777,
      }));
      expect(result).toBe('67891');
    });

    it('sendMessage 应返回字符串 ID', async () => {
      endpoint.callApiMock.mockResolvedValueOnce({ message_id: 11111 });

      const result = await adapter.sendMessage({
        context: 'onebot11',
        endpoint: 'test-endpoint',
        id: '88888',
        type: 'group',
        content: [{ type: 'text', data: { text: 'test' } }],
      });

      expect(typeof result).toBe('string');
    });
  });

  // ── 消息撤回 ──

  describe('消息撤回', () => {
    it('$recallMessage 应调用 delete_msg API', async () => {
      endpoint.callApiMock.mockResolvedValueOnce({});

      await endpoint.$recallMessage('12345');

      expect(endpoint.callApiMock).toHaveBeenCalledWith('delete_msg', { message_id: 12345 });
    });
  });

  // ── 消息接收链路 ──

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createOneBot11RawEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'onebot11' }),
      );
      dispatchSpy.mockRestore();
    });

    it('adapter 观察者应收到消息', async () => {
      const observer = vi.fn();
      adapter.on('message.receive', observer);

      const raw = createOneBot11RawEvent();
      const msg = endpoint.$formatMessage(raw);
      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer.mock.calls[0][0].$raw).toBe('你好');
    });
  });

  // ── $reply 路由 ──

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendSpy = vi.spyOn(adapter, 'sendMessage').mockResolvedValue('reply-123');

      const raw = createOneBot11RawEvent();
      const msg = endpoint.$formatMessage(raw);

      const result = await msg.$reply([{ type: 'text', data: { text: '回复' } }]);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0][0]).toMatchObject({
        context: 'onebot11',
        endpoint: 'test-endpoint',
      });
      expect(result).toBe('reply-123');
      sendSpy.mockRestore();
    });

    it('$reply 带引用应插入 reply 元素', async () => {
      const sendSpy = vi.spyOn(adapter, 'sendMessage').mockResolvedValue('reply-456');

      const raw = createOneBot11RawEvent();
      const msg = endpoint.$formatMessage(raw);

      await msg.$reply([{ type: 'text', data: { text: '引用回复' } }], true);

      const sentContent = sendSpy.mock.calls[0][0].content;
      expect(Array.isArray(sentContent)).toBe(true);
      expect((sentContent as any[])[0]).toMatchObject({
        type: 'reply',
        data: { message_id: '12345' },
      });
      sendSpy.mockRestore();
    });
  });
});
