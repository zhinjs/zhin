import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSyntheticMessage } from '@zhin.js/core';
import { resetLlmApiRegistryForTests } from '@zhin.js/ai';
import { ZhinAgent } from '../src/zhin-agent/index.js';
import { activityFeedbackAiBus } from '../src/activity-feedback/ai-bus.js';
import { wireMockLlmApi, assistantTextReply } from './helpers/mock-llm-api.js';

describe('typing 反馈事件链探针', () => {
  afterEach(() => {
    activityFeedbackAiBus.clear();
  });

  it('processTurn(eligible) → ai.processing.start 携带 platform/endpointKey/eligible', async () => {
    resetLlmApiRegistryForTests();
    const llm = wireMockLlmApi({ responder: () => assistantTextReply('好的') });
    const agent = new ZhinAgent(llm.provider as never, { maxIterations: 2 });
    const received: Array<Record<string, unknown>> = [];
    const listener = (p: unknown) => received.push(p as never);
    activityFeedbackAiBus.on('ai.processing.start', listener);

    const commMessage = createSyntheticMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      id: 'm-1',
      sender: { id: 'u1' },
      channel: { type: 'group', id: '1001' },
    });
    await agent.processTurn({
      content: '你好',
      message: commMessage,
      activityFeedbackEligible: true,
    });

    expect(received.length).toBeGreaterThan(0);
    const payload = received[0]!;
    expect(payload.platform).toBe('icqq');
    expect(payload.endpointKey).toBe('8596238');
    expect((payload.hookContext as Record<string, unknown> | undefined)?.activityFeedbackEligible).toBe(true);
    agent.dispose();
    activityFeedbackAiBus.off('ai.processing.start', listener);
  });
});
