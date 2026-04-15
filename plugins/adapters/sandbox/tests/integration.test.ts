/**
 * Sandbox 适配器集成测试
 *
 * 策略：使用框架基础 Adapter + 内联 Bot（模拟 SandboxBot 行为），
 * 因为 sandbox/src/index.ts 顶层调用 usePlugin() 无法在测试中导入。
 * 测试 Bot 接口合规性、消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Adapter, Bot, Message, Plugin, segment, SendOptions, SendContent, MessageElement, MessageType } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';

const FIXED_TS = 1700000000000;

// ── Mock WebSocket ──

class MockWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
}

// ── 内联 SandboxBot（复刻核心逻辑）──

interface SandboxConfig {
  context: 'sandbox';
  ws: any;
  name: string;
  owner?: string;
}

class TestSandboxBot extends EventEmitter implements Bot<SandboxConfig, { content: MessageElement[]; ts: number }> {
  $connected = false;
  get $id() { return this.$config.name; }

  constructor(public adapter: Adapter, public $config: SandboxConfig) {
    super();
  }

  async $connect() { this.$connected = true; }
  async $disconnect() { this.$config.ws.close(); this.$connected = false; }

  $formatMessage({ content, type, id, ts }: { content: MessageElement[]; id: string; type: MessageType; ts: number }) {
    if (!this.$config.owner) this.$config.owner = id;
    const message = Message.from(
      { content, ts },
      {
        $id: `${ts}`,
        $adapter: 'sandbox' as any,
        $bot: `${this.$config.name}`,
        $sender: { id: `${id}`, name: 'mock' },
        $channel: { id: `${id}`, type },
        $content: content,
        $raw: segment.raw(content),
        $timestamp: ts,
        $recall: async () => { await this.$recallMessage(message.$id); },
        $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
          if (!Array.isArray(content)) content = [content];
          if (quote) content.unshift({ type: 'reply', data: { id: typeof quote === 'boolean' ? message.$id : quote } });
          return await this.adapter.sendMessage({
            ...message.$channel,
            context: 'sandbox',
            bot: `${this.$config.name}`,
            content,
          });
        },
      },
    );
    return message;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    if (!this.$connected) return '';
    this.$config.ws.send(JSON.stringify({ ...options, content: options.content, timestamp: Date.now() }));
    return `sandbox-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {}
}

class TestSandboxAdapter extends Adapter<TestSandboxBot> {
  constructor(plugin: Plugin) { super(plugin, 'sandbox', []); }
  createBot(config: SandboxConfig): TestSandboxBot {
    const bot = new TestSandboxBot(this, config);
    this.bots.set(bot.$id, bot);
    return bot;
  }
  async start(): Promise<void> {
    this.plugin.root.adapters.push(this.name);
  }
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<TestSandboxAdapter, { content: MessageElement[]; id: string; type: MessageType; ts: number }>({
  adapterName: 'sandbox',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new TestSandboxAdapter(plugin);
    const mockWs = new MockWebSocket();
    const bot = adapter.createBot({ context: 'sandbox', ws: mockWs as any, name: 'test-bot' });
    bot.$connected = true;
    return adapter;
  },
  createRawEvent: () => ({
    content: [{ type: 'text', data: { text: '你好' } }],
    type: 'private' as MessageType,
    id: 'user-001',
    ts: FIXED_TS,
  }),
});

// ============================================================================

describe('Sandbox 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: TestSandboxAdapter;
  let bot: TestSandboxBot;
  let mockWs: MockWebSocket;

  beforeEach(async () => {
    plugin = new Plugin('/test/sandbox-integration.ts');
    adapter = new TestSandboxAdapter(plugin);
    await adapter.start();

    mockWs = new MockWebSocket();
    bot = adapter.createBot({ context: 'sandbox', ws: mockWs as any, name: 'test-bot' });
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
    it('createBot 应注册 bot 到 bots Map', () => {
      expect(adapter.bots.has('test-bot')).toBe(true);
    });

    it('$disconnect 应关闭 WebSocket', async () => {
      await bot.$disconnect();
      expect(mockWs.close).toHaveBeenCalled();
      expect(bot.$connected).toBe(false);
    });
  });

  describe('$formatMessage 消息格式化', () => {
    it('私聊消息应正确格式化', () => {
      const msg = bot.$formatMessage({
        content: [{ type: 'text', data: { text: '你好' } }],
        type: 'private',
        id: 'user-001',
        ts: 1700000000000,
      });

      expect(msg.$id).toBe('1700000000000');
      expect(msg.$adapter).toBe('sandbox');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('user-001');
      expect(msg.$channel.id).toBe('user-001');
      expect(msg.$channel.type).toBe('private');
      expect(msg.$content).toEqual([{ type: 'text', data: { text: '你好' } }]);
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('群聊消息应正确格式化', () => {
      const msg = bot.$formatMessage({
        content: [{ type: 'text', data: { text: 'hi' } }],
        type: 'group',
        id: 'group-001',
        ts: 1700000000000,
      });

      expect(msg.$channel.type).toBe('group');
      expect(msg.$channel.id).toBe('group-001');
    });

    it('$timestamp 应为正整数', () => {
      const msg = bot.$formatMessage({
        content: [{ type: 'text', data: { text: 'test' } }],
        type: 'private',
        id: 'user-001',
        ts: 1700000000000,
      });
      expect(msg.$timestamp).toBe(1700000000000);
    });
  });

  describe('消息发送', () => {
    it('$sendMessage 应通过 WebSocket 发送', async () => {
      await bot.$sendMessage({
        context: 'sandbox',
        bot: 'test-bot',
        id: 'user-001',
        type: 'private',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('未连接时 $sendMessage 应返回空字符串', async () => {
      bot.$connected = false;
      const result = await bot.$sendMessage({
        context: 'sandbox',
        bot: 'test-bot',
        id: 'user-001',
        type: 'private',
        content: [{ type: 'text', data: { text: 'hello' } }],
      });
      expect(result).toBe('');
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const msg = bot.$formatMessage({
        content: [{ type: 'text', data: { text: '你好' } }],
        type: 'private',
        id: 'user-001',
        ts: FIXED_TS,
      });

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'sandbox' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const msg = bot.$formatMessage({
        content: [{ type: 'text', data: { text: '你好' } }],
        type: 'private',
        id: 'user-001',
        ts: FIXED_TS,
      });

      // sandbox $sendMessage 返回 ""，所以 mock 掉
      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('回复');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
