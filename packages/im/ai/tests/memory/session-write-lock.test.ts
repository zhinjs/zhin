/**
 * ADR 0014 P2-2 — 并发 session 写锁稳定性
 */
import { describe, it, expect } from 'vitest';
import { SessionWriteLock } from '../../src/memory/session-write-lock.js';

describe('SessionWriteLock concurrent sessions', () => {
  it('50 并发 session 无 unhandled rejection', async () => {
    const lock = new SessionWriteLock();
    const sessionCount = 50;
    const turnsPerSession = 3;
    const results: number[] = [];

    await Promise.all(
      Array.from({ length: sessionCount }, (_, sessionIdx) =>
        Promise.all(
          Array.from({ length: turnsPerSession }, async (_, turnIdx) => {
            const value = await lock.run(`session-${sessionIdx}`, async () => {
              await new Promise((r) => setTimeout(r, 1));
              return sessionIdx * 100 + turnIdx;
            });
            results.push(value);
          }),
        ),
      ),
    );

    expect(results).toHaveLength(sessionCount * turnsPerSession);
  });

  it('同 session 串行执行', async () => {
    const lock = new SessionWriteLock();
    const order: number[] = [];

    await Promise.all([
      lock.run('s1', async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 20));
        order.push(2);
      }),
      lock.run('s1', async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });
});
