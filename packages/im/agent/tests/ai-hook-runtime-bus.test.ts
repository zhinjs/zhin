import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiHookRuntimeBus } from '../src/ai-hook-runtime-bus.js';
import {
  clearAIHooks,
  createAIHookEvent,
  registerAIHook,
  triggerAIHook,
} from '../src/hooks.js';
import { emitAIHookBusEvent } from '../src/plugin-ai-hook-bus.js';

describe('aiHookRuntimeBus + registerAIHook (Plugin Runtime)', () => {
  afterEach(() => {
    clearAIHooks();
    aiHookRuntimeBus.clear();
  });

  it('emitAIHookBusEvent fans out to runtime bus without host Plugin', () => {
    const seen: string[] = [];
    aiHookRuntimeBus.on('ai.hook', (payload) => {
      seen.push(`${payload.source}:${payload.sessionId ?? ''}`);
    });

    const event = createAIHookEvent('message', 'received', 'sess-1', {
      from: 'u1',
      content: 'hi',
      platform: 'sandbox',
    });
    emitAIHookBusEvent(event as import('../src/orchestrator/types.js').AIHookEvent, 'ai-hook');

    expect(seen).toEqual(['ai-hook:sess-1']);
  });

  it('registerAIHook handlers run via triggerAIHook without host Plugin', async () => {
    const handler = vi.fn();
    registerAIHook('message:received', handler);

    await triggerAIHook(createAIHookEvent('message', 'received', 's2', {
      from: 'u2',
      content: 'ping',
      platform: 'sandbox',
    }));

    // Fire-and-forget: allow microtask queue to drain.
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: 'message',
      action: 'received',
      sessionId: 's2',
    });
  });

  it('session:new also emits ai.session.new on runtime bus', () => {
    const hooks: string[] = [];
    aiHookRuntimeBus.on('ai.hook', () => hooks.push('hook'));
    aiHookRuntimeBus.on('ai.session.new', () => hooks.push('session.new'));

    emitAIHookBusEvent(
      createAIHookEvent('session', 'new', 's3') as import('../src/orchestrator/types.js').AIHookEvent,
      'ai-hook',
    );

    expect(hooks).toEqual(['hook', 'session.new']);
  });
});
