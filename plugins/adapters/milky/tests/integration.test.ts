/**
 * Milky 适配器集成测试
 *
 * 策略：Mock 掉 WebSocket 传输层和 callApi，测试 Endpoint 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { MilkyAdapter } from '../src/adapter.js';
import { MilkyWsClient } from '../src/endpoint-ws.js';
import type { MilkyWsConfig, MilkyEvent } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Endpoint ──

class MockMilkyEndpoint extends MilkyWsClient {
  callApiMock = vi.fn();

  constructor(adapter: MilkyAdapter, config: MilkyWsConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.callApiMock('send_message', options);
    return `milky-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {
    this.callApiMock('recall_message', { id: _id });
  }
}

// ── Mock Adapter ──

class MockMilkyAdapter extends MilkyAdapter {
  createEndpoint(config: MilkyWsConfig): MockMilkyEndpoint {
    return new MockMilkyEndpoint(this, {
      context: 'milky',
      name: config.name || 'test-endpoint',
      baseUrl: 'ws://mock:8080',
      connection: 'ws',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createMilkyRawEvent(overrides: Partial<MilkyEvent> = {}): MilkyEvent {
  return {
    event_type: 'message_receive',
    time: FIXED_TS,
    self_id: 10001,
    data: {
      message_scene: 'group',
      peer_id: 88888,
      message_seq: 12345,
      sender_id: 99999,
      time: FIXED_TS,
      segments: [{ type: 'text', data: { text: '你好' } }],
      group: { group_id: 88888, group_name: '测试群' },
      group_member: { user_id: 99999, nickname: '测试用户', card: '群昵称' },
    },
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockMilkyAdapter, MilkyEvent>({
  adapterName: 'milky',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockMilkyAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'milky', baseUrl: 'ws://mock:8080', connection: 'ws' }];
    return adapter;
  },
  createRawEvent: () => createMilkyRawEvent(),
});

// ============================================================================

describe('Milky 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockMilkyAdapter;
  let endpoint: MockMilkyEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/milky-integration.ts');
    adapter = new MockMilkyAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'milky', baseUrl: 'ws://mock:8080', connection: 'ws' }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockMilkyEndpoint;
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
    it('群消息应正确格式化', () => {
      const raw = createMilkyRawEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$adapter).toBe('milky');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$channel.id).toBe('88888');
      expect(msg.$sender.id).toBe('99999');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('私聊消息应正确格式化', () => {
      const raw = createMilkyRawEvent({
        data: {
          message_scene: 'friend',
          peer_id: 77777,
          message_seq: 12346,
          sender_id: 77777,
          time: FIXED_TS,
          segments: [{ type: 'text', data: { text: 'hi' } }],
          friend: { user_id: 77777, nickname: '好友' },
        },
      });
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.type).toBe('private');
      expect(msg.$channel.id).toBe('77777');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createMilkyRawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBe(FIXED_TS);
    });

    it('非 message_receive 事件应返回空消息', () => {
      const raw: MilkyEvent = { event_type: 'heartbeat', time: FIXED_TS, self_id: 10001 };
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$id).toBe('');
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'milky',
        endpoint: 'test-endpoint',
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
      const raw = createMilkyRawEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'milky' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createMilkyRawEvent();
      const msg = endpoint.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
