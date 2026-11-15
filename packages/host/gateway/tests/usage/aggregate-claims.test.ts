import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildUsageStats, lookupClaimsOf } from '../../src/usage/aggregate.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const NOON = new Date(2026, 9, 28, 12).getTime();
const DAY = 86_400_000;
const call = (provider: string, model: string, prompt: number) => ({
  provider, model, prompt_tokens: prompt, completion_tokens: 1, started_at: NOON,
});

// #1270 tool-capability-unverified: replies that claim a lookup without any tool call are counted.
describe('buildUsageStats claims without tool call', () => {
  it('counts root and sub-agent claims in totals and on the answering model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-claims-'));
    dirs.push(dir);
    const claimed = {
      version: 1, session_key: 'qq:1:group:42', started_at: NOON,
      model_calls: [call('agnes', 'flash', 1000)],
      claim_without_tool_call: { phrase: '查了下' },
      unexecuted_tool_notice: { tools: ['memory_upsert'], delivered: 'appended' },
      subagents: [{
        session_key: 'qq:1:group:42#actor:helper', started_at: NOON,
        model_calls: [call('gemini', 'pro', 10), call('gemini', 'flash', 20)],
        claim_without_tool_call: { phrase: 'I checked' },
        subagents: [],
      }],
    };
    const honest = { version: 1, session_key: 'qq:1:group:42', started_at: NOON + 1, model_calls: [call('agnes', 'flash', 500)] };
    writeFileSync(join(dir, '2026-10-28.jsonl'), `${JSON.stringify(claimed)}\n${JSON.stringify(honest)}\n`);
    const s = await buildUsageStats(dir, { since: NOON - DAY, until: NOON + DAY, bucket: 'day' });

    expect(s.totals).toMatchObject({ turns: 2, claimsWithoutToolCall: 2, unexecutedToolNotices: 1 });
    const claims = Object.fromEntries(s.byModel.map(m => [`${m.provider}/${m.model}`, m.claimsWithoutToolCall]));
    // The sub-agent's claim belongs to its last model call (gemini flash), not its first.
    expect(claims).toEqual({ 'agnes/flash': 1, 'gemini/flash': 1, 'gemini/pro': 0 });
  });

  it('lookupClaimsOf ignores traces without the flag and survives malformed nodes', () => {
    expect(lookupClaimsOf({ model_calls: [] })).toEqual([]);
    expect(lookupClaimsOf(null)).toEqual([]);
    expect(lookupClaimsOf({ claim_without_tool_call: { phrase: 'x' }, subagents: [null, 3] })).toEqual([{}]);
  });
});
