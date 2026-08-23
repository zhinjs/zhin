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

  it('serializes schedule activity terminals with execution for the same scene', async () => {
    let releaseFirst!: () => void;
    const phases: string[] = [];
    const execute = vi.fn(async () => {
      if (execute.mock.calls.length === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return domainResult();
    });
    const scheduled = { ...job({ channel: 'silent' }), activityFeedback: true };
    const executor = createTaskExecutor({
      activity: { publish: (event) => { phases.push(event.phase); } },
      domain: { execute },
      resolveAdapter: () => undefined,
    });

    const first = executor.execute(scheduled);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const second = executor.execute(scheduled);
    await Promise.resolve();
    expect(phases).toEqual(['start']);
    releaseFirst();
    await Promise.all([first, second]);

    expect(phases).toEqual(['start', 'finish', 'start', 'finish']);
  });

  it('does not serialize independent executor generations through module state', async () => {
    let releaseFirst!: () => void;
    const firstDomain = vi.fn(async () => {
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return domainResult('first');
    });
    const secondDomain = vi.fn(async () => domainResult('second'));
    const notify = { channel: 'silent' as const };
    const firstExecutor = createTaskExecutor({ domain: { execute: firstDomain }, resolveAdapter: () => undefined });
    const secondExecutor = createTaskExecutor({ domain: { execute: secondDomain }, resolveAdapter: () => undefined });

    const first = firstExecutor.execute(job(notify));
    await vi.waitFor(() => expect(firstDomain).toHaveBeenCalledTimes(1));
    const second = secondExecutor.execute(job(notify));
    await vi.waitFor(() => expect(secondDomain).toHaveBeenCalledTimes(1));
    await expect(second).resolves.toMatchObject({ responseText: 'second' });
    releaseFirst();
    await first;
  });

  it('dispose waits for admitted execution and rejects new work', async () => {
    let release!: () => void;
    const executor = createTaskExecutor({
      domain: { execute: vi.fn(async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return domainResult();
      }) },
      resolveAdapter: () => undefined,
    });
    const running = executor.execute(job({ channel: 'silent' }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    let settled = false;
    const disposal = executor.dispose().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(executor.execute(job({ channel: 'silent' }))).rejects.toThrow(/disposed/i);
    release();
    await running;
    await disposal;
  });

  it('concurrent dispose callers share completion instead of returning early', async () => {
    let release!: () => void;
    const executor = createTaskExecutor({
      domain: { execute: vi.fn(async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return domainResult();
      }) },
      resolveAdapter: () => undefined,
    });
    const running = executor.execute(job({ channel: 'silent' }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    const first = executor.dispose();
    let secondSettled = false;
    const repeated = executor.dispose();
    expect(repeated).toBe(first);
    const second = repeated.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    release();
    await Promise.all([running, first, second]);
  });

  it('legacy global drain fails explicitly instead of reporting a false successful drain', async () => {
    const { drainTaskExecutorLocks } = await import('../src/task-executor.js');
    await expect(drainTaskExecutorLocks(10)).rejects.toThrow(/executor\.dispose/i);
  });

  it('fails fast when an injected execution callback awaits its own executor disposal', async () => {
    const holder: { executor?: ReturnType<typeof createTaskExecutor> } = {};
    const executor = createTaskExecutor({
      domain: {
        execute: vi.fn(async () => {
          await holder.executor!.dispose();
          return domainResult();
        }),
      },
      resolveAdapter: () => undefined,
    });
    holder.executor = executor;

    const verdict = Promise.race([
      executor.execute(job({ channel: 'silent' })),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('self-dispose timed out')), 100);
        timer.unref?.();
      }),
    ]);

    await expect(verdict).rejects.toThrow(/cannot dispose.*inside|execution callback/i);
    await executor.dispose();
  });

  it('cancels scene-lock admission without entering the domain', async () => {
    let releaseFirst!: () => void;
    const execute = vi.fn(async () => {
      if (execute.mock.calls.length === 1) {
        await new Promise<void>(resolve => {
          releaseFirst = resolve;
        });
      }
      return domainResult();
    });
    const executor = createTaskExecutor({
      domain: { execute },
      resolveAdapter: () => undefined,
    });
    const scheduled = job({ channel: 'silent' });

    const first = executor.execute(scheduled);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const owner = new AbortController();
    const waiting = executor.execute(scheduled, { signal: owner.signal });
    owner.abort(new Error('generation retired'));

    await expect(waiting).rejects.toThrow('generation retired');
    expect(execute).toHaveBeenCalledTimes(1);
    releaseFirst();
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it('does not deliver output when a domain ignores cancellation and returns late', async () => {
    let releaseDomain!: () => void;
    const sendMessage = vi.fn(async () => 'unexpected');
    const executor = createTaskExecutor({
      domain: {
        execute: vi.fn(async () => {
          await new Promise<void>(resolve => {
            releaseDomain = resolve;
          });
          return domainResult('late');
        }),
      },
      resolveAdapter: () => ({ sendMessage }),
    });
    const owner = new AbortController();
    const execution = executor.execute(job({
      channel: 'im', target: { channel: 'im', scene: {
        platform: 'qq', endpointKey: 'bot1', sceneId: 'group1', kind: 'group',
      } },
    }), { signal: owner.signal });
    await vi.waitFor(() => expect(releaseDomain).toBeTypeOf('function'));

    owner.abort(new Error('generation retired'));
    releaseDomain();

    await expect(execution).rejects.toThrow('generation retired');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
