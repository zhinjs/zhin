import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DetachedTaskRunner,
  DetachedTaskTransitionError,
  FileDetachedTaskStore,
  InMemoryDetachedTaskStore,
  canTransitionDetachedTask,
  type DetachedTaskContext,
  type DetachedTaskExecutor,
  type DetachedTaskPolicy,
} from '../../src/detached-task/index.js';

/** Executor that sends three messages (side effects) and crashes once after the second. */
function crashingSender(sent: string[], crash: { after?: number }): DetachedTaskExecutor {
  return {
    async run(ctx: DetachedTaskContext) {
      for (let i = 1; i <= 3; i++) {
        await ctx.step('send_message', async () => {
          sent.push(`msg-${i}`);
          return { ok: i };
        }, { idempotencyKey: `${ctx.taskId}:send:${i}` });
        if (crash.after === i) {
          crash.after = undefined;
          throw new SimulatedCrash();
        }
      }
      return { summary: `sent ${sent.length}` };
    },
  };
}

class SimulatedCrash extends Error {}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Simulate a process crash: the runner loses its in-memory state; status stays `running` on disk. */
async function crashMidRun(runner: DetachedTaskRunner, taskId: string) {
  const record = await runner.start(taskId);
  return record;
}

describe('detached task state machine', () => {
  it('allows only documented transitions and keeps terminal states final', () => {
    expect(canTransitionDetachedTask('queued', 'running')).toBe(true);
    expect(canTransitionDetachedTask('running', 'waiting_approval')).toBe(true);
    expect(canTransitionDetachedTask('done', 'running')).toBe(false);
    expect(canTransitionDetachedTask('cancelled', 'queued')).toBe(false);
    expect(canTransitionDetachedTask('queued', 'done')).toBe(false);
  });
});

describe('DetachedTaskRunner', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhin-detached-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resumes from the last checkpoint after a restart without repeating side effects', async () => {
    const sent: string[] = [];
    const crash = { after: 2 };
    const store = new FileDetachedTaskStore(dir);
    const delivered: string[] = [];
    // A crash is an uncaught failure that never reaches the runner's bookkeeping.
    const executor = crashingSender(sent, crash);
    const crashing: DetachedTaskExecutor = {
      run: (ctx) => executor.run(ctx).catch((error) => {
        if (error instanceof SimulatedCrash) return new Promise<never>(() => {}); // process "dies": never settles
        throw error;
      }),
    };
    const first = new DetachedTaskRunner({ store, executors: { send: crashing } });
    const task = await first.create({ kind: 'send', goal: 'send three messages' });
    void crashMidRun(first, task.taskId);
    await waitFor(async () => (await store.load(task.taskId))?.steps.length === 2);
    await new Promise((r) => setTimeout(r, 10));
    const onDisk = await store.load(task.taskId);
    expect(onDisk?.status).toBe('running');
    expect(onDisk?.steps).toHaveLength(2);

    // New process: fresh runner over the same files.
    const second = new DetachedTaskRunner({
      store: new FileDetachedTaskStore(dir),
      executors: { send: executor },
      deliver: async (_channel, text) => { delivered.push(text); },
    });
    const runs = await second.recover();
    expect(runs).toHaveLength(1);
    const final = await runs[0];
    expect(final.status).toBe('done');
    expect(sent).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(final.steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(Object.values(final.effects).every((e) => e.status === 'committed')).toBe(true);
    expect(final.attempts).toBe(2);
    expect(delivered.at(-1)).toContain('后台任务完成');
  });

  it('does not re-run a side effect whose outcome is unknown after a crash; asks for approval instead', async () => {
    const store = new InMemoryDetachedTaskStore();
    let calls = 0;
    const hanging: DetachedTaskExecutor = {
      async run(ctx) {
        await ctx.step('charge', () => { calls++; return new Promise<never>(() => {}); }, { idempotencyKey: 'charge-1' });
        return { summary: 'x' };
      },
    };
    const first = new DetachedTaskRunner({ store, executors: { pay: hanging } });
    const task = await first.create({ kind: 'pay', goal: 'pay', approval: { sceneId: 'owner' } });
    void first.start(task.taskId);
    await waitFor(async () => (await store.load(task.taskId))?.effects['charge-1']?.status === 'executing');
    expect((await store.load(task.taskId))?.effects['charge-1']?.status).toBe('executing');

    const approvals: string[] = [];
    const second = new DetachedTaskRunner({
      store,
      executors: { pay: hanging },
      deliver: async (channel, text) => { if (channel?.sceneId === 'owner') approvals.push(text); },
    });
    const [run] = await second.recover();
    const record = await run;
    expect(calls).toBe(1);
    expect(record.status).toBe('waiting_approval');
    expect(record.effects['charge-1']?.status).toBe('outcome_unknown');
    expect(approvals).toHaveLength(1);
  });

  it('keeps the frozen creation-time policy and never widens it on resume', async () => {
    const store = new InMemoryDetachedTaskStore();
    const live: { shell?: { security: 'deny' | 'full' } } = { shell: { security: 'deny' } };
    const seen: DetachedTaskPolicy[] = [];
    const executor: DetachedTaskExecutor = {
      async run(ctx) {
        seen.push(ctx.policy);
        expect(Object.isFrozen(ctx.policy)).toBe(true);
        expect(() => { (ctx.policy as { shell?: unknown }).shell = { security: 'full' }; }).toThrow();
        if (seen.length === 1) ctx.awaitApproval('need ok');
        return { summary: 'ok' };
      },
    };
    const runner = new DetachedTaskRunner({ store, executors: { e: executor } });
    const task = await runner.create({ kind: 'e', goal: 'g', policy: live as DetachedTaskPolicy });
    // The creating turn later gets broader authority; the task must not see it.
    live.shell!.security = 'full';
    expect((await runner.start(task.taskId)).status).toBe('waiting_approval');
    expect((await runner.approve(task.taskId)).status).toBe('done');
    expect(seen.map((p) => p.shell?.security)).toEqual(['deny', 'deny']);
  });

  it('defaults to an empty (no shell, no filesystem) policy', async () => {
    const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: { e: { run: async () => ({ summary: '' }) } } });
    const task = await runner.create({ kind: 'e', goal: 'g' });
    expect(task.policy).toEqual({});
  });

  it('fails a task that keeps crashing after maxResumeAttempts', async () => {
    const store = new InMemoryDetachedTaskStore();
    const runner = new DetachedTaskRunner({ store, executors: { e: { run: async () => ({ summary: '' }) } }, config: { maxResumeAttempts: 1 } });
    const task = await runner.create({ kind: 'e', goal: 'g' });
    await store.save({ ...task, status: 'running', attempts: 1 });
    expect(await runner.recover()).toHaveLength(0);
    expect((await store.load(task.taskId))?.status).toBe('failed');
  });

  it('cancels a running task and rejects illegal transitions', async () => {
    const store = new InMemoryDetachedTaskStore();
    const runner = new DetachedTaskRunner({
      store,
      executors: { e: { run: (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))) } },
    });
    const task = await runner.create({ kind: 'e', goal: 'g' });
    void runner.start(task.taskId);
    await waitFor(async () => (await store.load(task.taskId))?.status === 'running');
    expect((await runner.cancel(task.taskId)).status).toBe('cancelled');
    await expect(runner.resume(task.taskId)).rejects.toBeInstanceOf(DetachedTaskTransitionError);
  });

  it('throttles progress pushes with the #718 reporter', async () => {
    let now = 0;
    const pushed: string[] = [];
    const runner = new DetachedTaskRunner({
      store: new InMemoryDetachedTaskStore(),
      now: () => now,
      config: { progressIntervalMs: 1_000, maxProgressUpdates: 2 },
      deliver: async (_c, text) => { pushed.push(text); },
      executors: {
        e: {
          async run(ctx) {
            for (let i = 0; i < 5; i++) {
              now += 600;
              await ctx.progress(`已处理第 ${i + 1} 批数据`);
            }
            return { summary: 'done' };
          },
        },
      },
    });
    const task = await runner.create({ kind: 'e', goal: 'g' });
    await runner.start(task.taskId);
    const progress = pushed.filter((t) => t.startsWith('⏳'));
    expect(progress).toEqual(['⏳ 已处理第 2 批数据', '⏳ 已处理第 4 批数据']);
  });
});
