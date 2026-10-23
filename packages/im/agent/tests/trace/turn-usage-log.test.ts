import { describe, expect, it, vi } from 'vitest';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';
import { formatTurnUsageLogs, logTurnUsage } from '../../src/trace/turn-usage-log.js';
import { buildContextBudgetReport } from '../../src/trace/context-budget.js';
import { trackTurnCompletionUsage } from '../../src/core/turn-completion-usage.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '@zhin.js/ai';

const context = { traceId: 'trace-1', scene: 'qq/group' };
const usage = { promptTokens: 100, completionTokens: 10, totalTokens: 110, cacheReadTokens: 60, cacheWriteTokens: 0 };
function finish(trace: TurnTraceCollector) { trace.record({ type: 'turn_end', output: [], usage }); return trace.snapshot(); }

describe('readable usage logs', () => {
  it('sums parent and child usage once and distinguishes incomplete cache reporting', () => {
    const trace = new TurnTraceCollector({ turnId: 'turn-1', sessionKey: 'PRIVATE-SESSION' }, () => 10);
    trace.record({ type: 'usage', provider: 'p', model: 'm', usage });
    const child = trace.child('turn-1:subagent:1');
    child.record({ type: 'usage', provider: 'p', model: 'm', usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 } });
    finish(child);
    const logs = formatTurnUsageLogs(finish(trace), context);
    expect(logs.summary).toBe('turn | trace: trace-1 | turn: turn-1 | scene: qq/group | status: completed | model: p/m | calls: 2 | input: 150 | output: 15 | cache_read: >=60 | cache_write: >=0 | reasoning: ? | ms: 0 | subagent_calls: 1');
    expect(logs.details).toHaveLength(2);
    expect(logs.details[1]).toContain('turn: turn-1:subagent:1');
    expect(logs.summary).not.toContain('PRIVATE');
  });

  it('labels missing provider data unknown, explicit zero as zero, and context separately as an estimate', () => {
    const trace = new TurnTraceCollector({ turnId: 'turn', sessionKey: 'secret' });
    trace.record({ type: 'usage', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0,
      reported: { input: false, output: true, cacheRead: false, cacheWrite: true }, cacheWriteTokens: 0 } });
    trace.note({ kind: 'context_budget', report: buildContextBudgetReport({ systemPrompt: 'PRIVATE-PROMPT', loadedTools: [], deferredToolCount: 0, historyMessages: [], userMessages: [] }) });
    const logs = formatTurnUsageLogs(finish(trace), context);
    expect(logs.summary).toContain('input: ? | output: 0 | cache_read: ? | cache_write: 0');
    expect(logs.details[1]).toContain('request: first | unit: estimated_tokens');
    expect(JSON.stringify(logs)).not.toContain('PRIVATE-PROMPT');
  });

  it('does not leak content or permit metadata to inject lines/fields', () => {
    const trace = new TurnTraceCollector({ turnId: 't\n|injected', sessionKey: 'secret' });
    trace.record({ type: 'thinking', text: 'PRIVATE-THINKING' });
    trace.record({ type: 'tool_call', toolName: 'read', args: { password: 'PRIVATE-ARGS' }, toolUseId: 'c' });
    trace.record({ type: 'usage', model: 'm\n|fake', provider: 'p', usage });
    const logs = formatTurnUsageLogs(finish(trace), { traceId: 'id\u001b[31m', scene: 'qq/group' });
    expect(JSON.stringify(logs)).not.toContain('PRIVATE');
    for (const line of [logs.summary, ...logs.details]) expect(line).not.toMatch(/[\n\r\x1b]/);
    expect(logs.summary).toContain('m\\u000a\\u007cfake');
  });

  it('keeps INFO to one record and emits details only when DEBUG is enabled', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    trace.record({ type: 'usage', usage });
    const logger = { info: vi.fn(), debug: vi.fn(), isLevelEnabled: vi.fn((level: string) => level === 'info') };
    logTurnUsage(logger, finish(trace), context);
    expect(logger.info).toHaveBeenCalledTimes(1); expect(logger.debug).not.toHaveBeenCalled();
    logger.isLevelEnabled.mockReturnValue(true);
    logTurnUsage(logger, trace.snapshot(), context);
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('suppresses usage logs at WARN and marks unsuccessful traces partial', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    trace.record({ type: 'usage', usage });
    trace.record({ type: 'turn_cancelled', code: 'cancelled', reason: 'private' });
    expect(formatTurnUsageLogs(trace.snapshot(), context).summary).toContain(' | partial');
    const logger = { info: vi.fn(), debug: vi.fn(), isLevelEnabled: () => false };
    logTurnUsage(logger, trace.snapshot(), context);
    expect(logger.info).not.toHaveBeenCalled(); expect(logger.debug).not.toHaveBeenCalled();
  });

  it('retains response metadata and separate cache writes across completion draining', async () => {
    const response: AssistantMessage = { role: 'assistant', timestamp: 1, api: 'sdk', provider: 'p', model: 'm',
      stopReason: 'stop', content: [{ type: 'text', text: 'PRIVATE-REPLY' }],
      usage: { ...EMPTY_TOKEN_USAGE, input: 100, output: 10, totalTokens: 110, cacheWrite: 40 } };
    const tracker = trackTurnCompletionUsage({ complete: async () => response, completeSimple: async () => response });
    await tracker.transport.complete({} as never, {} as never);
    await tracker.transport.completeSimple({} as never, {} as never);
    const events = tracker.drainEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ provider: 'p', model: 'm', stopReason: 'stop', usage: { cacheWriteTokens: 40 } });
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(tracker.usage.totalTokens).toBe(220);
    expect(tracker.hasReported(response)).toBe(true);
    expect(tracker.drainEvents()).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
  });
});
