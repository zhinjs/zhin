import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildUsageStats } from '../../src/usage/aggregate.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const NOON = new Date(2026, 9, 28, 12).getTime();
const DAY = 86_400_000;
const call = (provider: string, model: string, prompt: number, cache = 0) => ({
  provider, model, prompt_tokens: prompt, completion_tokens: 1, cache_read_tokens: cache, started_at: NOON,
});

// The totals' `inputBasis` promises every model call, sub-agents included: a sub-agent trace's
// calls live only in `trace.subagents[*].model_calls` (nested), not in the root's `model_calls`.
describe('buildUsageStats sub-agent calls', () => {
  it('counts nested sub-agent model calls by service and model, toward the root session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-subagents-'));
    dirs.push(dir);
    const trace = {
      version: 1, session_key: 'icqq:1:group:42', started_at: NOON,
      model_calls: [call('gemini', 'flash', 1000)],
      context_budget: { segments: { history: 1 } },
      subagents: [{
        session_key: 'icqq:1:group:42#actor:draw', started_at: NOON,
        model_calls: [call('openai', 'image', 300), call('openai', 'image', 200, 100)],
        subagents: [{
          session_key: 'icqq:1:group:42#actor:helper', started_at: NOON,
          model_calls: [call('gemini', 'flash', 50)],
          subagents: [],
        }],
      }],
    };
    writeFileSync(join(dir, '2026-10-28.jsonl'), `${JSON.stringify(trace)}\n`);
    const s = await buildUsageStats(dir, { since: NOON - DAY, until: NOON + DAY, bucket: 'day' });

    expect(s.totals).toMatchObject({ turns: 1, calls: 4, inputTokens: 1550, cacheReadTokens: 100 });
    expect(s.byModel.map(m => [m.provider, m.model, m.calls, m.inputTokens])).toEqual([
      ['gemini', 'flash', 2, 1050],
      ['openai', 'image', 2, 500],
    ]);
    expect(s.bySession).toEqual([expect.objectContaining({ sessionKey: 'icqq:1:group:42', turns: 1, calls: 4, inputTokens: 1550 })]);
    expect(s.series.reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(4);
    // The first-request estimate stays the root turn's own first request.
    expect(s.inputBreakdown.firstRequestInputTokens).toBe(1000);
  });
});
