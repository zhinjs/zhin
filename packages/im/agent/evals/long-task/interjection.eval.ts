/**
 * long-task evals (#732, roadmap M5.5): redirect mid-task, stop with no
 * residual side effects, throttled progress, and a restart combined with two
 * interjections. Deterministic, no model; runs in `pnpm eval:agent`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DetachedTaskRunner,
  FileDetachedTaskStore,
  InMemoryDetachedTaskStore,
  handleDetachedTaskCommand,
  routeTaskInterjection,
  type DetachedTaskExecutor,
} from '../../src/detached-task/index.js';

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Posts one report per step; waits on a gate at each boundary so the test controls timing. */
function reporter(posted: string[], steps: number) {
  const gates: Array<() => void> = [];
  let crashAt: number | undefined;
  const executor: DetachedTaskExecutor = {
    async run(ctx) {
      let scope = ctx.goal;
      for (let i = 0; i < steps; i++) {
        if (i >= ctx.completedSteps.length) await new Promise<void>((resolve) => gates.push(resolve));
        ctx.signal.throwIfAborted();
        const steering = await ctx.takeSteering();
        scope = steering.at(-1) ?? scope;
        await ctx.step('post_report', async () => { posted.push(`${i + 1}:${scope}`); return scope; }, { idempotencyKey: `${ctx.taskId}:post:${i}` });
        await ctx.progress(`已完成 ${i + 1}/${steps} 份报告`);
        if (crashAt === i + 1) { crashAt = undefined; return new Promise<never>(() => {}); }
      }
      return { summary: `${steps} 份报告（${scope}）` };
    },
  };
  return {
    executor,
    crashAfter(n: number) { crashAt = n; },
    async release() { await waitFor(() => gates.length > 0); gates.shift()?.(); },
  };
}

const actor = { sessionId: 'im:qq:group:1', senderId: 'u1' };

describe('agent evals (long-task interjection)', () => {
  it('long-task-redirect-midway — redirect takes effect at the next step boundary', async () => {
    const posted: string[] = [];
    const r = reporter(posted, 3);
    const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: { r: r.executor } });
    const task = await runner.create({ kind: 'r', goal: '全部门店', sessionId: actor.sessionId, createdBy: 'u1' });
    const done = runner.start(task.taskId);
    await r.release();
    await waitFor(() => posted.length === 1);
    expect((await routeTaskInterjection(runner, actor, '改成只看华东门店')).kind).toBe('redirect');
    await r.release();
    await r.release();
    expect((await done).status).toBe('done');
    expect(posted).toEqual(['1:全部门店', '2:改成只看华东门店', '3:改成只看华东门店']);
  });

  it('long-task-stop-no-residual — stop leaves no side effects after it', async () => {
    const posted: string[] = [];
    const r = reporter(posted, 5);
    const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: { r: r.executor } });
    const task = await runner.create({ kind: 'r', goal: 'x', sessionId: actor.sessionId, createdBy: 'u1' });
    void runner.start(task.taskId);
    await r.release();
    await waitFor(() => posted.length === 1);
    // The Host passes its real command prefix (9cade3015); without one the text is not a management command.
    const stop = handleDetachedTaskCommand(runner, actor, `/task stop ${task.taskId}`, { commandPrefix: '/' });
    await r.release();
    expect(await stop).toBe(`已停止后台任务 ${task.taskId}。`);
    await new Promise((res) => setTimeout(res, 20));
    expect(posted).toEqual(['1:x']);
    const final = await runner.get(task.taskId);
    expect(final?.status).toBe('cancelled');
    expect(Object.values(final?.effects ?? {}).every((e) => e.status === 'committed')).toBe(true);
  });

  it('long-task-progress-throttled — progress pushes respect the interval and cap', async () => {
    let now = 0;
    const pushed: string[] = [];
    const exec: DetachedTaskExecutor = {
      async run(ctx) {
        for (let i = 0; i < 10; i++) { now += 20_000; await ctx.progress(`已处理 ${i + 1} 批`); }
        return { summary: 'ok' };
      },
    };
    const runner = new DetachedTaskRunner({
      store: new InMemoryDetachedTaskStore(), now: () => now, executors: { e: exec },
      deliver: async (_c, text) => { pushed.push(text); },
      config: { progressIntervalMs: 60_000, maxProgressUpdates: 2 },
    });
    const task = await runner.create({ kind: 'e', goal: 'g' });
    await runner.start(task.taskId);
    expect(pushed.filter((t) => t.startsWith('⏳'))).toEqual(['⏳ 已处理 3 批', '⏳ 已处理 6 批']);
  });

  it('long-task-restart-two-interjections — completes after one restart and two interjections; trace replays', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-eval-long-task-'));
    try {
      const posted: string[] = [];
      const r = reporter(posted, 4);
      r.crashAfter(2);
      const before = new DetachedTaskRunner({ store: new FileDetachedTaskStore(dir), executors: { r: r.executor } });
      const task = await before.create({ kind: 'r', goal: '全部', sessionId: actor.sessionId, createdBy: 'u1' });
      void before.start(task.taskId);
      await r.release();
      await waitFor(() => posted.length === 1);
      await routeTaskInterjection(before, actor, '改成只看周末');
      await r.release();
      await waitFor(async () => (await before.get(task.taskId))?.steps.length === 2);

      // Process restarts; a second interjection arrives while it comes back.
      const after = new DetachedTaskRunner({ store: new FileDetachedTaskStore(dir), executors: { r: r.executor } });
      await routeTaskInterjection(after, actor, 'instead 只看周六');
      const [resumed] = await after.recover();
      await r.release();
      await r.release();
      const final = await resumed;

      expect(final.status).toBe('done');
      expect(posted).toEqual(['1:全部', '2:改成只看周末', '3:instead 只看周六', '4:instead 只看周六']);
      expect(final.steps.map((s) => s.tool)).toEqual(['post_report', 'post_report', 'post_report', 'post_report']);
      expect(final.steeringLog?.map((s) => [s.atStep, s.text])).toEqual([[1, '改成只看周末'], [2, 'instead 只看周六']]);
      expect(final.attempts).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
