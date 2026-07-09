import { describe, expect, it, vi } from 'vitest';
import { createTaskExecutor } from '../../src/task-executor.js';

describe('schedule turn e2e (task executor → ZhinAgent)', () => {
  it('scheduled execution initializes scheduleContext and runs agent.process', async () => {
    const initScheduleTurnContext = vi.fn();
    const process = vi.fn(async () => [{ type: 'text', content: 'scheduled ok' }]);
    const executor = createTaskExecutor({
      agent: { process, initScheduleTurnContext } as any,
      resolveAdapter: () => undefined,
    });

    const result = await executor.executeTask({
      prompt: 'daily report',
      timeContext: true,
      executionPlan: {
        prompt: 'daily report',
        tools: ['web_search'],
        skills: ['reporting'],
        confirmed: true,
      },
      scheduleJobId: 'job-42',
      notify: { channel: 'silent' },
    });

    expect(result.success).toBe(true);
    expect(result.responseText).toBe('scheduled ok');
    expect(initScheduleTurnContext).toHaveBeenCalledWith(expect.objectContaining({
      executionPlan: expect.objectContaining({ prompt: 'daily report', confirmed: true }),
      jobId: 'job-42',
    }));
    expect(process).toHaveBeenCalledTimes(1);
    const commMessage = process.mock.calls[0][1];
    expect(commMessage.$sender?.id).toBeDefined();
  });
});
