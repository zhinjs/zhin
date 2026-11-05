import { describe, expect, it } from 'vitest';
import { TurnTracker } from '../../src/turn/turn-tracker.js';

describe('TurnTracker', () => {
  it('begins with null lastMetrics', () => {
    const tracker = new TurnTracker();
    expect(tracker.lastMetrics).toBeNull();
  });

  it('finalize records the turn metrics with a private usage copy', async () => {
    const tracker = new TurnTracker();
    tracker.begin();
    const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    await tracker.finalize({ usage, path: 'agent' });
    usage.total_tokens = 999;
    const m = tracker.lastMetrics!;
    expect(m.path).toBe('agent');
    expect(m.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
  });

  it('begin clears the previous metrics', async () => {
    const tracker = new TurnTracker();
    await tracker.finalize({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, path: 'chat' });
    tracker.begin();
    expect(tracker.lastMetrics).toBeNull();
  });
});
