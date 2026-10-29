import { describe, expect, it } from 'vitest';
import { TurnTraceCollector, formatTurnTrace } from '../../src/trace/index.js';
import { describePromptSectionsForDebug, type RichSystemPromptContext } from '../../src/prompt/system-prompt.js';
import { DEFAULT_CONFIG } from '../../src/config/zhin-agent-defaults.js';
import { createTurnEventMapperState, mapAgentEventToTurnEvents } from '../../src/core/turn-event-mapper.js';

describe('prompt cache observability (#730)', () => {
  it('records cache-read tokens per model call and shows the hit rate', () => {
    const trace = new TurnTraceCollector({ turnId: 't1', sessionKey: 's1' });
    trace.record({ type: 'usage', usage: { promptTokens: 1000, completionTokens: 10, totalTokens: 1010, cacheReadTokens: 600 } });
    const snapshot = trace.snapshot();
    expect(snapshot.model_calls[0]!.cache_read_tokens).toBe(600);
    expect(formatTurnTrace(snapshot, { timeline: false })).toContain('提示缓存命中 600 tokens（占输入 60%）');
  });

  it('carries Gemini cachedContentTokenCount and thoughtsTokenCount (usage.cacheRead / usage.reasoning) from the model reply into the trace (#769)', () => {
    const trace = new TurnTraceCollector({ turnId: 't2', sessionKey: 's1' });
    const reply = {
      role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: 'ai-sdk', provider: 'gemini', model: 'gemini-3.8-flash',
      usage: { input: 5100, output: 84, reasoning: 80, cacheRead: 4096, cacheWrite: 0, totalTokens: 5184, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: 0,
    };
    const state = createTurnEventMapperState();
    for (const event of mapAgentEventToTurnEvents({ type: 'message_end', message: reply } as never, state)) trace.record(event as never);
    expect(trace.snapshot().model_calls[0]).toMatchObject({ prompt_tokens: 5100, completion_tokens: 84, total_tokens: 5184, cache_read_tokens: 4096, reasoning_tokens: 80 });
    expect(formatTurnTrace(trace.snapshot(), { timeline: false })).toContain('cache=4096 reasoning=80');
  });

  it('puts the volatile git status after every stable section', () => {
    const sections = describePromptSectionsForDebug({
      config: DEFAULT_CONFIG,
      skillRegistry: null,
      skillsSummaryXML: '',
      activeSkillsContext: '',
      bootstrapContext: 'bootstrap',
      gitStatus: 'Git: main (clean)',
    } as RichSystemPromptContext);
    expect(sections.at(-1)!.id).toBe('§12_git_status');
    expect(sections[0]!.id).toBe('§1b_critical_rules');
    expect(sections.at(-1)!.kind).toBe('scene');
    expect(sections.slice(0, -1).every(section => section.kind !== 'scene')).toBe(true);
  });
});
