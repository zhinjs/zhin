import { describe, expect, it, vi } from 'vitest';
import { BudgetGuard } from '../../src/schedule-domain/budget-guard.js';

describe('BudgetGuard', () => {
  it('aborts once the tool-call budget is exceeded', async () => {
    const guard = new BudgetGuard({ maxTokens: 100, maxToolCalls: 1, timeoutMs: 1_000 });
    const result = await guard.run(async ({ signal, onToolCall }) => {
      onToolCall('one');
      onToolCall('two');
      return signal.aborted ? 'partial' : 'complete';
    });

    expect(result.terminatedBy).toBe('tool_limit');
    expect(result.value).toBe('partial');
    expect(result.toolCalls).toEqual(['one', 'two']);
  });

  it('preserves telemetry when execution throws', async () => {
    const guard = new BudgetGuard({ maxTokens: 100, maxToolCalls: 5, timeoutMs: 1_000 });
    const result = await guard.run(async ({ onUsage, onToolCall }) => {
      onToolCall('weather');
      onUsage(20, 5);
      throw new Error('provider failed');
    });
    expect(result.error?.message).toBe('provider failed');
    expect(result.toolCalls).toEqual(['weather']);
    expect(result.tokenUsage).toEqual({ input: 20, output: 5 });
  });

  it('propagates owner cancellation to the schedule turn signal', async () => {
    const guard = new BudgetGuard({ maxTokens: 100, maxToolCalls: 5, timeoutMs: 1_000 });
    const owner = new AbortController();
    const resultPromise = guard.run(async ({ signal }) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), owner.signal);

    owner.abort(new Error('generation retired'));

    const result = await resultPromise;
    expect(result.error?.message).toBe('generation retired');
    expect(result.terminatedBy).toBeUndefined();
  });

  it('does not start an operation for an already cancelled owner', async () => {
    const guard = new BudgetGuard({ maxTokens: 100, maxToolCalls: 5, timeoutMs: 1_000 });
    const owner = new AbortController();
    const operation = vi.fn(async () => 'unexpected');
    owner.abort(new Error('retired before admission'));

    const result = await guard.run(operation, owner.signal);

    expect(operation).not.toHaveBeenCalled();
    expect(result.error?.message).toBe('retired before admission');
  });
});
