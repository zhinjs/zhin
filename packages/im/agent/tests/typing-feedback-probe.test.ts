import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSyntheticMessage, type Tool } from '@zhin.js/core';
import { ZhinAgent } from '../src/zhin-agent/index.js';
import { AgentEventBus } from '../src/event/ai-event-bus.js';
import {
  wireMockLlmApi,
  assistantTextReply,
  assistantToolCallReply,
} from './helpers/mock-llm-api.js';

describe('typing 反馈事件链探针', () => {
  const events = new AgentEventBus();
  afterEach(() => {
    events.clear();
  });

  it('processTurn(eligible) → ai.processing.start 携带 platform/endpointKey/eligible', async () => {
    const llm = wireMockLlmApi({ responder: () => assistantTextReply('好的') });
    const agent = new ZhinAgent(llm.provider as never, { maxIterations: 2 }, events, llm.runtime);
    const received: Array<Record<string, unknown>> = [];
    const listener = (p: unknown) => received.push(p as never);
    events.on('ai.processing.start', listener);

    const commMessage = createSyntheticMessage({
      conversation: { endpoint: { adapter: 'icqq', id: '8596238' }, kind: 'group', id: '1001' },
      endpointId: '8596238', clientAdapter: 'icqq', messageId: 'm-1', sender: { id: 'u1', roles: ['user'] },
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
    events.off('ai.processing.start', listener);
  });

  it('processTurn failure emits an awaited terminal error and typing stop', async () => {
    const llm = wireMockLlmApi();
    const agent = new ZhinAgent(llm.provider as never, { maxIterations: 2 }, events, llm.runtime);
    const received: string[] = [];
    const onError = () => { received.push('error'); };
    const onStop = () => { received.push('stop'); };
    events.on('ai.processing.error', onError);
    events.on('ai.typing.stop', onStop);
    const commMessage = createSyntheticMessage({
      conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private', id: '' },
      endpointId: 'bot', clientAdapter: 'sandbox', messageId: 'm-error', sender: { id: 'u1', roles: ['user'] },
    });

    await expect(agent.processTurn({
      content: 'fail',
      message: commMessage,
      activityFeedbackEligible: true,
    })).rejects.toThrow('IM Turn context requires');

    expect(received).toEqual(['error', 'stop']);
    agent.dispose();
  });

  it('processTurn projects tool and iteration events to the shared activity bus', async () => {
    let call = 0;
    const llm = wireMockLlmApi({
      responder: () => call++ === 0
        ? assistantToolCallReply([{ id: 'call-1', name: 'status_probe', arguments: {} }])
        : assistantTextReply('done'),
    });
    const agent = new ZhinAgent(llm.provider as never, { maxIterations: 3 }, events, llm.runtime);
    const received: string[] = [];
    events.on('ai.tool.call', () => { received.push('tool.call'); });
    events.on('ai.tool.result', () => { received.push('tool.result'); });
    events.on('ai.processing.start', (payload) => {
      if (payload.iterations === 2) received.push('iteration.2');
    });
    const tool: Tool = {
      name: 'status_probe',
      description: 'status probe',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => 'ok'),
    };
    const commMessage = createSyntheticMessage({
      conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private', id: 'u1' },
      endpointId: 'bot', clientAdapter: 'sandbox', messageId: 'm-tool', sender: { id: 'u1', roles: ['user'] },
    });

    await agent.processTurn({
      content: '请调用 status_probe',
      message: commMessage,
      tools: [tool],
      activityFeedbackEligible: true,
    });

    expect(received).toEqual(expect.arrayContaining(['tool.call', 'tool.result', 'iteration.2']));
    agent.dispose();
  });
});
