import { describe, it, expect } from 'vitest';
import {
  AI_EVENT_NAMES,
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

  it('dispatch awaits async Runtime handlers', async () => {
    activityFeedbackAiBus.clear();
    const received: string[] = [];
    const dispose = subscribeAIEventsOnTarget(activityFeedbackAiBus, {
      onProcessingStart: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        received.push('start');
      },
    });

    await activityFeedbackAiBus.dispatch('ai.processing.start', {
      sessionId: 'ordered-session',
      source: 'zhin-agent',
    });

    expect(received).toEqual(['start']);
    dispose();
    activityFeedbackAiBus.clear();
  });

  it('does not deliver an in-flight event to a listener added by the next generation', async () => {
    activityFeedbackAiBus.clear();
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
    activityFeedbackAiBus.on('ai.processing.start', oldListener);

    const dispatch = activityFeedbackAiBus.dispatch('ai.processing.start', {
      sessionId: 'hmr-session',
      source: 'zhin-agent',
    });
    await Promise.resolve();
    activityFeedbackAiBus.off('ai.processing.start', oldListener);
    activityFeedbackAiBus.on('ai.processing.start', nextListener);
    releaseOld();
    await dispatch;

    expect(received).toEqual(['old:start', 'old:finish']);
    activityFeedbackAiBus.clear();
  });
});
