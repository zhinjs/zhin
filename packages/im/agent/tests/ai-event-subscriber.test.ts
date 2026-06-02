import { describe, it, expect } from 'vitest';
import { getPlugin, Plugin } from '@zhin.js/core';
import { AI_EVENT_NAMES, subscribeAIEvents } from '../src/ai-event-subscriber.js';

describe('ai-event-subscriber', () => {
  it('exposes stable event name list', () => {
    expect(AI_EVENT_NAMES).toContain('ai.processing.start');
    expect(AI_EVENT_NAMES).toContain('ai.session.new');
    expect(AI_EVENT_NAMES).toContain('ai.hook');
  });

  it('dispatches to onAny and specific handlers', async () => {
    const plugin = new Plugin('/virtual/host-plugin.ts');
    const received: string[] = [];

    const dispose = subscribeAIEvents(plugin, {
      onAny: (event) => received.push(`any:${event}`),
      onProcessingStart: () => received.push('start'),
      onSessionNew: () => received.push('session:new'),
    });

    await plugin.dispatch('ai.processing.start', { sessionId: 's1', source: 'zhin-agent' });
    await plugin.dispatch('ai.session.new', { sessionId: 's1', source: 'zhin-agent', reason: 'first_message' });
    dispose();

    expect(received).toEqual([
      'any:ai.processing.start',
      'start',
      'any:ai.session.new',
      'session:new',
    ]);
  });

  it('runs handlers inside plugin AsyncLocalStorage context', async () => {
    const plugin = new Plugin('/virtual/host-plugin.ts');
    let seen: Plugin | undefined;

    subscribeAIEvents(plugin, {
      onProcessingStart: () => {
        seen = getPlugin();
      },
    });

    await plugin.dispatch('ai.processing.start', { sessionId: 's1', source: 'zhin-agent' });
    expect(seen).toBe(plugin);
  });

  it('filters by session and source and can dispose', async () => {
    const plugin = new Plugin('/virtual/host-plugin.ts');
    const received: string[] = [];

    const dispose = subscribeAIEvents(plugin, {
      onAny: (event) => received.push(event),
    }, {
      sessionId: 's1',
      source: 'zhin-agent',
    });

    await plugin.dispatch('ai.response', { sessionId: 's2', source: 'zhin-agent' });
    await plugin.dispatch('ai.response', { sessionId: 's1', source: 'ai-hook' });
    await plugin.dispatch('ai.response', { sessionId: 's1', source: 'zhin-agent' });
    dispose();
    await plugin.dispatch('ai.response', { sessionId: 's1', source: 'zhin-agent' });

    expect(received).toEqual(['ai.response']);
  });
});