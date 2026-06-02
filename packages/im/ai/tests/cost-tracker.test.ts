/**
 * Cost Tracker 测试
 *
 * 测试成本追踪：
 * - token 用量累加
 * - USD 成本计算
 * - 按模型分别追踪
 * - 监听器回调
 * - 快照和格式化
 * - 重置
 */
import { describe, it, expect, vi } from 'vitest';

import { CostTracker } from '../src/agent/cost-tracker.js';
import type { Usage } from '../src/types.js';

const mockUsage = (prompt: number, completion: number): Usage => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
});

describe('CostTracker', () => {
  it('should track usage for a single model', () => {
    const tracker = new CostTracker();
    tracker.addUsage('gpt-4o', mockUsage(1000, 500));

    expect(tracker.getTotalInputTokens()).toBe(1000);
    expect(tracker.getTotalOutputTokens()).toBe(500);
    expect(tracker.getTotalRequests()).toBe(1);
  });

  it('should accumulate multiple calls', () => {
    const tracker = new CostTracker();
    tracker.addUsage('gpt-4o', mockUsage(1000, 500));
    tracker.addUsage('gpt-4o', mockUsage(2000, 1000));

    expect(tracker.getTotalInputTokens()).toBe(3000);
    expect(tracker.getTotalOutputTokens()).toBe(1500);
    expect(tracker.getTotalRequests()).toBe(2);
  });

  it('should track multiple models separately', () => {
    const tracker = new CostTracker();
    tracker.addUsage('gpt-4o', mockUsage(1000, 500));
    tracker.addUsage('claude-sonnet-4', mockUsage(2000, 1000));

    const gpt = tracker.getModelUsage('gpt-4o');
    const claude = tracker.getModelUsage('claude-sonnet-4');

    expect(gpt?.inputTokens).toBe(1000);
    expect(claude?.inputTokens).toBe(2000);
    expect(tracker.getTotalRequests()).toBe(2);
  });

  it('should calculate cost using pricing table', () => {
    const tracker = new CostTracker();
    // gpt-4o: $2.5/M input, $10/M output
    const cost = tracker.calculateCost('gpt-4o', mockUsage(1_000_000, 1_000_000));
    expect(cost).toBeCloseTo(12.5, 1);
  });

  it('should return 0 cost for unknown models', () => {
    const tracker = new CostTracker();
    const cost = tracker.calculateCost('unknown-model', mockUsage(1000, 500));
    expect(cost).toBe(0);
  });

  it('should support custom pricing', () => {
    const tracker = new CostTracker();
    tracker.setModelPricing('my-model', {
      inputPricePerMToken: 1.0,
      outputPricePerMToken: 2.0,
    });

    const cost = tracker.calculateCost('my-model', mockUsage(1_000_000, 1_000_000));
    expect(cost).toBeCloseTo(3.0, 1);
  });

  it('should notify listeners on update', () => {
    const tracker = new CostTracker();
    const listener = vi.fn();
    tracker.onUpdate(listener);

    tracker.addUsage('gpt-4o', mockUsage(1000, 500));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].model).toBe('gpt-4o');
    expect(listener.mock.calls[0][0].snapshot.totalRequests).toBe(1);
  });

  it('should allow unsubscribing listeners', () => {
    const tracker = new CostTracker();
    const listener = vi.fn();
    const unsub = tracker.onUpdate(listener);

    tracker.addUsage('gpt-4o', mockUsage(1000, 500));
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    tracker.addUsage('gpt-4o', mockUsage(1000, 500));
    expect(listener).toHaveBeenCalledTimes(1); // No additional call
  });

  it('should generate snapshot', () => {
    const tracker = new CostTracker();
    tracker.addUsage('gpt-4o', mockUsage(1000, 500));

    const snapshot = tracker.getSnapshot();
    expect(snapshot.totalInputTokens).toBe(1000);
    expect(snapshot.totalOutputTokens).toBe(500);
    expect(snapshot.totalTokens).toBe(1500);
    expect(snapshot.totalRequests).toBe(1);
    expect(snapshot.startedAt).toBeLessThanOrEqual(Date.now());
    expect(snapshot.modelUsage['gpt-4o']).toBeDefined();
  });

  it('should format cost correctly', () => {
    expect(CostTracker.formatCost(0)).toBe('$0.00');
    expect(CostTracker.formatCost(1.5)).toBe('$1.50');
    expect(CostTracker.formatCost(0.0012)).toBe('$0.0012');
  });

  it('should format tokens correctly', () => {
    expect(CostTracker.formatTokens(500)).toBe('500');
    expect(CostTracker.formatTokens(1500)).toBe('1.5K');
    expect(CostTracker.formatTokens(1_500_000)).toBe('1.5M');
  });

  it('should format summary', () => {
    const tracker = new CostTracker();
    tracker.addUsage('gpt-4o', mockUsage(1000, 500));
    const summary = tracker.formatSummary();
    expect(summary).toContain('总成本');
    expect(summary).toContain('总请求');
    expect(summary).toContain('总 token');
  });

  it('should reset all state', () => {
    const tracker = new CostTracker();
    tracker.addUsage('gpt-4o', mockUsage(1000, 500));
    tracker.reset();

    expect(tracker.getTotalCost()).toBe(0);
    expect(tracker.getTotalInputTokens()).toBe(0);
    expect(tracker.getTotalRequests()).toBe(0);
  });

  it('should match pricing by prefix for model variants', () => {
    const tracker = new CostTracker();
    // "gpt-4o-2024-05-13" should match "gpt-4o" prefix
    const pricing = tracker.getModelPricing('gpt-4o-2024-05-13');
    expect(pricing.inputPricePerMToken).toBeGreaterThan(0);
  });
});
