import { describe, expect, it, vi } from 'vitest';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { createTestSessionPort, mockAgent } from './session-test-helpers.js';

describe('HttpAgentSessionStore', () => {
  it('startSession emits session.started and completes turn', async () => {
    const agent = mockAgent([
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      { type: 'chunk', text: 'Hello', accumulated: 'Hello' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'Hello' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    ]);
    const { store } = createTestSessionPort(agent);

    const { sessionId, continuationToken } = await store.startSession('Hi');
    expect(sessionId).toMatch(/^ses_/);
    expect(continuationToken).toMatch(/^zhin:/);

    await vi.waitFor(() => {
      const session = store.getSession(sessionId);
      expect(session?.status).toBe('waiting');
    }, { timeout: 3000 });

    const session = store.getSession(sessionId)!;
    expect(session.events.some((e) => e.type === AgentStreamEventType.SESSION_STARTED)).toBe(true);
    expect(session.events.some((e) => e.type === AgentStreamEventType.MESSAGE_COMPLETED)).toBe(true);
    expect(session.events.some((e) => e.type === AgentStreamEventType.SESSION_WAITING)).toBe(true);
    const waiting = session.events.find((e) => e.type === AgentStreamEventType.SESSION_WAITING);
    expect(waiting?.data?.continuationToken).toBe(session.continuationToken);
    expect(waiting?.data?.reason).toBe('idle');
    expect(waiting?.data?.parked).toBe(false);
    expect(session.continuationToken).not.toBe(continuationToken);
  });

  it('rejects stale continuation token', async () => {
    const agent = mockAgent([
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'ok' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    ]);
    const { store } = createTestSessionPort(agent);
    const { sessionId, continuationToken } = await store.startSession('first');

    await vi.waitFor(() => {
      expect(store.getSession(sessionId)?.status).toBe('waiting');
    });

    const result = await store.continueSession(sessionId, continuationToken, 'second');
    expect(result).toEqual({ ok: false, error: 'CONTINUATION_TOKEN_STALE' });
  });

  it('continueSession with fresh token starts next turn', async () => {
    const agent = mockAgent([
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'ok' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    ]);
    const { store } = createTestSessionPort(agent);
    const { sessionId } = await store.startSession('first');

    await vi.waitFor(() => {
      expect(store.getSession(sessionId)?.status).toBe('waiting');
    });

    const freshToken = store.getSession(sessionId)!.continuationToken;
    const result = await store.continueSession(sessionId, freshToken, 'second');
    expect(result).toEqual({ ok: true, continuationToken: expect.any(String) });
    if (result.ok) {
      expect(result.continuationToken).toMatch(/^zhin:/);
    }

    await vi.waitFor(() => {
      const events = store.getSession(sessionId)?.events ?? [];
      const received = events.filter((e) => e.type === AgentStreamEventType.MESSAGE_RECEIVED);
      expect(received.length).toBeGreaterThanOrEqual(2);
    });
  });
});
