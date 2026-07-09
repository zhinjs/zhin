import { describe, it, expect, vi } from 'vitest';
import { logAgentLoopIterationEnd } from '../../src/internal/phase-trace.js';

describe('logAgentLoopIterationEnd', () => {
  it('emits agent_loop.iteration.end with cache fields', () => {
    const onPhaseTrace = vi.fn();
    logAgentLoopIterationEnd(
      { phaseTraceEnabled: true, onPhaseTrace },
      'sess-1',
      {
        iteration: 2,
        model: 'claude-haiku',
        label: 'orchestrator',
        stopReason: 'toolCalls',
        toolNames: 'run_deferred_task',
        usage: {
          input: 5855,
          output: 42,
          cacheRead: 4536,
          cacheWrite: 0,
          totalTokens: 5897,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    );
    expect(onPhaseTrace).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'agent_loop.iteration.end',
      sessionId: 'sess-1',
      extra: expect.objectContaining({
        iteration: 2,
        cacheReadTokens: 4536,
        toolNames: 'run_deferred_task',
        stopReason: 'toolCalls',
      }),
    }));
  });
});
