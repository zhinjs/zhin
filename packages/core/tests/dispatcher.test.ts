/**
 * MessageDispatcher 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMessageDispatcher, type MessageDispatcherService, type RouteResult } from '../src/built/dispatcher.js';
import type { Message } from '../src/message.js';

function makeMessage(text: string, overrides: Partial<Message<any>> = {}): Message<any> {
  return {
    $id: '1',
    $content: [{ type: 'text', data: { text } }],
    $raw: text,
    $sender: { id: 'user1', name: 'User' },
    $channel: { id: 'ch1', type: 'group' },
    $adapter: 'test',
    $bot: 'bot1',
    $timestamp: Date.now(),
    $reply: vi.fn(),
    $recall: vi.fn(),
    ...overrides,
  } as any;
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
    expect(typeof context.value.setCommandMatcher).toBe('function');
    expect(typeof context.value.setAITriggerMatcher).toBe('function');
    expect(typeof context.value.setAIHandler).toBe('function');
    expect(typeof context.value.hasAIHandler).toBe('function');
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
      service.setAITriggerMatcher((msg) => ({
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

  describe('Command Matcher', () => {
    it('自定义命令匹配器应优先', async () => {
      const aiHandler = vi.fn();
      service.setAIHandler(aiHandler);
      service.setAITriggerMatcher(() => ({ triggered: true, content: '' }));

      // 设置命令匹配器：以 / 开头视为命令
      service.setCommandMatcher((text) => text.startsWith('/'));

      const msg = makeMessage('/help');
      await service.dispatch(msg);

      // 命令路径不应触发 AI
      expect(aiHandler).not.toHaveBeenCalled();
    });
  });

  describe('extensions', () => {
    it('应提供 addGuardrail 扩展', () => {
      expect(typeof context.extensions.addGuardrail).toBe('function');
    });
  });
});
