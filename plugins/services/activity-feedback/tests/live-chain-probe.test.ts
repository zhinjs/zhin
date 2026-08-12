import { describe, expect, it, vi } from 'vitest';
import {
  createActivityFeedbackAIEventHandlers,
  createActivityFeedbackOrchestratorForRuntime,
} from '../src/ai-event-binder.js';
import { createOutboundEndpointAccess } from '../src/executor.js';
import type { OutboundHost, OutboundSendInput } from '@zhin.js/plugin-runtime';

const logger = { debug: vi.fn(), error: vi.fn() };

describe('live chain probe', () => {
  it('processing.start → typing 文本经 OutboundHost 发出（默认配置）', async () => {
    const sent: OutboundSendInput[] = [];
    const outbound: OutboundHost = {
      send: vi.fn(async (input: OutboundSendInput) => {
        sent.push(input);
        return 'mid-1';
      }),
      addReaction: vi.fn(async () => 'rid-1'),
    };
    const access = createOutboundEndpointAccess(outbound, logger);
    const orchestrator = createActivityFeedbackOrchestratorForRuntime({}, logger, access);
    const handlers = createActivityFeedbackAIEventHandlers(orchestrator);

    await handlers.onProcessingStart?.({
      sessionId: 'icqq:group:1001',
      source: 'zhin-agent',
      mode: 'text',
      userId: 'u1',
      platform: 'icqq',
      endpointKey: '8596238',
      sceneId: '1001',
      messageId: 'm1',
      scope: 'group',
      hookContext: { activityFeedbackEligible: true },
    } as never);

    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toMatchObject({
      adapter: 'icqq',
      endpointKey: '8596238',
      conversation: { kind: 'group', id: '1001' },
    });
  });
});
