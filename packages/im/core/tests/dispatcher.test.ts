/**
 * MessageDispatcher 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  createMessageDispatcher,
  type MessageDispatcherService,
} from '../src/built/dispatcher.js';
import type { Message } from '../src/message.js';
import type { Plugin } from '../src/plugin.js';
import type { BeforeSendHandler } from '../src/types.js';

function makeMessage(text: string, overrides: Partial<Message<any>> = {}): Message<any> {
  return {
    $id: '1',
    $content: [{ type: 'text', data: { text } }],
    $raw: text,
    $sender: { id: 'user1', name: 'User' },
    $channel: { id: 'ch1', type: 'group' },
    $adapter: 'test',
    $endpoint: 'bot1',
    $timestamp: Date.now(),
    $reply: vi.fn(),
    $recall: vi.fn(),
    ...overrides,
  } as any;
}

/** 模拟 $reply → adapter.sendMessage → renderSendMessage（before.sendMessage） */
function wireMessageReplyThroughBeforeSend(msg: Message<any>, root: EventEmitter) {
  msg.$reply = vi.fn(async (content: any) => {
    let options = {
      content,
      endpoint: msg.$endpoint,
      id: msg.$channel.id,
      type: msg.$channel.type,
      context: 'test',
    };
    const fns = root.listeners('before.sendMessage') as BeforeSendHandler[];
    for (const fn of fns) {
      const r = await fn(options);
      if (r) options = r;
    }
    return 'mock-msg-id';
  });
}

describe('createMessageDispatcher', () => {
  let context: ReturnType<typeof createMessageDispatcher>;
  let service: MessageDispatcherService;

  beforeEach(() => {
    context = createMessageDispatcher();
    service = context.value;
  });

  it('应返回正确的 context 结构', () => {
    expect(context.name).toBe('dispatcher');
    expect(context.description).toContain('消息调度器');
    expect(context.value).toBeDefined();
    expect(typeof context.value.dispatch).toBe('function');
    expect(typeof context.value.addGuardrail).toBe('function');
    expect(typeof context.value.setAITriggerMatcher).toBe('function');
    expect(typeof context.value.setAIHandler).toBe('function');
    expect(typeof context.value.hasAIHandler).toBe('function');
    expect(typeof context.value.addOutboundPolish).toBe('function');
    expect(typeof context.value.replyWithPolish).toBe('function');
    expect(typeof service.matchAI).toBe('function');
  });

  describe('Guardrail', () => {
    it('应能添加和移除 Guardrail', () => {
      const guardrail = vi.fn(async (_msg: any, next: any) => next());
      const remove = service.addGuardrail(guardrail);

      expect(typeof remove).toBe('function');
      remove();
    });

    it('Guardrail 应在 dispatch 中执行', async () => {
      const calls: string[] = [];

      service.addGuardrail(async (_msg, next) => {
        calls.push('g1');
        await next();
      });
      service.addGuardrail(async (_msg, next) => {
        calls.push('g2');
        await next();
      });

      const msg = makeMessage('hello');
      await service.dispatch(msg);

      expect(calls).toEqual(['g1', 'g2']);
    });

    it('Guardrail 抛异常应拦截消息', async () => {
      service.addGuardrail(async () => {
        throw new Error('blocked');
      });

      const aiHandler = vi.fn();
      service.setAIHandler(aiHandler);
      service.setAITriggerMatcher(() => ({ triggered: true, content: 'test' }));

      const msg = makeMessage('hello');
      await service.dispatch(msg);

      expect(aiHandler).not.toHaveBeenCalled();
    });
  });

  describe('AI Handler', () => {
    it('初始无 AI handler', () => {
      expect(service.hasAIHandler()).toBe(false);
    });

    it('注册后 hasAIHandler 返回 true', () => {
      service.setAIHandler(async () => {});
      expect(service.hasAIHandler()).toBe(true);
    });

    it('AI 触发时应调用 handler', async () => {
      const handler = vi.fn();
      service.setAIHandler(handler);
      service.setAITriggerMatcher(() => ({
        triggered: true,
        content: 'processed content',
      }));

      const msg = makeMessage('你好');
      await service.dispatch(msg);

      expect(handler).toHaveBeenCalledWith(msg, 'processed content');
    });

    it('AI 不触发时不应调用 handler', async () => {
      const handler = vi.fn();
      service.setAIHandler(handler);
      service.setAITriggerMatcher(() => ({ triggered: false, content: '' }));

      const msg = makeMessage('random');
      await service.dispatch(msg);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('出站润色', () => {
    it('replyWithPolish 应经 before.sendMessage 链式润色再发出（$reply 入参仍为原文）', async () => {
      const root = new EventEmitter() as unknown as Plugin;
      (root as any).inject = () => undefined;
      (root as any).root = root;
      context.mounted({ root } as Plugin);

      const p1 = vi.fn(async (ctx: any) => `[1]${ctx.content}`);
      const p2 = vi.fn(async (ctx: any) => `${ctx.content}[2]`);
      service.addOutboundPolish(p1);
      service.addOutboundPolish(p2);

      const msg = makeMessage('x');
      wireMessageReplyThroughBeforeSend(msg, root as unknown as EventEmitter);
      await service.replyWithPolish(msg, 'ai', 'hello');

      expect(p1).toHaveBeenCalled();
      expect(p2).toHaveBeenCalled();
      expect(msg.$reply).toHaveBeenCalledWith('hello');
    });

    it('replyWithPolish 支持引用入站消息', async () => {
      const root = new EventEmitter() as unknown as Plugin;
      (root as any).inject = () => undefined;
      (root as any).root = root;
      context.mounted({ root } as Plugin);

      const msg = makeMessage('x');
      wireMessageReplyThroughBeforeSend(msg, root as unknown as EventEmitter);
      await service.replyWithPolish(msg, 'ai', 'hello', { quote: true });

      expect(msg.$reply).toHaveBeenCalledWith('hello', true);
    });

  });

  describe('extensions', () => {
    it('应提供 addGuardrail 扩展', () => {
      expect(typeof context.extensions.addGuardrail).toBe('function');
    });
    it('应提供 addOutboundPolish 扩展', () => {
      expect(typeof context.extensions.addOutboundPolish).toBe('function');
    });
  });
});
