import { describe, expect, it, vi } from 'vitest';
import { createTaskExecutor } from '../src/task-executor.js';
import { imNotifyToSendOptions } from '../src/assistant/notification-router.js';
import type { ScheduleJob } from '../src/assistant/types.js';

function job(notify: ScheduleJob['notify']): ScheduleJob {
  return {
    id: 'sched-1', enabled: true, schedule: { kind: 'every', everyMs: 1000 },
    action: { kind: 'agent', prompt: 'say hello' }, notify,
    createdAt: 1, updatedAt: 1, state: {},
  };
}

function domainResult(output = 'hello') {
  return {
    success: true, output, durationMs: 5, toolsUsed: [], tokenUsage: { input: 1, output: 1 },
    audit: {
      jobId: 'sched-1', executionId: 'exec-1', timestamp: 1, prompt: 'say hello',
      toolsResolved: [], toolsResolvedBy: 'affinity' as const, toolsUsed: [], toolCallCount: 0,
      tokenUsage: { input: 1, output: 1 }, durationMs: 5, securityDenials: [], success: true,
      outputLength: output.length, outputStripped: [],
    },
  };
}

describe('task executor outbound seam', () => {
  it('converts im notify through the queue IM field contract shape', () => {
    expect(imNotifyToSendOptions({
      channel: 'im', target: { channel: 'im', scene: {
        platform: 'qq', endpointKey: 'bot1', sceneId: 'group1', kind: 'group',
      } },
    }, 'hello')).toEqual({
      context: 'qq', endpoint: 'bot1', id: 'group1', type: 'group', content: 'hello',
    });
  });

  it('delivers validated domain output through the normalized outbound seam', async () => {
    const sendMessage = vi.fn(async () => 'msg1');
    const execute = vi.fn(async () => domainResult());
    const executor = createTaskExecutor({
      domain: { execute },
      resolveAdapter: () => ({ sendMessage }),
    });

    const result = await executor.execute(job({
      channel: 'im', target: { channel: 'im', scene: {
        platform: 'qq', endpointKey: 'bot1', sceneId: 'group1', kind: 'group',
      } },
    }));

    expect(result.responseText).toBe('hello');
    expect(sendMessage).toHaveBeenCalledWith({
      context: 'qq', endpoint: 'bot1', id: 'group1', type: 'group', content: 'hello',
    });
  });

  it('publishes Schedule feedback identity explicitly instead of relying on turn ALS', async () => {
    const publish = vi.fn();
    const scheduled = {
      ...job({ channel: 'silent' }),
      activityFeedback: true,
      createdBy: { userId: 'owner', roles: ['trusted'] as const },
    };
    const executor = createTaskExecutor({
      activity: { publish },
      domain: { execute: vi.fn(async () => domainResult()) },
      resolveAdapter: () => undefined,
    });

    await executor.execute(scheduled);

    expect(publish).toHaveBeenNthCalledWith(1, expect.objectContaining({
      phase: 'start', job: scheduled, notify: { channel: 'silent' },
    }));
    expect(publish).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'finish' }));
  });
});
