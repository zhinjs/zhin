import { describe, it, expect } from 'vitest';
import { Plugin } from '@zhin.js/core';
import {
  createAIHookBusPayload,
  isAISessionCompactPayload,
  isAISessionNewPayload,
  onAIHook,
  onAISessionCompact,
  onAISessionNew,
} from '../src/ai-event-bus.js';
import { createAIHookEvent } from '../src/orchestrator/index.js';

describe('ai-event-bus helpers', () => {
  it('builds hook payload with fallback session id', () => {
    const payload = createAIHookBusPayload(
      createAIHookEvent('tool', 'call', undefined, {
        platform: 'mock',
        senderId: 'user1',
        sceneId: 'scene1',
        toolName: 'read_file',
        args: { filePath: 'README.md' },
      }),
      'orchestrator-hook',
      'agent-1',
    );

    expect(payload.sessionId).toBe('mock:scene1:user1');
    expect(payload.toolName).toBe('read_file');
    expect(payload.agentId).toBe('agent-1');
  });

  it('detects stable session payloads', () => {
    expect(isAISessionNewPayload({
      sessionId: 's1',
      source: 'zhin-agent',
      reason: 'first_message',
    })).toBe(true);

    expect(isAISessionCompactPayload({
      sessionId: 's1',
      source: 'zhin-agent',
      compactedCount: 1,
      savedTokens: 20,
      totalTokensBefore: 100,
      totalTokensAfter: 80,
    })).toBe(true);
  });

  it('subscribes to ai.hook and stable session events', () => {
    const plugin = new Plugin('/virtual/host-plugin.ts');
    const received: string[] = [];

    const disposeHook = onAIHook(plugin, () => received.push('hook'));
    const disposeNew = onAISessionNew(plugin, () => received.push('new'));
    const disposeCompact = onAISessionCompact(plugin, () => received.push('compact'));

    plugin.dispatch('ai.hook', { sessionId: 's1', source: 'ai-hook' });
    plugin.dispatch('ai.session.new', { sessionId: 's1', source: 'zhin-agent', reason: 'first_message' });
    plugin.dispatch('ai.session.compact', {
      sessionId: 's1',
      source: 'zhin-agent',
      compactedCount: 1,
      savedTokens: 10,
      totalTokensBefore: 50,
      totalTokensAfter: 40,
    });

    disposeHook();
    disposeNew();
    disposeCompact();

    expect(received).toEqual(['hook', 'new', 'compact']);
  });
});