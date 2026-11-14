import { describe, expect, it } from 'vitest';
import { PromptCacheProbe } from '../../src/usage.js';

const SERVICE = 'services:7dfb0000-0000-4000-8000-000000000000';
const ACCOUNT = 'accounts:8c130000-0000-4000-8000-000000000000';

function trace(session: string, calls: Array<{ cache?: number; prefix?: string; provider?: string }>, subagents: unknown[] = []) {
  return {
    session_key: session,
    started_at: 1,
    model_calls: calls.map((call, index) => ({
      index: index + 1,
      provider: call.provider ?? SERVICE,
      model: 'ag/gemini-3.8-flash',
      prompt_tokens: 5000,
      completion_tokens: 10,
      total_tokens: 5010,
      ...(call.cache === undefined ? {} : { cache_read_tokens: call.cache }),
      ...(call.prefix ? { prefix_hash: call.prefix } : {}),
    })),
    subagents,
  };
}

/** `turns` turns of `calls` zero-cache calls each, rotated over `sessions` sessions, one shared prefix. */
function feed(probe: PromptCacheProbe, turns: number, sessions: number, prefix = (_turn: number) => 'p1') {
  for (let turn = 0; turn < turns; turn++) {
    probe.visit(trace(`s${turn % sessions}`, [{ cache: 0, prefix: prefix(turn) }, { cache: 0, prefix: prefix(turn) }]));
  }
}

describe('PromptCacheProbe (#1250 usage-cache-unsupported-hint)', () => {
  it('hints at a service with long zero-cache runs across sessions while prefixes repeat', () => {
    const probe = new PromptCacheProbe({ resolveProvider: id => (id === SERVICE || id === ACCOUNT ? { key: SERVICE, label: 'AG 中转' } : undefined) });
    feed(probe, 12, 3);
    const [hint] = probe.hints();
    expect(hint).toMatchObject({ provider: SERVICE, label: 'AG 中转', zeroCacheCalls: 24, sessions: 3, reportedZeroCalls: 24 });
    expect(hint!.samePrefixRatio).toBe(1);
    expect(hint!.comparedPairs).toBe(21);
    expect(hint!.message).toContain('AG 中转');
    expect(hint!.message).toContain('可能不支持或未透传 prompt 缓存');
    expect(hint!.message).toContain('100%（21/21）');
  });

  it('merges services: and accounts: ids of the same service', () => {
    const probe = new PromptCacheProbe({ resolveProvider: () => ({ key: SERVICE, label: 'AG' }) });
    for (let turn = 0; turn < 12; turn++) {
      probe.visit(trace(`s${turn % 3}`, [{ cache: 0, prefix: 'p', provider: turn % 2 ? ACCOUNT : SERVICE }, { cache: 0, prefix: 'p' }]));
    }
    expect(probe.hints()[0]!.providerIds).toEqual([ACCOUNT, SERVICE]);
  });

  it('stays quiet below the thresholds', () => {
    const fewCalls = new PromptCacheProbe();
    feed(fewCalls, 9, 3);
    expect(fewCalls.hints()).toEqual([]);
    const fewSessions = new PromptCacheProbe();
    feed(fewSessions, 20, 2);
    expect(fewSessions.hints()).toEqual([]);
  });

  it('does not blame the service when the prefix itself keeps changing', () => {
    const probe = new PromptCacheProbe();
    for (let turn = 0; turn < 12; turn++) {
      probe.visit(trace(`s${turn % 3}`, [{ cache: 0, prefix: `a${turn}` }, { cache: 0, prefix: `b${turn}` }]));
    }
    expect(probe.hints()).toEqual([]);
  });

  it('a cache hit resets the run; older traces without prefix hashes give no evidence', () => {
    const hit = new PromptCacheProbe();
    feed(hit, 12, 3);
    hit.visit(trace('s0', [{ cache: 4000, prefix: 'p1' }]));
    feed(hit, 5, 3);
    expect(hit.hints()).toEqual([]);

    const legacy = new PromptCacheProbe();
    for (let turn = 0; turn < 12; turn++) legacy.visit(trace(`s${turn % 3}`, [{ cache: 0 }, { cache: 0 }]));
    expect(legacy.hints()).toEqual([]);
  });

  it('counts sub-agent calls under their own sessions', () => {
    const probe = new PromptCacheProbe();
    for (let turn = 0; turn < 10; turn++) {
      probe.visit(trace(`s${turn % 2}`, [{ cache: 0, prefix: 'p' }], [trace(`s${turn % 2}#actor:draw`, [{ cache: 0, prefix: 'q' }])]));
    }
    expect(probe.hints()[0]).toMatchObject({ zeroCacheCalls: 20, sessions: 4 });
  });
});
