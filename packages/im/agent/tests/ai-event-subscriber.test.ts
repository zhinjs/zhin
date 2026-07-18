import { describe, it, expect } from 'vitest';
import { getPlugin, Plugin } from '@zhin.js/core';
import {
  AI_EVENT_NAMES,
  subscribeAIEvents,
  subscribeAIEventsOnTarget,
} from '../src/ai-event-subscriber.js';
import { activityFeedbackAiBus } from '../src/activity-feedback/ai-bus.js';
import { ZhinAgentEventEmitter } from '../src/event/event-emitter.js';

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

  it('subscribeAIEventsOnTarget works without Plugin ALS', async () => {
    activityFeedbackAiBus.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(activityFeedbackAiBus, {
      onProcessingStart: (payload) => {
        received.push(payload.sessionId);
      },
    });

    activityFeedbackAiBus.emit('ai.processing.start', {
      sessionId: 'runtime-s1',
      source: 'zhin-agent',
    });
    await Promise.resolve();
    dispose();
    activityFeedbackAiBus.emit('ai.processing.start', {
      sessionId: 'runtime-s2',
      source: 'zhin-agent',
    });
    await Promise.resolve();

    expect(received).toEqual(['runtime-s1']);
    activityFeedbackAiBus.clear();
  });

  it('ZhinAgentEventEmitter.emit fans out to activityFeedbackAiBus', async () => {
    activityFeedbackAiBus.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(activityFeedbackAiBus, {
      onTypingStart: (payload) => {
        received.push(payload.sessionId);
      },
    });

    const emitter = new ZhinAgentEventEmitter();
    emitter.emit('ai.typing.start', {
      sessionId: 'fanout-1',
      source: 'zhin-agent',
    });
    await Promise.resolve();
    dispose();
    activityFeedbackAiBus.clear();

    expect(received).toEqual(['fanout-1']);
  });

  it('ZhinAgentEventEmitter.dispatch fans out without host plugin (Runtime)', async () => {
    activityFeedbackAiBus.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(activityFeedbackAiBus, {
      onProcessingStart: (payload) => {
        received.push(payload.sessionId);
      },
    });

    const emitter = new ZhinAgentEventEmitter();
    await emitter.dispatch('ai.processing.start', {
      sessionId: 'runtime-dispatch-1',
      source: 'zhin-agent',
      hookContext: { activityFeedbackEligible: true },
    });
    dispose();
    activityFeedbackAiBus.clear();

    expect(received).toEqual(['runtime-dispatch-1']);
  });
});
