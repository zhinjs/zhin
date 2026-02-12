/**
 * RateLimiter 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../../src/ai/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    limiter?.dispose();
    vi.useRealTimers();
  });

  it('应允许正常请求', () => {
    limiter = new RateLimiter({ maxRequestsPerMinute: 5 });
    const result = limiter.check('user1');
    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('应在超过限制后拒绝请求', () => {
    limiter = new RateLimiter({ maxRequestsPerMinute: 3, cooldownSeconds: 5 });

    // 发送 3 个请求（达到限制）
    limiter.check('user1');
    limiter.check('user1');
    limiter.check('user1');

    // 第 4 个请求应被拒绝
    const result = limiter.check('user1');
    expect(result.allowed).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.retryAfterSeconds).toBe(5);
  });

  it('冷却期结束后应允许请求', () => {
    limiter = new RateLimiter({ maxRequestsPerMinute: 2, cooldownSeconds: 5 });

    limiter.check('user1');
    limiter.check('user1');
    limiter.check('user1'); // 触发冷却

    // 推进 6 秒
    vi.advanceTimersByTime(6000);

    // 推进超过 1 分钟让滑动窗口清空旧记录
    vi.advanceTimersByTime(60000);

    const result = limiter.check('user1');
    expect(result.allowed).toBe(true);
  });

  it('不同用户应独立计数', () => {
    limiter = new RateLimiter({ maxRequestsPerMinute: 2 });

    limiter.check('user1');
    limiter.check('user1');
    const user1Result = limiter.check('user1'); // 超限

    const user2Result = limiter.check('user2'); // 新用户
    expect(user1Result.allowed).toBe(false);
    expect(user2Result.allowed).toBe(true);
  });

  it('滑动窗口应在 1 分钟后清理旧记录', () => {
    limiter = new RateLimiter({ maxRequestsPerMinute: 2 });

    limiter.check('user1');
    limiter.check('user1');

    // 推进 61 秒
    vi.advanceTimersByTime(61000);

    // 旧记录清理后应允许
    const result = limiter.check('user1');
    expect(result.allowed).toBe(true);
  });

  it('dispose 应清理所有资源', () => {
    limiter = new RateLimiter();
    limiter.check('user1');
    limiter.dispose();

    // dispose 后内部 buckets 应清空
    const result = limiter.check('user1');
    expect(result.allowed).toBe(true); // 重新开始计数
  });

  it('在冷却期内请求应返回等待秒数', () => {
    limiter = new RateLimiter({ maxRequestsPerMinute: 1, cooldownSeconds: 10 });

    limiter.check('user1');
    limiter.check('user1'); // 触发冷却

    // 推进 3 秒
    vi.advanceTimersByTime(3000);

    const result = limiter.check('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(10);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});
