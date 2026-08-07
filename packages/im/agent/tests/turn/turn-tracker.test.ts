import { describe, expect, it } from 'vitest';
import { TurnTracker } from '../../src/turn/turn-tracker.js';

describe('TurnTracker', () => {
  it('begins with null lastMetrics', () => {
    const tracker = new TurnTracker(1000);
    expect(tracker.lastMetrics).toBeNull();
  });

  it('finalize produces metrics with main usage only when no subagent', async () => {
    const tracker = new TurnTracker(1000);
    tracker.begin();
    await tracker.finalize({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      path: 'agent',
    });
    const m = tracker.lastMetrics!;
    expect(m.path).toBe('agent');
    expect(m.usage.total_tokens).toBe(150);
    expect(m.mainUsage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
    expect(m.subagentUsage).toBeUndefined();
  });

  it('finalize merges subagent usage into total', async () => {
    const tracker = new TurnTracker(1000);
    tracker.begin();
    tracker.addSubagentUsage({ prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 });
    await tracker.finalize({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      path: 'agent',
    });
    const m = tracker.lastMetrics!;
    expect(m.usage.total_tokens).toBe(180);
    expect(m.mainUsage!.total_tokens).toBe(150);
    expect(m.subagentUsage!.total_tokens).toBe(30);
  });

  it('addSubagentUsage is no-op before begin()', () => {
    const tracker = new TurnTracker(1000);
    tracker.addSubagentUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(tracker.lastMetrics).toBeNull();
  });

  it('waitForPendingSubagents resolves immediately when no waits', async () => {
    const tracker = new TurnTracker(1000);
    tracker.begin();
    await tracker.waitForPendingSubagents();
  });

  it('waitForPendingSubagents times out when waits exceed deadline', async () => {
    const tracker = new TurnTracker(50);
    tracker.begin();
    tracker.trackSubagent(new Promise(() => {}));
    const start = performance.now();
    await tracker.waitForPendingSubagents();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(200);
  });

  it('waitForPendingSubagents clears waits after resolving', async () => {
    const tracker = new TurnTracker(1000);
    tracker.begin();
    let resolve!: () => void;
    tracker.trackSubagent(new Promise<void>(r => { resolve = r; }));
    resolve();
    await tracker.waitForPendingSubagents();
    // Second call should resolve immediately
    const start = performance.now();
    await tracker.waitForPendingSubagents();
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('finalize resets active state', async () => {
    const tracker = new TurnTracker(1000);
    tracker.begin();
    tracker.addSubagentUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    await tracker.finalize({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      path: 'agent',
    });
    // After finalize, addSubagentUsage should be no-op
    tracker.addSubagentUsage({ prompt_tokens: 999, completion_tokens: 999, total_tokens: 999 });
    expect(tracker.lastMetrics!.usage.total_tokens).toBe(165);
  });

  it('zero subagent usage is not reported', async () => {
    const tracker = new TurnTracker(1000);
    tracker.begin();
    tracker.addSubagentUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    await tracker.finalize({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      path: 'agent',
    });
    expect(tracker.lastMetrics!.subagentUsage).toBeUndefined();
  });
});
