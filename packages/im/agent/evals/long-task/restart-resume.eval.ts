/**
 * long-task eval (#731, roadmap M5.5): a detached task is interrupted by a
 * simulated process restart and must resume from its last checkpoint with no
 * duplicate side effects. Runs in `pnpm eval:agent`; deterministic, no model.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DetachedTaskRunner, FileDetachedTaskStore, type DetachedTaskExecutor } from '../../src/detached-task/index.js';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('agent evals (long-task)', () => {
  it('long-task-restart-resume — resumes after restart from the last checkpoint without duplicate side effects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-eval-long-task-'));
    try {
      const sideEffects: string[] = [];
      let crashAfter: number | undefined = 2;
      const report: DetachedTaskExecutor = {
        async run(ctx) {
          const items = ['周一', '周二', '周三', '周四'];
          for (const [i, item] of items.entries()) {
            await ctx.step('post_report', async () => {
              sideEffects.push(item);
              return { posted: item };
            }, { idempotencyKey: `${ctx.taskId}:post:${item}` });
            await ctx.progress(`已发布 ${i + 1}/${items.length} 份日报`);
            if (crashAfter === i + 1) {
              crashAfter = undefined;
              return new Promise<never>(() => {}); // the process dies here
            }
          }
          return { summary: `已发布 ${items.length} 份日报` };
        },
      };

      const before = new DetachedTaskRunner({ store: new FileDetachedTaskStore(dir), executors: { report } });
      const task = await before.create({ kind: 'report', goal: '发布本周日报', policy: { shell: { security: 'deny' } } });
      const store = new FileDetachedTaskStore(dir);
      void before.start(task.taskId);
      await waitFor(async () => (await store.load(task.taskId))?.steps.length === 2 && sideEffects.length === 2);
      await new Promise((r) => setTimeout(r, 10));

      const delivered: string[] = [];
      const after = new DetachedTaskRunner({
        store: new FileDetachedTaskStore(dir),
        executors: { report },
        deliver: async (_channel, text) => { delivered.push(text); },
      });
      const [resumed] = await after.recover();
      const final = await resumed;

      expect(final.status).toBe('done');
      expect(sideEffects).toEqual(['周一', '周二', '周三', '周四']);
      expect(final.steps).toHaveLength(4);
      expect(final.policy).toEqual({ shell: { security: 'deny' } });
      expect(delivered.at(-1)).toBe('✅ 后台任务完成：已发布 4 份日报');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
