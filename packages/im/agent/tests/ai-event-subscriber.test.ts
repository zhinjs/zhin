import { describe, it, expect } from 'vitest';
import {
  AI_EVENT_NAMES,
  subscribeAIEventsOnTarget,
} from '../src/ai-event-subscriber.js';
import { AgentEventBus } from '../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../src/event/event-emitter.js';

describe('ai-event-subscriber', () => {
  const events = new AgentEventBus();
  it('exposes stable event name list', () => {
    expect(AI_EVENT_NAMES).toContain('ai.processing.start');
    expect(AI_EVENT_NAMES).toContain('ai.session.new');
    expect(AI_EVENT_NAMES).toContain('ai.hook');
  });

  it('subscribeAIEventsOnTarget works without Plugin ALS', async () => {
    events.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(events, {
      onProcessingStart: (payload) => {
        received.push(payload.sessionId);
      },
    });

    events.emit('ai.processing.start', {
      sessionId: 'runtime-s1',
      source: 'zhin-agent',
    });
    await Promise.resolve();
    dispose();
    events.emit('ai.processing.start', {
      sessionId: 'runtime-s2',
      source: 'zhin-agent',
    });
    await Promise.resolve();

    expect(received).toEqual(['runtime-s1']);
    events.clear();
  });

  it('ZhinAgentEventEmitter.emit fans out to events', async () => {
    events.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(events, {
      onTypingStart: (payload) => {
        received.push(payload.sessionId);
      },
    });

    const emitter = new ZhinAgentEventEmitter(events);
    emitter.emit('ai.typing.start', {
      sessionId: 'fanout-1',
      source: 'zhin-agent',
    });
    await Promise.resolve();
    dispose();
    events.clear();

    expect(received).toEqual(['fanout-1']);
  });

  it('ZhinAgentEventEmitter dispatches without owning a host plugin', async () => {
    events.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(events, {
      onProcessingStart: (payload) => {
        received.push(payload.sessionId);
      },
    });

    const emitter = new ZhinAgentEventEmitter(events);
    expect(emitter).not.toHaveProperty('hostPlugin');
    await emitter.dispatch('ai.processing.start', {
      sessionId: 'runtime-dispatch-1',
      source: 'zhin-agent',
      hookContext: { activityFeedbackEligible: true },
    });
    dispose();
    events.clear();

    expect(received).toEqual(['runtime-dispatch-1']);
  });

  it('dispatch awaits async Runtime handlers', async () => {
    events.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(events, {
      onProcessingStart: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        received.push('start');
      },
    });

    await events.dispatch('ai.processing.start', {
      sessionId: 'ordered-session',
      source: 'zhin-agent',
    });

    expect(received).toEqual(['start']);
    dispose();
    events.clear();
  });

  it('does not deliver an in-flight event to a listener added by the next generation', async () => {
    events.clear();
    const received: string[] = [];
    let releaseOld!: () => void;
    const oldPending = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldListener = async () => {
      received.push('old:start');
      await oldPending;
      received.push('old:finish');
    };
    const nextListener = () => {
      received.push('next');
    };
    events.on('ai.processing.start', oldListener);

    const dispatch = events.dispatch('ai.processing.start', {
      sessionId: 'hmr-session',
      source: 'zhin-agent',
    });
    await Promise.resolve();
    events.off('ai.processing.start', oldListener);
    events.on('ai.processing.start', nextListener);
    releaseOld();
    await dispatch;

    expect(received).toEqual(['old:start', 'old:finish']);
    events.clear();
  });

  it('isolates lifecycle events between Runtime generations', async () => {
    const previous = new AgentEventBus();
    const candidate = new AgentEventBus();
    const received: string[] = [];
    previous.on('ai.processing.start', payload => received.push(`previous:${payload.sessionId}`));
    candidate.on('ai.processing.start', payload => received.push(`candidate:${payload.sessionId}`));

    await previous.dispatch('ai.processing.start', {
      sessionId: 'old-turn',
      source: 'zhin-agent',
    });

    expect(received).toEqual(['previous:old-turn']);
  });
});
