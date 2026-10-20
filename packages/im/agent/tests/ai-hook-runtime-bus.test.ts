import { afterEach, describe, expect, it } from 'vitest';
import { aiHookRuntimeBus } from '../src/ai-hook-runtime-bus.js';
import { emitAIHookBusEvent } from '../src/plugin-ai-hook-bus.js';
import { createAIHookEvent } from '../src/resource-hub/hook-registry.js';

describe('aiHookRuntimeBus', () => {
  afterEach(() => {
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
    emitAIHookBusEvent(event as import('../src/resource-hub/types.js').AIHookEvent, 'ai-hook');

    expect(seen).toEqual(['ai-hook:sess-1']);
  });

  it('session:new also emits ai.session.new on runtime bus', () => {
    const hooks: string[] = [];
    aiHookRuntimeBus.on('ai.hook', () => hooks.push('hook'));
    aiHookRuntimeBus.on('ai.session.new', () => hooks.push('session.new'));

    emitAIHookBusEvent(
      createAIHookEvent('session', 'new', 's3') as import('../src/resource-hub/types.js').AIHookEvent,
      'ai-hook',
    );

    expect(hooks).toEqual(['hook', 'session.new']);
  });
});
