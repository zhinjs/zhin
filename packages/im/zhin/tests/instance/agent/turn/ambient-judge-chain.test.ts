/**
 * ADR 0066 D2: the interjection judge chain. One judgment is one operation over
 * `[profile, ...fallbacks]` (language and decision models mixed), sharing one budget; each failure
 * class switches or not, and writes the shared skip table or not, as the ADR table says.
 */
import { describe, expect, it, vi } from 'vitest';
import { ModelAvailabilityRegistry, TIMEOUT_FALLBACK_COOLDOWN_MS, type DecisionProvider, type ProviderErrorClassification } from '@zhin.js/ai';
import {
  AmbientEngagement,
  DecisionEngagementJudge,
  EngagementJudgeChain,
  EngagementJudgeError,
  engagementJudgeFailure,
  engagementJudgeFailureAction,
  type EngagementJudge,
  type EngagementJudgeCall,
  type EngagementJudgeInput,
  type EngagementJudgeMember,
  type EngagementJudgment,
} from '@zhin.js/agent/runtime';

const yes = (model: string): EngagementJudgment => ({ engage: true, confidence: 0.9, reason: 'x', source: { kind: 'language', profile: model, model }, sourceLabel: `language:${model}` });

function failing(category: string, classification?: Partial<ProviderErrorClassification>): () => never {
  return () => {
    const call: EngagementJudgeCall = { kind: 'language', source: 'language:m', status: 'failed', errorCategory: category, durationMs: 1 };
    throw new EngagementJudgeError(call, classification ? { classification: { kind: category as never, retryable: false, ...classification } } : {});
  };
}

function member(id: string, behaviour: (input: EngagementJudgeInput) => Promise<EngagementJudgment> | EngagementJudgment, kind: 'language' | 'decision' = 'language') {
  const judge = vi.fn(async (input: EngagementJudgeInput) => behaviour(input));
  const created: Array<{ fallbackFrom?: unknown }> = [];
  const value: EngagementJudgeMember = {
    kind, label: `${kind}:${id}`, endpoint: { profileId: id, accountId: `account-${id}`, model: id },
    create: context => { created.push(context); return { judge } satisfies EngagementJudge; },
  };
  return { member: value, judge, created };
}

const input = (signal: AbortSignal = new AbortController().signal): EngagementJudgeInput => ({ botName: '小知', recent: ['a'], signal });

function chainOf(members: readonly EngagementJudgeMember[], registry = new ModelAvailabilityRegistry()) {
  const fallbacks: Array<{ from: string; to: string; reason: string; phase: string }> = [];
  const chain = new EngagementJudgeChain({ members, registry, onFallback: event => fallbacks.push({ from: event.from.profileId, to: event.to.profileId, reason: event.reason, phase: event.phase }) });
  return { chain, registry, fallbacks };
}

describe('engagementJudgeFailureAction: the ADR 0066 D2 table', () => {
  it.each([
    ['quota_exhausted', undefined, { action: 'switch', skip: 'global' }],
    ['billing', undefined, { action: 'switch', skip: 'global' }],
    ['auth', { credential: true }, { action: 'switch', skip: 'global', reason: 'auth' }],
    ['timeout', undefined, { action: 'switch', skip: 'transient', transient: 'timeout' }],
    ['no_response', undefined, { action: 'switch', skip: 'transient', transient: 'timeout' }],
    ['network', undefined, { action: 'switch', skip: 'transient', transient: 'transient' }],
    ['server', undefined, { action: 'switch', skip: 'transient', transient: 'transient' }],
    // A failure without a class is handled as a network error: switch, no skip-table write by itself.
    ['unknown', undefined, { action: 'switch', skip: 'transient', reason: 'network' }],
    ['provider_error', undefined, { action: 'switch', skip: 'transient', reason: 'network' }],
    ['invalid_response', undefined, { action: 'switch', skip: 'none', reason: 'invalid_response' }],
    ['auth', undefined, { action: 'stop' }],
    ['rate_limit', undefined, { action: 'stop' }],
    ['safety_block', undefined, { action: 'stop' }],
    ['context_overflow', undefined, { action: 'stop' }],
    ['aborted', undefined, { action: 'stop' }],
  ] as const)('%s → %j', (category, classification, expected) => {
    expect(engagementJudgeFailureAction(category, classification as ProviderErrorClassification | undefined)).toMatchObject(expected);
  });
});

describe('EngagementJudgeChain', () => {
  it('switches on quota, billing and a rejected credential, and writes the global skip table', async () => {
    for (const [category, classification] of [['quota_exhausted', { quotaWindow: 'day' }], ['billing', {}], ['auth', { credential: true }]] as const) {
      const primary = member('primary', failing(category, classification));
      const spare = member('spare', () => yes('spare'));
      const { chain, registry, fallbacks } = chainOf([primary.member, spare.member]);
      await expect(chain.judge(input())).resolves.toMatchObject({ source: { model: 'spare' } });
      expect(registry.unavailable('account-primary', 'primary')).toMatchObject({ reason: category });
      expect(fallbacks).toEqual([{ from: 'primary', to: 'spare', reason: category, phase: 'request' }]);
      expect(registry.recentFallbacks()[0]).toMatchObject({ purpose: 'ambient', reason: category });
      // The fallback is told which configured model it replaces.
      expect(spare.created).toEqual([{ fallbackFrom: { label: 'language:primary', ref: { profile: 'primary', model: 'primary' } } }]);
    }
  });

  it('does not switch on a plain 403, a rate limit, a content refusal or an oversized context, and writes nothing', async () => {
    for (const category of ['auth', 'rate_limit', 'safety_block', 'context_overflow']) {
      const primary = member('primary', failing(category, {}));
      const spare = member('spare', () => yes('spare'));
      const { chain, registry } = chainOf([primary.member, spare.member]);
      const error = await chain.judge(input()).then(() => undefined, (caught: unknown) => caught);
      expect(engagementJudgeFailure(error)).toMatchObject({ category });
      expect(spare.judge).not.toHaveBeenCalled();
      expect(registry.list()).toEqual([]);
    }
  });

  it('switches on an invalid answer without marking the model', async () => {
    const primary = member('primary', failing('invalid_response'));
    const spare = member('spare', () => yes('spare'));
    const { chain, registry, fallbacks } = chainOf([primary.member, spare.member]);
    await expect(chain.judge(input())).resolves.toMatchObject({ source: { model: 'spare' } });
    expect(registry.list()).toEqual([]);
    expect(fallbacks[0]).toMatchObject({ reason: 'invalid_response' });
  });

  it('switches on timeout / network / 5xx for this judgment only, and skips globally once 2 judgments gave up within 2 minutes', async () => {
    let now = 1_000_000;
    const registry = new ModelAvailabilityRegistry({ now: () => now });
    const primary = member('primary', failing('timeout'));
    const spare = member('spare', () => yes('spare'));
    const { chain } = chainOf([primary.member, spare.member], registry);
    await chain.judge(input());
    expect(registry.unavailable('account-primary', 'primary')).toBeUndefined();
    // Next judgment starts at the head again (no stickiness).
    now += 60_000;
    await chain.judge(input());
    expect(primary.judge).toHaveBeenCalledTimes(2);
    expect(registry.unavailable('account-primary', 'primary')).toMatchObject({ reason: 'timeout', until: now + TIMEOUT_FALLBACK_COOLDOWN_MS });
    await chain.judge(input());
    expect(primary.judge).toHaveBeenCalledTimes(2);

    // Network errors and 5xx are counted apart from timeouts; two outside the window do not skip.
    const flaky = member('flaky', failing('server'));
    const other = chainOf([flaky.member, spare.member], registry);
    await other.chain.judge(input());
    now += 3 * 60_000;
    await other.chain.judge(input());
    expect(registry.unavailable('account-flaky', 'flaky')).toBeUndefined();
  });

  it('passes over members in their skip period at selection time without counting a failure', async () => {
    const registry = new ModelAvailabilityRegistry();
    registry.markUnavailable({ accountId: 'account-primary', model: 'primary', reason: 'quota_exhausted', until: Date.now() + 60_000 });
    const primary = member('primary', () => yes('primary'));
    const spare = member('spare', () => yes('spare'));
    const { chain, fallbacks } = chainOf([primary.member, spare.member], registry);
    await expect(chain.judge(input())).resolves.toMatchObject({ source: { model: 'spare' } });
    expect(primary.judge).not.toHaveBeenCalled();
    expect(fallbacks).toEqual([{ from: 'primary', to: 'spare', reason: 'quota_exhausted', phase: 'selection' }]);
  });

  it('fails as all_unavailable when every member is being skipped', async () => {
    const registry = new ModelAvailabilityRegistry();
    for (const id of ['primary', 'spare']) registry.markUnavailable({ accountId: `account-${id}`, model: id, reason: 'billing', until: Date.now() + 60_000 });
    const primary = member('primary', () => yes('primary'));
    const spare = member('spare', () => yes('spare'));
    const { chain } = chainOf([primary.member, spare.member], registry);
    const error = await chain.judge(input()).then(() => undefined, (caught: unknown) => caught);
    expect(engagementJudgeFailure(error)).toMatchObject({ category: 'all_unavailable', ref: { profile: 'primary' } });
    expect(primary.judge).not.toHaveBeenCalled();
  });

  it('stops at once when the caller cancels: no other member is asked', async () => {
    const controller = new AbortController();
    const primary = member('primary', () => { controller.abort(); return failing('aborted')(); });
    const spare = member('spare', () => yes('spare'));
    const { chain, registry } = chainOf([primary.member, spare.member]);
    await expect(chain.judge(input(controller.signal))).rejects.toThrow();
    expect(spare.judge).not.toHaveBeenCalled();
    expect(registry.list()).toEqual([]);
  });

  it('shares one budget: a member that uses it up ends the judgment', async () => {
    const primary = member('primary', ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
    const spare = member('spare', () => yes('spare'));
    const { chain } = chainOf([primary.member, spare.member]);
    await expect(chain.judge(input(AbortSignal.timeout(20)))).rejects.toThrow();
    expect(spare.judge).not.toHaveBeenCalled();
  });

  it('lists every member tried when the whole chain fails', async () => {
    const primary = member('primary', failing('timeout'));
    const spare = member('spare', failing('invalid_response'), 'decision');
    const { chain } = chainOf([primary.member, spare.member]);
    const failure = engagementJudgeFailure(await chain.judge(input()).then(() => undefined, (caught: unknown) => caught));
    expect(failure.attempts).toEqual([
      { ref: { kind: 'language', profile: 'primary', model: 'primary' }, label: 'language:primary', category: 'timeout' },
      { ref: { kind: 'decision', profile: 'spare', model: 'spare' }, label: 'decision:spare', category: 'invalid_response' },
    ]);
  });

  it('passes over a member that cannot be built or cannot take the input', async () => {
    const broken: EngagementJudgeMember = { kind: 'language', label: 'language:broken', endpoint: { profileId: 'broken', accountId: 'a', model: 'broken' },
      create: () => { throw new Error('profile gone'); } };
    const small: EngagementJudgeMember = { ...member('small', () => yes('small')).member, fits: () => false };
    const spare = member('spare', () => yes('spare'));
    const onMemberError = vi.fn();
    const chain = new EngagementJudgeChain({ members: [broken, small, spare.member], registry: new ModelAvailabilityRegistry(), onMemberError });
    await expect(chain.judge(input())).resolves.toMatchObject({ source: { model: 'spare' } });
    expect(onMemberError).toHaveBeenCalledWith(broken, expect.any(Error));
  });
});

describe('EngagementJudgeChain with a decision model first and a language model behind it', () => {
  const answer = { model: 'jev', answers: { engagement: { type: 'choice', choice: 'engage', confidence: 0.8, probabilities: { engage: 0.8, stay_quiet: 0.2 } } }, usage: { inputTokens: 1, outputTokens: 1 } };
  const decision = (evaluate: DecisionProvider['evaluate']): EngagementJudgeMember => ({
    kind: 'decision', label: 'decision:jev', endpoint: { profileId: 'jev', accountId: 'typesafe', model: 'jev' },
    create: context => new DecisionEngagementJudge({ provider: { evaluate } as DecisionProvider, policy: { mode: 'active', timeoutMs: 50 }, model: 'jev', profile: 'jev',
      ...(context.fallbackFrom ? { fallbackFrom: context.fallbackFrom } : {}) }),
  });

  it('hands a timed-out decision model over to the language model, naming the decision model it replaced', async () => {
    const slow = decision((_request, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })) as never);
    const language = member('chat', () => yes('chat'));
    const { chain, fallbacks } = chainOf([slow, language.member]);
    await expect(chain.judge(input())).resolves.toMatchObject({ source: { model: 'chat' } });
    expect(fallbacks).toEqual([{ from: 'jev', to: 'chat', reason: 'timeout', phase: 'request' }]);
    expect(language.created[0]).toEqual({ fallbackFrom: { label: 'decision:jev', ref: { profile: 'jev', model: 'jev' } } });
  });

  it('switches and writes the skip table on a 429 daily quota; stays on a plain 429 rate limit (acceptance 3)', async () => {
    const quota = decision(async () => { throw Object.assign(new Error('Too many requests: requests per day (RPD) exceeded'), { status: 429 }); });
    const language = member('chat', () => yes('chat'));
    const first = chainOf([quota, language.member]);
    await expect(first.chain.judge(input())).resolves.toMatchObject({ source: { model: 'chat' } });
    expect(first.registry.unavailable('typesafe', 'jev')).toMatchObject({ reason: 'quota_exhausted' });

    const limited = decision(async () => { throw Object.assign(new Error('Too many requests'), { status: 429 }); });
    const second = chainOf([limited, language.member]);
    const failure = engagementJudgeFailure(await second.chain.judge(input()).then(() => undefined, (caught: unknown) => caught));
    expect(failure).toMatchObject({ category: 'rate_limit', source: 'decision:jev' });
    expect(second.registry.list()).toEqual([]);
    expect(language.judge).toHaveBeenCalledTimes(1);
  });

  it('switches on a decision answer the driver could not use, without marking the model', async () => {
    const invalid = decision(async () => { throw Object.assign(new Error('TypeSafe decision invalid-response'), { code: 'invalid-response' }); });
    const valid = decision(async () => answer as never);
    const unusable = decision(async () => ({ ...answer, answers: { engagement: { type: 'choice', choice: 'maybe', probabilities: {} } } }) as never);
    const language = member('chat', () => yes('chat'));
    for (const first of [invalid, unusable]) {
      const { chain, registry } = chainOf([first, language.member]);
      await expect(chain.judge(input())).resolves.toMatchObject({ source: { model: 'chat' } });
      expect(registry.list()).toEqual([]);
    }
    await expect(chainOf([valid, language.member]).chain.judge(input())).resolves.toMatchObject({ source: { kind: 'decision', profile: 'jev', model: 'jev' }, sourceLabel: 'decision:jev' });
  });
});

describe('AmbientEngagement budget (ADR 0066 D2)', () => {
  it('gives the whole chain one 15-second budget per judgment', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const primary = member('primary', failing('server'));
      const spare = member('spare', ({ signal }) => { expect(signal).toBe(primary.judge.mock.calls[0]![0].signal); return yes('spare'); });
      const { chain } = chainOf([primary.member, spare.member]);
      const engagement = new AmbientEngagement({ config: { conversations: ['*'] }, judge: chain, sleep: async () => undefined });
      await expect(engagement.consider({ key: 'qq:1', botName: '小知', readRecent: async () => ['a'] })).resolves.toMatchObject({ kind: 'engage' });
      expect(timeout.mock.calls.filter(([ms]) => ms === 15_000)).toHaveLength(1);
    } finally { timeout.mockRestore(); }
  });
});
