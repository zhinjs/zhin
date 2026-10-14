import { describe, expect, it } from 'vitest';
import { TurnTraceCollector, formatTurnTrace } from '../../src/trace/index.js';
import { describePromptSectionsForDebug, type RichSystemPromptContext } from '../../src/prompt/system-prompt.js';
import { DEFAULT_CONFIG } from '../../src/config/zhin-agent-defaults.js';

describe('prompt cache observability (#730)', () => {
  it('records cache-read tokens per model call and shows the hit rate', () => {
    const trace = new TurnTraceCollector({ turnId: 't1', sessionKey: 's1' });
    trace.record({ type: 'usage', usage: { promptTokens: 1000, completionTokens: 10, totalTokens: 1010, cacheReadTokens: 600 } });
    const snapshot = trace.snapshot();
    expect(snapshot.model_calls[0]!.cache_read_tokens).toBe(600);
    expect(formatTurnTrace(snapshot, { timeline: false })).toContain('提示缓存命中 600 tokens（占输入 60%）');
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
    expect(sections[0]!.id).toBe('§1_runtime');
  });
});
