import { describe, expect, it, vi } from 'vitest';
import { createTaskExecutor } from '../../src/task-executor.js';
import type { ScheduleJob } from '../../src/assistant/types.js';

describe('schedule turn e2e (TaskExecutor → ScheduleExecutionDomain)', () => {
  it('passes the complete job and a demoted synthetic message to the domain', async () => {
    const execute = vi.fn(async (job: ScheduleJob, message: any) => ({
      success: true, output: 'report', durationMs: 1, toolsUsed: [], tokenUsage: { input: 1, output: 1 },
      audit: {
        jobId: job.id, executionId: 'e1', timestamp: 1, createdBy: job.createdBy,
        prompt: job.action.prompt, toolsResolved: [], toolsResolvedBy: 'affinity' as const,
        toolsUsed: [], toolCallCount: 0, tokenUsage: { input: 1, output: 1 }, durationMs: 1,
        securityDenials: [], success: true, outputLength: 6, outputStripped: [],
      },
    }));
    const executor = createTaskExecutor({
      agent: { getEventEmitter: () => ({ emit: vi.fn(), createPayload: vi.fn() }) } as any,
      domain: { execute }, resolveAdapter: () => undefined,
    });
    const job: ScheduleJob = {
      id: 'sched-daily', enabled: true, schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'daily report' }, notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {}, createdBy: { userId: 'owner', roles: ['master'] },
    };

    await executor.execute(job);

    expect(execute).toHaveBeenCalledWith(job, expect.objectContaining({
      $sender: expect.objectContaining({ id: 'owner', isMaster: false, isTrusted: true }),
    }), { preview: false });
  });
});
