import { describe, expect, it } from 'vitest';
import {
  DetachedTaskRunner,
  InMemoryDetachedTaskStore,
  classifyTaskInterjection,
  handleDetachedTaskCommand as handleCommand,
  routeTaskInterjection,
  type DetachedTaskExecutor,
} from '../../src/detached-task/index.js';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Executor that runs `steps` side effects, pausing at each step boundary until released. */
function gatedExecutor(effects: string[], steps = 3) {
  const gates: Array<() => void> = [];
  const applied: string[][] = [];
  const executor: DetachedTaskExecutor = {
    async run(ctx) {
      let topic = ctx.goal;
      for (let i = 0; i < steps; i++) {
        await new Promise<void>((resolve) => gates.push(resolve));
        ctx.signal.throwIfAborted();
        const steering = await ctx.takeSteering();
        applied.push([...steering]);
        if (steering.length) topic = steering.at(-1)!;
        await ctx.step('post', async () => { effects.push(`${i}:${topic}`); return i; }, { idempotencyKey: `${ctx.taskId}:${i}` });
      }
      return { summary: topic };
    },
  };
  const release = async () => {
    await waitFor(async () => gates.length > 0);
    gates.shift()!();
  };
  return { executor, release, applied };
}

const handleDetachedTaskCommand: typeof handleCommand = (runner, actor, content, presentation = { commandPrefix: '/' }) => handleCommand(runner, actor, content, presentation);

const actor = { sessionId: 's1', senderId: 'u1' };

describe('classifyTaskInterjection', () => {
  it('detects stop, redirect and unrelated conservatively', () => {
    expect(classifyTaskInterjection('取消')).toBe('stop');
    expect(classifyTaskInterjection('停止任务')).toBe('stop');
    expect(classifyTaskInterjection('stop')).toBe('stop');
    expect(classifyTaskInterjection('改成只统计周末的数据')).toBe('redirect');
    expect(classifyTaskInterjection('instead, summarize in English')).toBe('redirect');
    expect(classifyTaskInterjection('今天天气怎么样')).toBe('unrelated');
    expect(classifyTaskInterjection('停车场在哪')).toBe('unrelated');
  });

  it('lets a product TurnIntentResolver decide redirect vs unrelated', () => {
    expect(classifyTaskInterjection('再加上北京', 'steer')).toBe('redirect');
    expect(classifyTaskInterjection('改成英文', 'new')).toBe('unrelated');
    expect(classifyTaskInterjection('取消', 'new')).toBe('stop');
  });
});

describe('interjection routing', () => {
  it('redirect is applied at the next step boundary and recorded for replay', async () => {
    const effects: string[] = [];
    const { executor, release, applied } = gatedExecutor(effects);
    const store = new InMemoryDetachedTaskStore();
    const runner = new DetachedTaskRunner({ store, executors: { g: executor } });
    const task = await runner.create({ kind: 'g', goal: '统计全部', sessionId: 's1', createdBy: 'u1' });
    const done = runner.start(task.taskId);
    await release();
    await waitFor(async () => effects.length === 1);
    const routed = await routeTaskInterjection(runner, actor, '改成只统计周末');
    expect(routed).toMatchObject({ handled: true, kind: 'redirect', taskId: task.taskId });
    await release();
    await release();
    const final = await done;
    expect(final.status).toBe('done');
    expect(effects).toEqual(['0:统计全部', '1:改成只统计周末', '2:改成只统计周末']);
    expect(applied).toEqual([[], ['改成只统计周末'], []]);
    expect(final.steeringLog).toEqual([expect.objectContaining({ atStep: 1, text: '改成只统计周末' })]);
    expect(final.pendingSteering).toEqual([]);
  });

  it('stop aborts the task with no side effects after the stop', async () => {
    const effects: string[] = [];
    const { executor, release } = gatedExecutor(effects);
    const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: { g: executor } });
    const task = await runner.create({ kind: 'g', goal: 'x', sessionId: 's1', createdBy: 'u1' });
    void runner.start(task.taskId);
    await release();
    await waitFor(async () => effects.length === 1);
    const stopping = routeTaskInterjection(runner, actor, '取消');
    await release().catch(() => undefined);
    const routed = await stopping;
    expect(routed).toMatchObject({ handled: true, kind: 'stop' });
    expect((await runner.get(task.taskId))?.status).toBe('cancelled');
    expect(effects).toEqual(['0:x']);
  });

  it('unrelated messages, other sessions and other members are not handled', async () => {
    const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: { g: { run: (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))) } } });
    const task = await runner.create({ kind: 'g', goal: 'x', sessionId: 's1', createdBy: 'u1' });
    void runner.start(task.taskId);
    expect((await routeTaskInterjection(runner, actor, '你好')).handled).toBe(false);
    expect((await routeTaskInterjection(runner, { sessionId: 's2', senderId: 'u1' }, '取消')).handled).toBe(false);
    expect((await routeTaskInterjection(runner, { sessionId: 's1', senderId: 'u2' }, '取消')).handled).toBe(false);
    expect((await routeTaskInterjection(runner, { sessionId: 's1', senderId: 'u2', isMaster: true }, '取消')).handled).toBe(true);
  });
});

describe('concurrent steer vs checkpoint', () => {
  it('never loses a steer that races a checkpoint write', async () => {
    const store = new InMemoryDetachedTaskStore();
    const seen: string[] = [];
    const executor: DetachedTaskExecutor = {
      async run(ctx) {
        for (let i = 0; i < 20; i++) {
          // Steer lands while this step's checkpoint is being written.
          const write = ctx.step('noop', async () => i);
          void runner.steer(ctx.taskId, `s${i}`);
          await write;
          seen.push(...(await ctx.takeSteering()));
        }
        await new Promise((r) => setTimeout(r, 5));
        seen.push(...(await ctx.takeSteering()));
        return { summary: 'ok' };
      },
    };
    const runner = new DetachedTaskRunner({ store, executors: { e: executor } });
    const task = await runner.create({ kind: 'e', goal: 'g' });
    const final = await runner.start(task.taskId);
    expect(final.status).toBe('done');
    expect(final.steps).toHaveLength(20);
    expect(seen.sort()).toEqual(Array.from({ length: 20 }, (_, i) => `s${i}`).sort());
    expect(final.pendingSteering ?? []).toEqual([]);
  });
});

describe('/tasks commands', () => {
  it('lists, stops and redirects tasks in the session', async () => {
    const store = new InMemoryDetachedTaskStore();
    const runner = new DetachedTaskRunner({ store, executors: { g: { run: async () => ({ summary: '' }) } } });
    expect(await handleDetachedTaskCommand(runner, actor, '/tasks')).toBe('本会话没有后台任务。');
    const a = await runner.create({ kind: 'g', goal: '整理周报', sessionId: 's1', createdBy: 'u1', taskId: 'tsk_a' });
    await runner.create({ kind: 'g', goal: '别的会话', sessionId: 's2', taskId: 'tsk_b' });
    const list = await handleDetachedTaskCommand(runner, actor, '/tasks');
    expect(list).toContain('tsk_a｜排队中｜0 步｜整理周报');
    expect(list).not.toContain('tsk_b');
    expect(await handleDetachedTaskCommand(runner, actor, '/task redirect tsk_a 改成月报')).toContain('下一步');
    expect((await runner.get(a.taskId))?.pendingSteering).toEqual(['改成月报']);
    expect(await handleDetachedTaskCommand(runner, actor, '/task stop tsk_b')).toBe('找不到可操作的后台任务 tsk_b。');
    expect(await handleDetachedTaskCommand(runner, actor, '/task stop tsk_a')).toBe('已停止后台任务 tsk_a。');
    expect(await handleDetachedTaskCommand(runner, actor, '/task stop tsk_a')).toBe('后台任务 tsk_a 当前状态：已取消，无法操作。');
    expect(await handleDetachedTaskCommand(runner, actor, '/task')).toContain('用法');
    expect(await handleDetachedTaskCommand(runner, actor, '你好')).toBeNull();
  });

  it('parses /task commands in linear time even on pathological whitespace', async () => {
    const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: { g: { run: async () => ({ summary: '' }) } } });
    // The previous overlapping-quantifier regex backtracked on "/task\tstop\t" + many tabs.
    const tabs = '\t'.repeat(50_000);
    const input = `/task${tabs}stop${tabs}`;
    const started = performance.now();
    const reply = await handleDetachedTaskCommand(runner, actor, input);
    const elapsed = performance.now() - started;
    expect(reply).toBe('用法：/task stop <id>');
    expect(elapsed).toBeLessThan(200);
    expect(await handleDetachedTaskCommand(runner, actor, `/task${tabs}redirect${tabs}tsk_x${tabs}改成 只看周末`)).toBe(
      '找不到可操作的后台任务 tsk_x。',
    );
    const store = new InMemoryDetachedTaskStore();
    const live = new DetachedTaskRunner({ store, executors: { g: { run: async () => ({ summary: '' }) } } });
    await live.create({ kind: 'g', goal: 'x', sessionId: 's1', createdBy: 'u1', taskId: 'tsk_x' });
    expect(await handleDetachedTaskCommand(live, actor, '/task redirect tsk_x 改成月报 再加封面')).toContain('下一步');
    expect((await live.get('tsk_x'))?.pendingSteering).toEqual(['改成月报 再加封面']);
  });
});

it('localizes task management using an explicit prefix while retaining sender/session checks', async () => {
  const runner = new DetachedTaskRunner({ store: new InMemoryDetachedTaskStore(), executors: { g: { run: async () => ({ summary: '' }) } } });
  const presentation = { commandPrefix: '!', locale: 'en' as const };
  await runner.create({ kind: 'g', goal: '用户目标', sessionId: 's1', createdBy: 'u1', taskId: 'locale_task' });
  expect(await handleCommand(runner, actor, '!tasks', presentation)).toContain('locale_task | Queued | 0 steps | 用户目标');
  expect(await handleCommand(runner, actor, '!task', presentation)).toContain('!task stop <id>');
  expect(await handleCommand(runner, actor, '/tasks', presentation)).toBeNull();
  expect(await handleCommand(runner, actor, '/tasks')).toBeNull();
  expect(await handleCommand(runner, { ...actor, senderId: 'u2' }, '!task stop locale_task', presentation)).toContain('No controllable');
  expect(await handleCommand(runner, actor, 'task stop locale_task', { ...presentation, commandPrefix: '' })).toBe('Stopped background task locale_task.');
  expect((await runner.get('locale_task'))?.status).toBe('cancelled');
});
