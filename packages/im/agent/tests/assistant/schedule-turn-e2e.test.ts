import { describe, expect, it, vi } from 'vitest';
import { createTaskExecutor } from '../../src/task-executor.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import type { ScheduleExecutionOptions } from '../../src/schedule-domain/execution-domain.js';
import { AttemptReplayEvidence } from '../../src/schedule-domain/replay-evidence.js';

describe('schedule turn e2e (TaskExecutor → ScheduleExecutionDomain)', () => {
  it('passes the complete job without fabricating an IM Message', async () => {
    const execute = vi.fn(async (job: ScheduleJob, _options?: ScheduleExecutionOptions) => ({
      success: true, output: 'report', durationMs: 1, toolsUsed: [], tokenUsage: { input: 1, output: 1 },
      audit: {
        jobId: job.id, executionId: 'e1', timestamp: 1, createdBy: job.createdBy,
        prompt: job.action.prompt, toolsResolved: [], toolsResolvedBy: 'affinity' as const,
        toolsUsed: [], toolCallCount: 0, tokenUsage: { input: 1, output: 1 }, durationMs: 1,
        securityDenials: [], success: true, outputLength: 6, outputStripped: [],
      },
    }));
    const executor = createTaskExecutor({
      domain: { execute },
      router: createNotificationRouter({ resolveAdapter: () => undefined }),
    });
    const job: ScheduleJob = {
      id: 'sched-daily', enabled: true, schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'daily report' }, notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {}, createdBy: { userId: 'owner', roles: ['master'] },
    };

    const signal = new AbortController().signal;
    try {
      await executor.execute(job, { signal });
      const attempt = execute.mock.calls[0]?.[1]?.attempt;
      expect(attempt).toBeDefined();
      expect(execute.mock.calls).toEqual([[job, { preview: false, signal, attempt }]]);
      expect(attempt!.identity).toEqual({ jobId: job.id, number: 1,
        runId: expect.any(String), attemptId: expect.any(String), startedAt: expect.any(Number) });
      expect(attempt!.identity.runId).not.toBe(attempt!.identity.attemptId);
      expect(Object.isFrozen(attempt!.identity)).toBe(true);
      expect(attempt!.evidence).toBeInstanceOf(AttemptReplayEvidence);
      expect(attempt!.evidence.snapshot()).toEqual({ disposition: 'safe', reason: 'not_submitted', operations: [] });
      expect(attempt!.history.observations).toBe(executor.observations);
    } finally { await executor.dispose(); }
  });
});
