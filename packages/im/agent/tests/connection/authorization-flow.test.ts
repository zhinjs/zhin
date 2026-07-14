import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import {
  completeConnectionAuthorization,
  requestConnectionAuthorization,
  resetAuthorizationFlowForTests,
} from '../../src/connection/authorization-flow.js';

describe('authorization-flow', () => {
  beforeEach(() => {
    resetAuthorizationFlowForTests();
  });

  it('emits required then completes via Host callback', async () => {
    const events: unknown[] = [];
    const pending = requestConnectionAuthorization({
      sessionId: 'sess-1',
      connection: 'linear',
      authUrl: 'https://host/oauth/linear',
      publish: (e) => { events.push(e); },
    });

    expect(events[0]).toMatchObject({
      type: AgentStreamEventType.AUTHORIZATION_REQUIRED,
      data: expect.objectContaining({ connection: 'linear' }),
    });

    const { getPendingAuthorizationRequestIds } = await import('../../src/connection/authorization-flow.js');
    const [requestId] = getPendingAuthorizationRequestIds();
    expect(requestId).toBeTruthy();
    const completedEvents: unknown[] = [];
    const ok = completeConnectionAuthorization(
      requestId,
      { success: true },
      (e) => { completedEvents.push(e); },
    );
    expect(ok).toBe(true);
    expect(completedEvents[0]).toMatchObject({
      type: AgentStreamEventType.AUTHORIZATION_COMPLETED,
      data: expect.objectContaining({ success: true }),
    });
    await expect(pending).resolves.toEqual({ success: true });
  });
});
