import { describe, expect, it, vi } from 'vitest';
import type { DecisionProvider } from '@zhin.js/ai';
import {
  AmbientEngagement,
  createAmbientDecisionJudge,
  DecisionEngagementJudge,
  FallbackEngagementJudge,
  LlmEngagementJudge,
  ShadowEngagementJudge,
  parseJudgment,
  type EngagementJudge,
  type EngagementJudgment,
} from '../../../../src/plugin-runtime/agent/turn/ambient-engagement.js';

function harness(judgment: EngagementJudgment | Error, config: ConstructorParameters<typeof AmbientEngagement>[0]['config'] = {}) {
  let now = 1_000_000;
  const releases: Array<() => void> = [];
  const judge = { judge: vi.fn(async () => { if (judgment instanceof Error) throw judgment; return judgment; }) } satisfies EngagementJudge;
  const engagement = new AmbientEngagement({
    config: { conversations: ['icqq:1048877509'], ...config },
    judge,
    now: () => now,
    // Each wait resolves only when the test releases it, so bursts can overlap deterministically.
    sleep: () => new Promise<void>(resolve => releases.push(resolve)),
  });
  const consider = () => engagement.consider({ key: 'icqq:1048877509', botName: '小知', readRecent: async () => ['小林 (1): 有人知道怎么配代理吗'] });
  return {
    engagement, judge, consider,
    release: async () => { releases.splice(0).forEach(release => release()); await new Promise(resolve => setImmediate(resolve)); },
    advance: (ms: number) => { now += ms; },
  };
}

const yes: EngagementJudgment = { engage: true, confidence: 0.9, reason: 'unanswered question' };

describe('AmbientEngagement', () => {
  it('is enabled only for listed groups, or every group with *', () => {
    const { engagement } = harness(yes);
    expect(engagement.enabledFor('icqq', '1048877509')).toBe(true);
    expect(engagement.enabledFor('icqq', '1')).toBe(false);
    expect(harness(yes, { conversations: ['*'] }).engagement.enabledFor('qq', '1')).toBe(true);
  });

  it('judges a burst once, from its last message', async () => {
    const h = harness(yes);
    const first = h.consider();
    const second = h.consider();
    await h.release();
    await expect(first).resolves.toEqual({ kind: 'skipped', reason: 'superseded' });
    await expect(second).resolves.toEqual({ kind: 'engage', judgment: yes });
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.judge.judge.mock.calls[0]![0]).toMatchObject({ botName: '小知', recent: ['小林 (1): 有人知道怎么配代理吗'] });
  });

  it('declines low-confidence or negative judgments', async () => {
    for (const judgment of [{ ...yes, confidence: 0.5 }, { ...yes, engage: false }]) {
      const h = harness(judgment);
      const decision = h.consider();
      await h.release();
      await expect(decision).resolves.toEqual({ kind: 'declined', judgment });
    }
  });

  it('answers someone talking with the bot without any cooldown', async () => {
    const h = harness(yes, { cooldownMs: 60_000, maxPerHour: 0 });
    h.engagement.noteSpoke('icqq:1048877509');
    h.advance(30_000);
    const reply = h.consider();
    await h.release();
    await expect(reply).resolves.toMatchObject({ kind: 'engage' });
    expect(h.judge.judge.mock.calls[0]![0]).toMatchObject({ inConversation: true, minutesSinceBotSpoke: 1 });
  });

  it('treats the group as idle again once the conversation window has passed', async () => {
    const h = harness(yes, { conversationWindowMs: 180_000, maxPerHour: 0 });
    h.engagement.noteSpoke('icqq:1048877509');
    h.advance(181_000);
    const decision = h.consider();
    await h.release();
    await expect(decision).resolves.toEqual({ kind: 'skipped', reason: 'hourly_cap' });
  });

  it('spaces unprompted interjections by the cooldown', async () => {
    const h = harness(yes, { cooldownMs: 60_000, conversationWindowMs: 0 });
    const first = h.consider();
    await h.release();
    await expect(first).resolves.toMatchObject({ kind: 'engage' });
    expect(h.judge.judge.mock.calls[0]![0]).toMatchObject({ inConversation: false });
    h.advance(30_000);
    const early = h.consider();
    await h.release();
    await expect(early).resolves.toEqual({ kind: 'skipped', reason: 'cooldown' });
    h.advance(31_000);
    const later = h.consider();
    await h.release();
    await expect(later).resolves.toMatchObject({ kind: 'engage' });
  });

  it('caps unprompted interjections per rolling hour', async () => {
    const h = harness(yes, { cooldownMs: 0, maxPerHour: 2, conversationWindowMs: 0 });
    const kinds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const decision = h.consider();
      await h.release();
      kinds.push((await decision).kind);
      h.advance(60_000);
    }
    expect(kinds).toEqual(['engage', 'engage', 'skipped']);
    h.advance(60 * 60_000);
    const afterHour = h.consider();
    await h.release();
    await expect(afterHour).resolves.toMatchObject({ kind: 'engage' });
  });

  it('keeps a safety ceiling on replies inside a conversation', async () => {
    const h = harness(yes);
    h.engagement.noteSpoke('icqq:1048877509');
    const kinds: string[] = [];
    for (let i = 0; i < 31; i++) {
      const decision = h.consider();
      await h.release();
      kinds.push((await decision).kind);
      h.advance(10_000);
    }
    expect(kinds.filter(kind => kind === 'engage')).toHaveLength(30);
    expect(kinds.at(-1)).toBe('skipped');
  });

  it('judges an idle group at most once per judge interval', async () => {
    const h = harness({ ...yes, engage: false }, { judgeIntervalMs: 30_000, conversationWindowMs: 0 });
    const first = h.consider();
    await h.release();
    await expect(first).resolves.toMatchObject({ kind: 'declined' });
    h.advance(10_000);
    const soon = h.consider();
    await h.release();
    await expect(soon).resolves.toEqual({ kind: 'skipped', reason: 'judge_interval' });
    h.advance(21_000);
    const later = h.consider();
    await h.release();
    await expect(later).resolves.toMatchObject({ kind: 'declined' });
    expect(h.judge.judge).toHaveBeenCalledTimes(2);
  });

  it('logs only in shadow mode and does not start a cooldown', async () => {
    const h = harness(yes, { mode: 'shadow' });
    for (let i = 0; i < 2; i++) {
      const decision = h.consider();
      await h.release();
      await expect(decision).resolves.toEqual({ kind: 'shadow', judgment: yes });
      h.advance(31_000);
    }
  });

  it('stays quiet when the judge fails', async () => {
    const h = harness(new Error('rate limited'));
    const decision = h.consider();
    await h.release();
    await expect(decision).resolves.toEqual({ kind: 'skipped', reason: 'judge_failed' });
  });
});

describe('FallbackEngagementJudge', () => {
  const input = { botName: '小知', recent: ['a'], signal: new AbortController().signal };

  it('falls through to the next judge and passes over a failed one for a while', async () => {
    let now = 0;
    const limited = { judge: vi.fn(async () => { throw new Error('429 rate limited'); }) };
    const spare = { judge: vi.fn(async () => yes) };
    const judge = new FallbackEngagementJudge([limited, spare], () => now, 60_000);
    await expect(judge.judge(input)).resolves.toEqual(yes);
    await expect(judge.judge(input)).resolves.toEqual(yes);
    expect(limited.judge).toHaveBeenCalledTimes(1);
    now = 61_000;
    await judge.judge(input);
    expect(limited.judge).toHaveBeenCalledTimes(2);
  });

  it('fails only when every judge fails', async () => {
    const down = { judge: vi.fn(async () => { throw new Error('down'); }) };
    await expect(new FallbackEngagementJudge([down, down]).judge(input)).rejects.toThrow('down');
  });
});

describe('LlmEngagementJudge', () => {
  it('trims long chat lines before sending them to the judge', async () => {
    const completeSimple = vi.fn(async () => ({ role: 'assistant', content: [{ type: 'text', text: '{"engage":false,"confidence":0.9,"reason":"x"}' }] }));
    const judge = new LlmEngagementJudge({ completeSimple } as never, {} as never);
    await judge.judge({ botName: '小知', recent: ['短', '长'.repeat(500)], signal: new AbortController().signal });
    const sent = JSON.stringify(completeSimple.mock.calls[0]);
    expect(sent).toContain(`${'长'.repeat(200)}…`);
    expect(sent).not.toContain('长'.repeat(201));
  });
});

describe('parseJudgment', () => {
  it('accepts lenient JSON and clamps confidence', () => {
    expect(parseJudgment('好的 {"engage":true,"confidence":1.4,"reason":"x"}')).toEqual({ engage: true, confidence: 1, reason: 'x' });
  });

  it.each(['', 'yes', '{"engage":"true","confidence":0.9}', '{"engage":true}'])('rejects %j', text => {
    expect(() => parseJudgment(text)).toThrow('Invalid engagement judgment');
  });
});

describe('DecisionEngagementJudge', () => {
  const input = () => ({ botName: '小知', recent: ['小林 (1): 有人知道怎么配代理吗'], inConversation: true, minutesSinceBotSpoke: 2, signal: new AbortController().signal });
  const answer = (choice: 'engage' | 'stay_quiet', engage: number) => ({
    model: 'jev-1.14',
    answers: { engagement: { type: 'choice', choice, confidence: Math.max(engage, 1 - engage), probabilities: { engage, stay_quiet: 1 - engage } } },
    usage: { inputTokens: 40, outputTokens: 2 },
  });
  const provider = (result: unknown) => ({ evaluate: vi.fn(async () => { if (result instanceof Error) throw result; return result; }) }) as unknown as DecisionProvider & { evaluate: ReturnType<typeof vi.fn> };

  it('asks one binary choice over the judge evidence and reports metadata only', async () => {
    const service = provider(answer('engage', 0.86));
    const observe = vi.fn();
    const judge = new DecisionEngagementJudge({ provider: service, policy: { mode: 'active', timeoutMs: 1500 }, observe });
    await expect(judge.judge(input())).resolves.toEqual({ engage: true, confidence: 0.86, reason: 'decision: engage', source: 'decision:jev-1.14' });
    const [request, options] = service.evaluate.mock.calls[0]!;
    expect(request.state).toEqual({ bot: '小知', botIsInConversation: true, minutesSinceBotSpoke: 2, recentMessages: ['小林 (1): 有人知道怎么配代理吗'] });
    expect(Object.keys(request.questions)).toEqual(['engagement']);
    expect(request.questions.engagement).toMatchObject({ type: 'choice', criteria: { engage: expect.any(String), stay_quiet: expect.any(String) } });
    expect(options).toMatchObject({ timeoutMs: 1500 });
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ task: 'ambient', mode: 'active', outcome: 'selected', candidates: 2, selected: 1, model: 'jev-1.14', usage: { inputTokens: 40, outputTokens: 2, totalTokens: 42 } }));
    expect(JSON.stringify(observe.mock.calls)).not.toContain('代理');
  });

  it('declines when the provider chooses to stay quiet', async () => {
    const judge = new DecisionEngagementJudge({ provider: provider(answer('stay_quiet', 0.1)), policy: { mode: 'active' } });
    await expect(judge.judge(input())).resolves.toMatchObject({ engage: false, confidence: 0.9 });
  });

  it('gates engagement with ai.decisions.ambient.minConfidence', async () => {
    const observe = vi.fn();
    const judge = new DecisionEngagementJudge({ provider: provider(answer('engage', 0.6)), policy: { mode: 'active', minConfidence: 0.8 }, observe });
    await expect(judge.judge(input())).resolves.toMatchObject({ engage: false });
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'abstained', reason: 'low_confidence' }));
  });

  it('throws on invalid answers, provider errors and timeouts so the chat-model judges can take over', async () => {
    for (const [result, reason] of [
      [{ model: 'jev-1.14', answers: { engagement: { type: 'choice', choice: 'maybe', probabilities: {} } }, usage: { inputTokens: 1, outputTokens: 1 } }, 'invalid_response'],
      [new Error('503 channel_unavailable'), 'provider_error'],
    ] as const) {
      const observe = vi.fn();
      const judge = new DecisionEngagementJudge({ provider: provider(result), policy: { mode: 'active' }, observe });
      await expect(judge.judge(input())).rejects.toThrow(reason);
      expect(observe).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', reason }));
    }
    const slow = { evaluate: (_request: unknown, options: { signal: AbortSignal }) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))) } as unknown as DecisionProvider;
    const observe = vi.fn();
    await expect(new DecisionEngagementJudge({ provider: slow, policy: { mode: 'active', timeoutMs: 20 }, observe }).judge(input())).rejects.toThrow('timeout');
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));

    const llm = { judge: vi.fn(async () => yes) } satisfies EngagementJudge;
    const failing = new DecisionEngagementJudge({ provider: provider(new Error('down')), policy: { mode: 'active' } });
    await expect(new FallbackEngagementJudge([failing, llm]).judge(input())).resolves.toEqual(yes);
    expect(llm.judge).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid policy', () => {
    expect(() => new DecisionEngagementJudge({ provider: provider(answer('engage', 1)), policy: { mode: 'active', timeoutMs: 0 } })).toThrow('Invalid ambient decision policy');
    expect(() => new DecisionEngagementJudge({ provider: provider(answer('engage', 1)), policy: { mode: 'active', minConfidence: 2 } })).toThrow('Invalid ambient decision policy');
  });
});

describe('ShadowEngagementJudge', () => {
  it('returns the primary judgment and reports the shadow one', async () => {
    const shadowJudgment: EngagementJudgment = { engage: false, confidence: 0.8, reason: 'decision: stay_quiet', source: 'decision:jev-1.14' };
    const report = vi.fn();
    const judge = new ShadowEngagementJudge({ judge: async () => yes }, { judge: async () => shadowJudgment }, report);
    await expect(judge.judge({ botName: '小知', recent: ['a'], signal: new AbortController().signal })).resolves.toEqual(yes);
    expect(report).toHaveBeenCalledWith(shadowJudgment, yes);
  });

  it('ignores a failing shadow and still fails with the primary', async () => {
    const report = vi.fn();
    const input = { botName: '小知', recent: ['a'], signal: new AbortController().signal };
    await expect(new ShadowEngagementJudge({ judge: async () => yes }, { judge: async () => { throw new Error('down'); } }, report).judge(input)).resolves.toEqual(yes);
    expect(report).toHaveBeenLastCalledWith(undefined, yes);
    await expect(new ShadowEngagementJudge({ judge: async () => { throw new Error('primary'); } }, { judge: async () => yes }, report).judge(input)).rejects.toThrow('primary');
  });
});

describe('AmbientEngagement judge override', () => {
  it('uses the per-call judge while keeping the throttles', async () => {
    const h = harness(yes, { cooldownMs: 60_000, conversationWindowMs: 0 });
    const override = { judge: vi.fn(async (): Promise<EngagementJudgment> => ({ ...yes, source: 'decision:jev-1.14' })) } satisfies EngagementJudge;
    const consider = () => h.engagement.consider({ key: 'icqq:1048877509', botName: '小知', readRecent: async () => ['x'], judge: override });
    const first = consider();
    await h.release();
    await expect(first).resolves.toMatchObject({ kind: 'engage', judgment: { source: 'decision:jev-1.14' } });
    const second = consider();
    await h.release();
    await expect(second).resolves.toEqual({ kind: 'skipped', reason: 'cooldown' });
    expect(override.judge).toHaveBeenCalledTimes(1);
    expect(h.judge.judge).not.toHaveBeenCalled();
  });
});

describe('createAmbientDecisionJudge', () => {
  const input = () => ({ botName: '小知', recent: ['a'], signal: new AbortController().signal });
  const quiet = { model: 'jev-1.14', answers: { engagement: { type: 'choice', choice: 'stay_quiet', confidence: 0.95, probabilities: { engage: 0.05, stay_quiet: 0.95 } } }, usage: { inputTokens: 1, outputTokens: 1 } };
  const service = (result: unknown) => ({ evaluate: vi.fn(async () => { if (result instanceof Error) throw result; return result; }) }) as unknown as DecisionProvider & { evaluate: ReturnType<typeof vi.fn> };

  it('keeps the configured judges when the policy is off', () => {
    expect(createAmbientDecisionJudge({ base: { judge: async () => yes }, provider: service(quiet), policy: { mode: 'off' } })).toBeUndefined();
  });

  it('active: the decision provider decides and the chat-model judges are the fallback', async () => {
    const base = { judge: vi.fn(async () => yes) } satisfies EngagementJudge;
    const active = createAmbientDecisionJudge({ base, provider: service(quiet), policy: { mode: 'active' } })!;
    await expect(active.judge(input())).resolves.toMatchObject({ engage: false, source: 'decision:jev-1.14' });
    expect(base.judge).not.toHaveBeenCalled();
    const failing = createAmbientDecisionJudge({ base, provider: service(new Error('down')), policy: { mode: 'active' } })!;
    await expect(failing.judge(input())).resolves.toEqual(yes);
  });

  it('shadow: the chat-model judges decide and the decision is only reported', async () => {
    const reportShadow = vi.fn();
    const observe = vi.fn();
    const shadow = createAmbientDecisionJudge({ base: { judge: async () => yes }, provider: service(quiet), policy: { mode: 'shadow' }, observe, reportShadow })!;
    await expect(shadow.judge(input())).resolves.toEqual(yes);
    expect(reportShadow).toHaveBeenCalledWith(expect.objectContaining({ engage: false }), yes);
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ task: 'ambient', mode: 'shadow', outcome: 'shadow' }));
  });
});
