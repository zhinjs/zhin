/**
 * Email 适配器集成测试
 *
 * 策略：Mock 掉 SMTP/IMAP 传输层，测试 Bot 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/core/tests/adapter-harness.js';
import { EmailAdapter } from '../src/adapter.js';
import { EmailBot } from '../src/bot.js';
import type { EmailBotConfig, EmailMessage } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Bot ──

class MockEmailBot extends EmailBot {
  sendMock = vi.fn();

  constructor(adapter: EmailAdapter, config: EmailBotConfig) {
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
    return `email-msg-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {
    // 邮件不支持撤回
  }
}

// ── Mock Adapter ──

class MockEmailAdapter extends EmailAdapter {
  createBot(config: EmailBotConfig): MockEmailBot {
    return new MockEmailBot(this, {
      context: 'email',
      name: config.name || 'test-bot',
      smtp: { host: 'smtp.mock', port: 465, secure: true, auth: { user: 'test@mock.com', pass: 'pass' } },
      imap: { host: 'imap.mock', port: 993, tls: true, user: 'test@mock.com', password: 'pass' },
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createEmailRawEvent(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    messageId: '<msg001@mock.com>',
    from: 'sender@example.com',
    to: ['test@mock.com'],
    subject: '测试邮件',
    text: '你好，这是一封测试邮件',
    attachments: [],
    date: new Date(1700000000000),
    uid: 1,
    ...overrides,
  };
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockEmailAdapter, EmailMessage>({
  adapterName: 'email',
  botId: 'test-bot',
  createAdapter: (plugin) => {
    const adapter = new MockEmailAdapter(plugin);
    (adapter as any).config = [{
      name: 'test-bot',
      context: 'email',
      smtp: { host: 'smtp.mock', port: 465, secure: true, auth: { user: 'test@mock.com', pass: 'pass' } },
      imap: { host: 'imap.mock', port: 993, tls: true, user: 'test@mock.com', password: 'pass' },
    }];
    return adapter;
  },
  createRawEvent: () => createEmailRawEvent(),
});

// ============================================================================

describe('Email 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockEmailAdapter;
  let bot: MockEmailBot;

  beforeEach(async () => {
    plugin = new Plugin('/test/email-integration.ts');
    adapter = new MockEmailAdapter(plugin);
    (adapter as any).config = [{
      name: 'test-bot',
      context: 'email',
      smtp: { host: 'smtp.mock', port: 465, secure: true, auth: { user: 'test@mock.com', pass: 'pass' } },
      imap: { host: 'imap.mock', port: 993, tls: true, user: 'test@mock.com', password: 'pass' },
    }];
    await adapter.start();
    bot = adapter.bots.get('test-bot') as MockEmailBot;
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
    it('邮件消息应正确格式化', () => {
      const raw = createEmailRawEvent();
      const msg = bot.$formatMessage(raw);

      expect(msg.$id).toBe('<msg001@mock.com>');
      expect(msg.$adapter).toBe('email');
      expect(msg.$bot).toBe('test-bot');
      expect(msg.$sender.id).toBe('sender@example.com');
      expect(msg.$channel.id).toBe('sender@example.com');
      expect(msg.$channel.type).toBe('private');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createEmailRawEvent();
      const msg = bot.$formatMessage(raw);
      expect(msg.$timestamp).toBe(1700000000000);
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'email',
        bot: 'test-bot',
        id: 'recipient@example.com',
        type: 'private',
        content: [{ type: 'text', data: { text: '回复' } }],
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createEmailRawEvent();
      const msg = bot.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'email' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应走 adapter.sendMessage', async () => {
      const sendMessageSpy = vi.spyOn(adapter, 'sendMessage');
      const raw = createEmailRawEvent();
      const msg = bot.$formatMessage(raw);

      sendMessageSpy.mockResolvedValue('reply-id');
      const result = await msg.$reply('hi');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('reply-id');
    });
  });
});
