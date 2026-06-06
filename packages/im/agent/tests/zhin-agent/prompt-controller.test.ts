import { describe, it, expect } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import { PromptController } from '../../src/zhin-agent/prompt-controller.js';
import type { ToolContext } from '../../src/orchestrator/types.js';

const ctx: ToolContext = {
  platform: 'sandbox',
  botId: 'b1',
  sceneId: 'private:u1',
  senderId: 'u1',
  scope: 'private',
};

const makeResult = (reply: string) => ({
  reply,
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  path: 'chat' as const,
  iterations: 1,
  model: 'm',
  toolCalls: [],
});

describe('PromptController', () => {
  it('runs turns on different sessions in parallel', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    const order: string[] = [];

    const run = (sessionKey: string, label: string) =>
      controller.schedule({
        sessionKey,
        sessionId: `${sessionKey}#1`,
        userMessages: [createUserMessage(label)],
        context: ctx,
        execute: async (_initial, _hooks, _signal, _turnId) => {
          order.push(`start:${label}`);
          await new Promise((r) => setTimeout(r, 20));
          order.push(`end:${label}`);
          return makeResult(label);
        },
      });

    const [a, b] = await Promise.all([run('s1', 'A'), run('s2', 'B')]);
    expect(a.reply).toBe('A');
    expect(b.reply).toBe('B');
    expect(order.indexOf('start:A')).toBeLessThan(order.indexOf('end:A'));
    expect(order.indexOf('start:B')).toBeLessThan(order.indexOf('end:B'));
    expect(order.indexOf('start:B')).toBeLessThan(order.indexOf('end:A'));
  });

  it('same session busy spawns parallel independent turns', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = controller.schedule({
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('first')],
      context: ctx,
      execute: async (initialMessages) => {
        const block = initialMessages[0]?.content.find((b) => b.type === 'text');
        const text = block && block.type === 'text' ? block.text : '';
        if (text === 'first') await gate;
        return makeResult(text);
      },
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(controller.isBusy()).toBe(true);
    expect(controller.getActiveTurnCount()).toBe(1);

    const second = controller.schedule({
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('second')],
      context: ctx,
      execute: async () => makeResult('second'),
    });

    expect(controller.getActiveTurnCount()).toBe(2);

    const secondDone = await second;
    expect(secondDone.reply).toBe('second');

    release();
    const firstDone = await first;
    expect(firstDone.reply).toBe('first');
  });

  it('steer requires active same-session turn', () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    expect(() => controller.steer('s1', createUserMessage('nope'))).toThrow(/active turn/);
  });

  it('steer injects into latest active turn on session', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const steered: string[] = [];

    const first = controller.schedule({
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('first')],
      context: ctx,
      execute: async (_initial, hooks) => {
        await new Promise((r) => setTimeout(r, 10));
        await gate;
        const extra = await hooks.getSteeringMessages();
        for (const msg of extra) {
          const block = msg.content.find((b) => b.type === 'text');
          if (block && block.type === 'text') steered.push(block.text);
        }
        return makeResult('first');
      },
    });

    await new Promise((r) => setTimeout(r, 5));
    controller.steer('s1', createUserMessage('steer-msg'));
    release();
    await first;
    expect(steered).toContain('steer-msg');
  });

  it('waitForIdle resolves after all turns complete', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    void controller.schedule({
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('x')],
      context: ctx,
      execute: async () => makeResult('x'),
    });
    expect(controller.isBusy()).toBe(true);
    await controller.waitForIdle();
    expect(controller.isIdle()).toBe(true);
  });
});
