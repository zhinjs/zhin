import { describe, expect, it } from 'vitest';
import type { AssistantMessage, LlmCompletionPort } from '@zhin.js/ai';
import {
  TurnTraceCollector,
  createScopedTraceJournal,
  createTracingJournal,
  formatTurnTrace,
  formatTurnTraceList,
  registerTurnTrace,
  turnTraceTotalUsage,
} from '../../src/trace/index.js';
import { formatTurnUsageLogs } from '../../src/trace/turn-usage-log.js';
import { trackTurnCompletionUsage } from '../../src/core/turn-completion-usage.js';
import type { TurnEvent } from '../../src/event/turn-event.js';

const SERVICE = 'services:7dfb0000-0000-4000-8000-000000000000';
const ACCOUNT = 'accounts:8c130000-0000-4000-8000-000000000000';
const MODEL = 'ag/gemini-3.8-flash';

function usage(prompt: number, completion: number, provider = SERVICE): TurnEvent {
  return { type: 'usage', provider, model: MODEL, usage: { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion } } as TurnEvent;
}

describe('trace-subagent-model-calls-missing (#1250)', () => {
  it('records sub-agent model calls and sums them on the parent apart from its own', async () => {
    const collector = new TurnTraceCollector({ turnId: 'turn-1', sessionKey: 's' });
    const journal = createTracingJournal({ append: () => undefined }, collector);
    const child = createScopedTraceJournal(journal, { turnId: 'turn-1:actor:draw:m1', sessionKey: 's#actor:draw' });
    await journal.append(usage(100, 10));
    await child.append(usage(40, 5));
    await child.append(usage(60, 5));

    const trace = collector.snapshot();
    expect(trace.model_calls).toHaveLength(1);
    expect(trace.usage.total_tokens).toBe(110);
    expect(trace.subagents[0]!.model_calls).toHaveLength(2);
    expect(trace.subagent_usage).toEqual({ model_calls: 2, prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
    expect(turnTraceTotalUsage(trace)).toEqual({ model_calls: 3, prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 });

    const text = formatTurnTrace(trace);
    expect(text).toContain('模型调用 3 次（自身 1，子 agent 2）');
    expect(text).toContain('合计 220（自身 110，子 agent 110）');
    expect(formatTurnTraceList([trace])).toContain('220 tokens (子 agent 110)');

    // ai.usage counts every call once: the parent's own plus the sub-agent's.
    const logs = formatTurnUsageLogs(trace, { traceId: 't', scene: 'im' });
    expect(logs.summary).toContain('calls: 3 ');
    expect(logs.summary).toContain('subagent_calls: 2');
  });

  it('nests sub-agent totals of nested actors into the root', async () => {
    const collector = new TurnTraceCollector({ turnId: 'turn-1', sessionKey: 's' });
    const journal = createTracingJournal({ append: () => undefined }, collector);
    await createScopedTraceJournal(journal, { turnId: 'turn-1:actor:a:m1', sessionKey: 's' }).append(usage(1, 1));
    const nested = collector.child('turn-1:actor:a:m1');
    nested.child('turn-1:actor:a:m1:actor:b:m2').record(usage(2, 2));
    expect(collector.snapshot().subagent_usage).toMatchObject({ model_calls: 2, total_tokens: 6 });
  });
});

describe('trace-provider-path-mismatch (#1250)', () => {
  it('records one provider id for a request in the timeline, requests and model_calls', async () => {
    const collector = new TurnTraceCollector({ turnId: 'turn-p', sessionKey: 's' });
    const release = registerTurnTrace(collector);
    try {
      const assistant = { role: 'assistant', content: [], provider: SERVICE, model: MODEL, stopReason: 'stop',
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        api: 'ai-sdk', timestamp: 0 } as unknown as AssistantMessage;
      const delegate: LlmCompletionPort = { complete: async () => assistant, completeSimple: async () => assistant };
      const tracked = trackTurnCompletionUsage(delegate, undefined, {
        turnId: 'turn-p', recordBodies: false,
        resolveProvider: provider => provider === ACCOUNT ? SERVICE : undefined,
      });
      await tracked.transport.complete({ id: MODEL, provider: ACCOUNT } as never, { messages: [] } as never);
      for (const event of tracked.drainEvents()) collector.record(event);
    } finally {
      release();
    }
    const trace = collector.snapshot();
    expect(trace.requests?.[0]?.provider).toBe(SERVICE);
    expect(trace.model_calls[0]?.provider).toBe(SERVICE);
    const timeline = trace.timeline.find(entry => entry.kind === 'model_request');
    expect(timeline?.detail).toBe(`#1 ${SERVICE}/${MODEL}`);
  });

  it('replaces the request provider with the one the response reports', () => {
    const collector = new TurnTraceCollector({ turnId: 'turn-q', sessionKey: 's' });
    collector.note({ kind: 'model_request', request: { request_id: 'r1', provider: ACCOUNT, model: MODEL, started_at: 0, status: 'running', body_status: 'disabled' } });
    collector.note({ kind: 'model_request_end', request_id: 'r1', status: 'completed', duration_ms: 5, provider: SERVICE, model: MODEL });
    const trace = collector.snapshot();
    expect(trace.requests?.[0]?.provider).toBe(SERVICE);
    expect(trace.timeline.find(entry => entry.kind === 'model_request')?.detail).toBe(`#1 ${SERVICE}/${MODEL}`);
  });

  it('shows the service display name instead of the graph id', () => {
    const collector = new TurnTraceCollector({ turnId: 'turn-r', sessionKey: 's' });
    collector.note({ kind: 'model_request', request: { request_id: 'r1', provider: SERVICE, model: MODEL, started_at: 0, status: 'running', body_status: 'disabled' } });
    collector.record(usage(10, 2));
    const label = (provider: string) => provider === SERVICE ? 'AG 中转' : undefined;
    const text = formatTurnTrace(collector.snapshot(), { providerLabel: label });
    expect(text).toContain(`model=AG 中转 · ${MODEL}`);
    expect(text).toContain(`#1 AG 中转 · ${MODEL}`);
    expect(text).not.toContain(SERVICE);
    // Without a display index, graph ids are hidden behind the model name.
    expect(formatTurnTrace(collector.snapshot())).toContain(`model=${MODEL}`);
  });
});
