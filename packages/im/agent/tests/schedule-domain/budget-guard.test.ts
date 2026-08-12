import { describe, expect, it } from 'vitest';
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
});
