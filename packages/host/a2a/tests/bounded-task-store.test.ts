import { describe, expect, it } from 'vitest';
import { TaskState, type Task } from '@a2a-js/sdk';
import { ServerCallContext, UnauthenticatedUser } from '@a2a-js/sdk/server';
import { BoundedTaskStore } from '../src/bounded-task-store.js';

const context = new ServerCallContext({ user: new UnauthenticatedUser() });

function task(id: string, state: TaskState, timestamp = '2026-01-01T00:00:00.000Z'): Task {
  return {
    id,
    contextId: 'ctx',
    status: { state, timestamp, message: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  } as Task;
}

describe('BoundedTaskStore', () => {
  it('stores copies and lists them like the SDK in-memory store', async () => {
    const store = new BoundedTaskStore();
    const original = task('a', TaskState.TASK_STATE_WORKING);
    await store.save(original, context);
    original.contextId = 'mutated';

    expect((await store.load('a', context))?.contextId).toBe('ctx');
    expect(await store.load('missing', context)).toBeUndefined();
    await store.save(task('b', TaskState.TASK_STATE_COMPLETED, '2026-01-02T00:00:00.000Z'), context);
    const firstPage = await store.list({ pageSize: 1 } as never, context);
    expect(firstPage.tasks.map((entry) => entry.id)).toEqual(['b']);
    expect(firstPage.totalSize).toBe(2);
    const secondPage = await store.list({ pageSize: 1, pageToken: firstPage.nextPageToken } as never, context);
    expect(secondPage.tasks.map((entry) => entry.id)).toEqual(['a']);
    expect(secondPage.nextPageToken).toBe('');
    // Another tenant sees nothing.
    const other = new ServerCallContext({ user: new UnauthenticatedUser(), tenant: 'other' });
    expect((await store.list({} as never, other)).tasks).toEqual([]);
  });

  it('drops finished tasks after the TTL but keeps unfinished ones', async () => {
    let now = 0;
    const store = new BoundedTaskStore({ terminalTtlMs: 1_000, now: () => now });
    await store.save(task('done', TaskState.TASK_STATE_COMPLETED), context);
    await store.save(task('running', TaskState.TASK_STATE_WORKING), context);

    now = 999;
    expect(await store.load('done', context)).toBeDefined();
    now = 1_000;
    expect(await store.load('done', context)).toBeUndefined();
    expect(await store.load('running', context)).toBeDefined();
    expect(store.size).toBe(1);
  });

  it('never grows past the cap: finished tasks are evicted first, then the oldest', async () => {
    const store = new BoundedTaskStore({ maxTasks: 3 });
    await store.save(task('w1', TaskState.TASK_STATE_WORKING), context);
    await store.save(task('d1', TaskState.TASK_STATE_FAILED), context);
    await store.save(task('w2', TaskState.TASK_STATE_WORKING), context);
    await store.save(task('w3', TaskState.TASK_STATE_WORKING), context);

    expect(store.size).toBe(3);
    expect(await store.load('d1', context)).toBeUndefined();
    expect(await store.load('w1', context)).toBeDefined();

    await store.save(task('w4', TaskState.TASK_STATE_WORKING), context);
    expect(store.size).toBe(3);
    expect(await store.load('w1', context)).toBeUndefined();
    expect(await store.load('w4', context)).toBeDefined();

    for (let i = 0; i < 50; i += 1) {
      await store.save(task(`bulk-${i}`, TaskState.TASK_STATE_COMPLETED), context);
    }
    expect(store.size).toBe(3);
  });
});
