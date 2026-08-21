import { describe, it, expect } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import {
  PromptController,
  TurnCancelledError,
  TurnSupersededError,
} from '../../src/turn/prompt-controller.js';

const makeResult = (reply: string) => ({
  reply,
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  path: 'chat' as const,
  iterations: 1,
  model: 'm',
  toolCalls: [],
});

describe('PromptController', () => {
  it('schedules the canonical TurnEvent stream without collecting it first', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    const stream = controller.scheduleStream({
      intent: { kind: 'new' },
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('stream')],
      execute: async function* () {
        yield { type: 'chunk' as const, text: 'a', accumulated: 'a' };
        yield { type: 'chunk' as const, text: 'b', accumulated: 'ab' };
        return makeResult('ab');
      },
    });
    const chunks: string[] = [];
    let result: ReturnType<typeof makeResult> | undefined;
    while (true) {
      const step = await stream.next();
      if (step.done) {
        result = step.value;
        break;
      }
      if (step.value.type === 'chunk') chunks.push(step.value.text);
    }

    expect(chunks).toEqual(['a', 'b']);
    expect(result?.reply).toBe('ab');
    expect(controller.isIdle()).toBe(true);
  });

  it('runs turns on different sessions in parallel', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    const order: string[] = [];

    const run = (sessionKey: string, label: string) =>
      controller.schedule({
        intent: { kind: 'new' },
        sessionKey,
        sessionId: `${sessionKey}#1`,
        userMessages: [createUserMessage(label)],
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

  it('same session aborts prior in-flight turn when a new message arrives', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstAborted: boolean[] = [];

    const first = controller.schedule({
      intent: { kind: 'new' },
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('first')],
      execute: async (_initial, _hooks, signal) => {
        await gate;
        firstAborted.push(signal.aborted);
        return makeResult('first');
      },
    });

    await new Promise((r) => setTimeout(r, 5));

    const second = await controller.schedule({
      intent: { kind: 'supersede' },
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('second')],
      execute: async () => makeResult('second'),
    });

    expect(second.reply).toBe('second');

    release();
    await expect(first).rejects.toBeInstanceOf(TurnSupersededError);
    expect(firstAborted).toEqual([true]);
  });

  it('propagates a caller cancellation to only its own turn', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    const abortController = new AbortController();
    let observedSignal: AbortSignal | undefined;

    const turn = controller.schedule({
      intent: { kind: 'new' },
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('cancel me')],
      signal: abortController.signal,
      execute: async (_initial, _hooks, signal) => {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return makeResult('unreachable');
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    abortController.abort(new TurnCancelledError('s1'));
    await expect(turn).rejects.toBeInstanceOf(TurnCancelledError);
    expect(observedSignal?.aborted).toBe(true);
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
      intent: { kind: 'new' },
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('first')],
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

  it('routes steer intent through schedule without superseding or executing a second turn', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const steered: string[] = [];
    const first = controller.schedule({
      turnId: 'turn-alice',
      intent: { kind: 'supersede' },
      principal: { subjectId: 'alice', roles: ['owner'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('design a deployment')],
      execute: async (_initial, hooks, signal) => {
        await gate;
        expect(signal.aborted).toBe(false);
        for (const message of await hooks.getSteeringMessages()) {
          const block = message.content.find((item) => item.type === 'text');
          if (block?.type === 'text') steered.push(block.text);
        }
        return makeResult('deployment');
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const control = await controller.schedule({
      turnId: 'turn-bob',
      intent: {
        kind: 'steer', targetTurnId: 'turn-alice', authorizedBy: 'product_policy',
      },
      principal: { subjectId: 'bob', roles: ['user'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('no Kubernetes', undefined, 2, {
        subjectId: 'bob', displayName: 'Bob', roles: ['user'], scope: 'group',
      })],
      execute: async () => { throw new Error('steer must not start another model turn'); },
    });

    expect(control.reply).toBe('');
    release();
    await expect(first).resolves.toMatchObject({ reply: 'deployment' });
    expect(steered).toEqual(['no Kubernetes']);
  });

  it('routes follow_up intent through schedule and runs it after the active execution', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const batches: string[] = [];
    const active = controller.schedule({
      intent: { kind: 'new' },
      turnId: 'turn-alice',
      principal: { subjectId: 'alice', roles: ['owner'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('deployment plan')],
      execute: async (messages) => {
        const block = messages[0]?.content.find((item) => item.type === 'text');
        if (block?.type === 'text') batches.push(block.text);
        if (batches.length === 1) await gate;
        return makeResult(block?.type === 'text' ? block.text : '');
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await controller.schedule({
      turnId: 'turn-bob',
      intent: {
        kind: 'follow_up', targetTurnId: 'turn-alice', authorizedBy: 'product_policy',
      },
      principal: { subjectId: 'bob', roles: ['user'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('add a migration checklist')],
      execute: async () => { throw new Error('follow-up uses the active execution'); },
    });
    release();

    await active;
    expect(batches).toEqual(['deployment plan', 'add a migration checklist']);
  });

  it('rejects cross-principal steering without explicit product policy authorization', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let release!: () => void;
    const active = controller.schedule({
      intent: { kind: 'new' },
      turnId: 'turn-alice',
      principal: { subjectId: 'alice', roles: ['owner'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('deployment plan')],
      execute: async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return makeResult('done');
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(() => controller.schedule({
      intent: { kind: 'steer', targetTurnId: 'turn-alice' },
      principal: { subjectId: 'bob', roles: ['user'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('run privileged tool')],
      execute: async () => makeResult('unreachable'),
    })).toThrow('product_policy authorization');

    release!();
    await active;
  });

  it('keeps cross-principal supersede as the compatible shared-session default', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    let admitted!: () => void;
    const ready = new Promise<void>((resolve) => { admitted = resolve; });
    const active = controller.schedule({
      intent: { kind: 'new' },
      turnId: 'turn-alice',
      principal: { subjectId: 'alice', roles: ['owner'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('deployment plan')],
      execute: async (_messages, _hooks, signal) => {
        admitted();
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        throw signal.reason;
      },
    });
    await ready;

    const replacement = controller.schedule({
      intent: { kind: 'supersede' },
      principal: { subjectId: 'bob', roles: ['user'] },
      sessionKey: 'shared',
      sessionId: 'shared#1',
      userMessages: [createUserMessage('replace alice')],
      execute: async () => makeResult('replacement'),
    });

    await expect(active).rejects.toMatchObject({ name: 'TurnSupersededError' });
    await expect(replacement).resolves.toMatchObject({ reply: 'replacement' });
  });

  it('waitForIdle resolves after all turns complete', async () => {
    const controller = new PromptController('one-at-a-time', 'one-at-a-time');
    void controller.schedule({
      intent: { kind: 'new' },
      sessionKey: 's1',
      sessionId: 's1#1',
      userMessages: [createUserMessage('x')],
      execute: async () => makeResult('x'),
    });
    expect(controller.isBusy()).toBe(true);
    await controller.waitForIdle();
    expect(controller.isIdle()).toBe(true);
  });
});
