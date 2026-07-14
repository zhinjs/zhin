import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { AgentStepStatus } from '@zhin.js/ai/agent-step-checkpoint';
import { FileHttpSessionPersistence } from '../../src/session/http-session-persistence.js';
import { createTestSessionPort, mockAgent } from './session-test-helpers.js';

describe('HttpAgentSessionStore P3', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('records step.started and step.completed on turn', async () => {
    const agent = mockAgent([
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'ok' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    ]);
    const { store } = createTestSessionPort(agent);
    const { sessionId } = await store.startSession('hi');

    await vi.waitFor(() => {
      expect(store.getSession(sessionId)?.status).toBe('waiting');
    });

    const events = store.getSession(sessionId)!.events;
    expect(events.some((e) => e.type === AgentStreamEventType.STEP_STARTED)).toBe(true);
    expect(events.some((e) => e.type === AgentStreamEventType.STEP_COMPLETED)).toBe(true);
    expect(store.getSession(sessionId)!.steps[0]?.status).toBe(AgentStepStatus.COMPLETED);
  });

  it('persists and hydrates session from disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhin-http-sess-'));
    const agent = mockAgent([
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'ok' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    ]);
    const port1 = createTestSessionPort(agent, { dataDir: dir });
    const { sessionId } = await port1.store.startSession('persist me');

    await vi.waitFor(() => {
      expect(port1.store.getSession(sessionId)?.status).toBe('waiting');
    });

    await port1.store.persistSession(sessionId);

    const port2 = createTestSessionPort(agent, { dataDir: dir });
    const hydrated = await port2.store.hydrateSession(sessionId);
    expect(hydrated?.sessionId).toBe(sessionId);
    expect(hydrated?.events.length).toBeGreaterThan(0);
    expect(hydrated?.steps.length).toBe(1);
  });

  it('emits session.waiting with parked=true during active turn on input.requested', async () => {
    let releaseTurn!: () => void;
    const turnGate = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const agent = {
      processStream: vi.fn(async function* () {
        yield { type: 'turn_start', sessionId: 's', turnId: 't' };
        await turnGate;
        yield {
          type: 'turn_end',
          output: [{ type: 'text', content: 'ok' }],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }),
    } as unknown as import('../../src/zhin-agent/index.js').ZhinAgent;

    const { store, publishHttpSessionEvent } = createTestSessionPort(agent);
    const { sessionId } = await store.startSession('hi');

    await vi.waitFor(() => {
      expect(store.getSession(sessionId)?.turnRunning).toBe(true);
    });

    await publishHttpSessionEvent(sessionId, {
      type: AgentStreamEventType.INPUT_REQUESTED,
      data: { requestId: 'req-99', kind: 'approval', toolName: 'bash' },
    });

    const session = store.getSession(sessionId)!;
    const parkedWaiting = session.events.filter(
      (e) => e.type === AgentStreamEventType.SESSION_WAITING && e.data?.parked === true,
    );
    expect(parkedWaiting.length).toBeGreaterThanOrEqual(1);
    expect(parkedWaiting[0]?.data?.reason).toBe('parked');
    expect(session.pendingRequestIds).toContain('req-99');

    await publishHttpSessionEvent(sessionId, {
      type: AgentStreamEventType.INPUT_COMPLETED,
      data: { requestId: 'req-99', kind: 'approval', approved: true },
    });

    releaseTurn();
    await vi.waitFor(() => {
      expect(store.getSession(sessionId)?.turnRunning).toBe(false);
    });

    const events = store.getSession(sessionId)!.events;
    const idleWaiting = events.filter(
      (e) => e.type === AgentStreamEventType.SESSION_WAITING && e.data?.reason === 'idle',
    );
    expect(idleWaiting.length).toBeGreaterThanOrEqual(1);
  });
});
