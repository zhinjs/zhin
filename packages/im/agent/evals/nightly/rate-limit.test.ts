/**
 * Free-tier rate limiting for the nightly tier (rate-limit.ts): 429 backoff 2/4/8 s
 * then give up, a longer retryDelay / Retry-After wins, the daily quota fails fast
 * and fails the run, requests are paced ≥4 s apart and serialized. Real Gemini wire
 * format through the shared provider harness from #784; time is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage, type Model } from '@zhin.js/ai';
import { createProviderHarness, geminiGenerate, type ProviderHarness } from '../../../ai/tests/helpers/provider-harness/index.js';
import { BudgetedCompletionPort, DEFAULT_NIGHTLY_BUDGET } from './budget.js';
import { CAPABILITY_MATRIX } from './matrix-cases.js';
import { resolveNightlyProvider } from './providers.js';
import { runNightlyMatrix } from './runner.js';
import { renderMarkdown } from './report.js';
import { liveSeedCases } from './seed-cases.js';
import groupMemberNoShell from '../cases/group-member-no-shell.case.js';
import {
  DailyQuotaExhaustedError,
  ProviderUnavailableError,
  FREE_TIER_RATE_LIMIT,
  RateLimitGiveUpError,
  RateLimitedCompletionPort,
  RequestPacer,
  rateLimitSignal,
  resolveRateLimitPolicy,
  type RateLimitEvent,
} from './rate-limit.js';

const rpc = (details: unknown[] = []) => geminiGenerate.error(429, { message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED', details });
const perMinute = (retryDelay?: string) => rpc([
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
  ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
]);
const perDay = () => rpc([
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
  // Gemini still sends a short RetryInfo on a daily quota; retrying cannot succeed.
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '14s' },
]);
const ok = (text = 'ok') => geminiGenerate.reply({ text });

function setup(...responses: Parameters<ProviderHarness['reply']>) {
  const h = createProviderHarness({ sdk: 'google', model: 'gemini-3.8-flash', responses });
  const events: RateLimitEvent[] = [];
  const port = new RateLimitedCompletionPort(h.runtime, FREE_TIER_RATE_LIMIT, { onEvent: (e) => events.push(e) });
  const ask = (user = 'hi') => port.complete(h.model, { systemPrompt: '', messages: [createUserMessage(user)] });
  const starts = () => events.flatMap((e) => (e.type === 'request' ? [e.at] : []));
  const backoffs = () => events.flatMap((e) => (e.type === 'backoff' ? [e.delayMs] : []));
  return { h, port, ask, events, starts, backoffs };
}

/**
 * Run `promise` to completion while advancing fake time 1 s at a time. Between steps
 * a real `setImmediate` lets real I/O (the eval driver) progress, so timers scheduled
 * after it still fire.
 */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let done = false;
  const result = promise.then((value) => ({ value }), (error: unknown) => ({ error })).finally(() => { done = true; });
  for (let i = 0; i < 2_000 && !done; i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return result;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('429 backoff (per-minute quota)', () => {
  it('backs off 2 s, 4 s, 8 s, then gives up; the SDK itself never retries', async () => {
    const s = setup(perMinute(), perMinute(), perMinute(), perMinute(), ok());
    const { error } = await settle(s.ask());
    expect(error).toBeInstanceOf(RateLimitGiveUpError);
    expect((error as Error).message).toMatch(/gave up after 3 retries \(waited 2000\/4000\/8000 ms\)/);
    expect(s.backoffs()).toEqual([2_000, 4_000, 8_000]);
    expect(s.h.requests).toHaveLength(4);
    // Backoff and pacing combine: never closer than 4 s, and the backoff is honoured.
    expect(s.starts()).toEqual([0, 4_000, 8_000, 16_000]);
    expect(s.port.stats()).toMatchObject({ requests: 4, retries: 3, gaveUp: 1, unavailable503: 0 });
  });

  it('recovers when a retry succeeds', async () => {
    const s = setup(perMinute(), ok('second time'));
    const { value } = await settle(s.ask());
    expect(value?.content).toEqual([expect.objectContaining({ type: 'text', text: 'second time' })]);
    expect(s.backoffs()).toEqual([2_000]);
  });

  it('honours a longer Google RetryInfo.retryDelay, but never waits less than the schedule', async () => {
    const s = setup(perMinute('30s'), perMinute('0.5s'), ok());
    await settle(s.ask());
    expect(s.backoffs()).toEqual([30_000, 4_000]);
    expect(s.starts()).toEqual([0, 30_000, 34_000]);
  });

  it('honours a longer Retry-After header', async () => {
    const s = setup({ ...perMinute(), headers: { 'retry-after': '12' } }, ok());
    await settle(s.ask());
    expect(s.backoffs()).toEqual([12_000]);
  });
});

describe('daily quota (RPD)', () => {
  it('fails fast without retrying, despite the short RetryInfo, and every later call fails too', async () => {
    const s = setup(perDay(), ok());
    const { error } = await settle(s.ask());
    expect(error).toBeInstanceOf(DailyQuotaExhaustedError);
    expect((error as Error).message).toMatch(/free-tier daily request quota \(RPD\) is exhausted for gemini-3\.8-flash/);
    expect(s.backoffs()).toEqual([]);
    expect(s.h.requests).toHaveLength(1);
    const again = await settle(s.ask());
    expect(again.error).toBe(error);
    expect(s.h.requests).toHaveLength(1);
    expect(s.port.fatalError()).toBe(error);
  });

  it('also recognises RPD / PerDay in the error text', () => {
    expect(rateLimitSignal({ statusCode: 429, responseBody: '{"error":{"message":"Quota exceeded: RPD limit reached","status":"RESOURCE_EXHAUSTED"}}' })).toEqual({ kind: 'daily' });
    expect(rateLimitSignal({ statusCode: 429, message: 'quota GenerateRequestsPerDayPerProjectPerModel exceeded' })).toEqual({ kind: 'daily' });
    expect(rateLimitSignal({ statusCode: 429, message: 'Too many requests' })).toEqual({ kind: 'per-minute' });
    expect(rateLimitSignal({ statusCode: 500, message: 'boom' })).toBeUndefined();
  });

  it('fails the nightly run: the report carries `fatal`, nothing after it runs, nothing passes', async () => {
    const h = createProviderHarness({ sdk: 'google', model: 'gemini-3.8-flash', responses: [ok(), perDay()] });
    const budget = { ...DEFAULT_NIGHTLY_BUDGET, runsPerCase: 2 };
    const port = new RateLimitedCompletionPort(new BudgetedCompletionPort(h.runtime, budget));
    const run = runNightlyMatrix({ provider: 'gemini', models: [h.model], cases: CAPABILITY_MATRIX.slice(0, 2), port, rateLimiter: port, budget });
    const { value: report } = await settle(run);
    expect(report!.fatal).toMatch(/daily request quota/);
    expect(h.requests).toHaveLength(2);
    const results = report!.models[0]!.cases;
    expect(results.every((c) => c.passed === 0 || c.id === 'matrix-tool-call-format')).toBe(true);
    expect(results[1]).toMatchObject({ passed: 0, skipped: 0 });
    expect(report!.pacing).toMatchObject({ minIntervalMs: 4_000, requests: 2, retries: 0 });
  });
});

describe('pacing and serialization', () => {
  it('spaces consecutive requests at least 4 s apart (15 RPM), including multi-turn steps', async () => {
    const s = setup(ok(), ok(), ok(), ok());
    for (let i = 0; i < 4; i++) await settle(s.ask(`turn ${i}`));
    const starts = s.starts();
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(4_000);
  });

  it('does not add a wait when the previous request already took longer than the interval', async () => {
    const pacer = new RequestPacer(4_000);
    await pacer.acquire();
    await vi.advanceTimersByTimeAsync(10_000);
    const before = Date.now();
    await pacer.acquire();
    expect(Date.now()).toBe(before);
  });

  it('serializes concurrent callers: the second request starts only after the first finishes', async () => {
    const slow = () => new Promise<ReturnType<typeof ok>>((resolve) => setTimeout(() => resolve(ok('slow')), 9_000));
    const s = setup(slow, ok('fast'));
    const both = Promise.all([s.ask('a'), s.ask('b')]);
    const { value } = await settle(both);
    expect(value?.map((m) => m.content[0])).toEqual([
      expect.objectContaining({ text: 'slow' }),
      expect.objectContaining({ text: 'fast' }),
    ]);
    // The first takes 9 s; the second may not start before it is done.
    expect(s.starts()).toEqual([0, 9_000]);
  });

  it('passes non-rate-limit errors straight through, unretried', async () => {
    const s = setup(geminiGenerate.error(400, { message: 'bad', status: 'INVALID_ARGUMENT' }), ok());
    const { error } = await settle(s.ask());
    expect(error).toBeDefined();
    expect(error).not.toBeInstanceOf(RateLimitGiveUpError);
    expect(s.h.requests).toHaveLength(1);
  });
});

describe('nightly wiring', () => {
  it('defaults to 4 s spacing, overridable, and leaves retrying to the limiter', () => {
    expect(resolveRateLimitPolicy({})).toEqual({ minIntervalMs: 4_000, backoffMs: [2_000, 4_000, 8_000], unavailableBackoffMs: [8_000, 15_000] });
    expect(resolveRateLimitPolicy({ NIGHTLY_MIN_REQUEST_INTERVAL_MS: '1000' }).minIntervalMs).toBe(1_000);
    expect(resolveNightlyProvider({ GEMINI_API_KEY: 'k' }).config.maxRetries).toBe(0);
    expect(resolveNightlyProvider({ NIGHTLY_PROVIDER: 'minimax', MINIMAX_API_KEY: 'k' }).config.maxRetries).toBe(0);
  });

  it('forwards usage from the budget port', async () => {
    const h = createProviderHarness({ sdk: 'google', model: 'gemini-3.8-flash', responses: [ok()] });
    const port = new RateLimitedCompletionPort(new BudgetedCompletionPort(h.runtime, DEFAULT_NIGHTLY_BUDGET));
    await settle(port.complete(h.model as Model, { systemPrompt: '', messages: [createUserMessage('x')] }));
    expect(port.usage()).toMatchObject({ requests: 1 });
  });
});

const overloaded = () => geminiGenerate.error(503, { message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' });
const ZH_ANSWER = '- 精神更好\n- 皮肤更好\n- 记忆力更强';
const zhCase = CAPABILITY_MATRIX.filter((c) => c.id === 'matrix-zh-instruction');

describe('503 UNAVAILABLE', () => {
  it('retries once after a jittered 8–15 s wait, through the pacer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const s = setup(overloaded(), ok('back'));
    const { value } = await settle(s.ask());
    expect(value?.content).toEqual([expect.objectContaining({ text: 'back' })]);
    expect(s.events.filter((e) => e.type === 'unavailable_retry')).toEqual([expect.objectContaining({ delayMs: 11_500 })]);
    expect(s.starts()).toEqual([0, 11_500]);
    expect(s.port.stats()).toMatchObject({ requests: 2, retries: 0, unavailable503: 1, unavailableRetries: 1, providerUnavailable: 0 });
  });

  it('keeps the wait inside 8–15 s and honours a longer Retry-After', async () => {
    const gap = (starts: number[]) => starts[1]! - starts[0]!;
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = setup(overloaded(), ok());
    await settle(low.ask());
    random.mockReturnValue(0.999_999);
    const high = setup(overloaded(), ok());
    await settle(high.ask());
    expect([gap(low.starts()), gap(high.starts())]).toEqual([8_000, 15_000]);
    const longer = setup({ ...overloaded(), headers: { 'retry-after': '40' } }, ok());
    await settle(longer.ask());
    expect(gap(longer.starts())).toBe(40_000);
  });

  it('is provider-unavailable when the retry is 503 too; no third request', async () => {
    const s = setup(overloaded(), overloaded(), ok());
    const { error } = await settle(s.ask());
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as Error).message).toMatch(/^provider-unavailable: gemini-3\.8-flash answered 503 UNAVAILABLE 2 times/);
    expect(s.h.requests).toHaveLength(2);
    expect(s.port.stats()).toMatchObject({ unavailable503: 2, providerUnavailable: 1 });
  });

  it('counts the retry against NIGHTLY_MAX_REQUESTS and never exceeds it', async () => {
    const h = createProviderHarness({ sdk: 'google', model: 'gemini-3.8-flash', responses: [overloaded(), ok()] });
    const budget = { ...DEFAULT_NIGHTLY_BUDGET, maxRequests: 1 };
    const port = new RateLimitedCompletionPort(new BudgetedCompletionPort(h.runtime, budget));
    const { error } = await settle(port.complete(h.model, { systemPrompt: '', messages: [createUserMessage('x')] }));
    expect((error as Error).name).toBe('BudgetExceededError');
    expect(h.requests).toHaveLength(1);
    expect(port.usage().requests).toBe(1);
  });

  it('does not retry 500 INTERNAL (only 503 is the overload signal)', async () => {
    const s = setup(geminiGenerate.error(500, { message: 'internal', status: 'INTERNAL' }), ok());
    const { error } = await settle(s.ask());
    expect(error).not.toBeInstanceOf(ProviderUnavailableError);
    expect(s.h.requests).toHaveLength(1);
  });
});

describe('provider-unavailable in the nightly report', () => {
  /**
   * The runner (and the eval driver behind seed cases) does real async work before and
   * between requests, so stepping fake timers races it. These tests instead give the port
   * a virtual clock: `sleep` advances virtual time and resolves at once, so pacing and the
   * 8–15 s 503 wait take no real time and every sleep is recorded.
   */
  beforeEach(() => {
    vi.useRealTimers();
  });
  const run = async (responses: Parameters<ProviderHarness['reply']>, opts: { runs?: number; maxRequests?: number; seeds?: boolean } = {}) => {
    const h = createProviderHarness({ sdk: 'google', model: 'gemini-3.8-flash', responses });
    const budget = { ...DEFAULT_NIGHTLY_BUDGET, runsPerCase: opts.runs ?? 3, maxRequests: opts.maxRequests ?? 120 };
    let now = 0;
    const sleeps: number[] = [];
    const clock = { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; }, random: () => 0 };
    const events: RateLimitEvent[] = [];
    const port = new RateLimitedCompletionPort(new BudgetedCompletionPort(h.runtime, budget), FREE_TIER_RATE_LIMIT, { clock, onEvent: (e) => events.push(e) });
    const seedCases = opts.seeds ? liveSeedCases([groupMemberNoShell]) : undefined;
    const value = await runNightlyMatrix({ provider: 'gemini', models: [h.model], cases: opts.seeds ? [] : zhCase, seedCases, port, rateLimiter: port, budget });
    return { value, events, sleeps, requests: h.requests };
  };

  it('marks a run that stays 503 provider-unavailable, outside the pass rate', async () => {
    const { value: report, sleeps } = await run([ok(ZH_ANSWER), overloaded(), overloaded(), ok(ZH_ANSWER)]);
    expect(sleeps).toContain(8_000);
    expect(report!.models[0]!.cases[0]).toMatchObject({ passed: 2, unavailable: 1, skipped: 0, passRate: 1 });
    expect(report!.models[0]!.cases[0]!.failures).toEqual([expect.stringMatching(/^provider-unavailable/)]);
    expect(report!.infra).toEqual({ attempted: 3, providerUnavailable: 1, flaky: false });
    expect(report!.pacing).toMatchObject({ unavailable503: 2, providerUnavailable: 1 });
    expect(renderMarkdown(report!, [])).toContain('1 provider-unavailable');
  });

  it('never turns a real assertion failure green: a wrong answer stays a failure next to 503s', async () => {
    const { value: report } = await run([ok('I cannot help.'), overloaded(), overloaded(), ok(ZH_ANSWER)]);
    expect(report!.models[0]!.cases[0]).toMatchObject({ passed: 1, unavailable: 1, passRate: 0.5 });
  });

  it('reports a mostly-503 night as infra-flaky, with regressions marked untrusted', async () => {
    const { value: report } = await run([overloaded(), overloaded(), overloaded(), overloaded(), ok('wrong')]);
    expect(report!.infra).toEqual({ attempted: 3, providerUnavailable: 2, flaky: true });
    expect(report!.models[0]!.cases[0]).toMatchObject({ passed: 0, unavailable: 2, passRate: 0 });
    const md = renderMarkdown(report!, [{ model: 'gemini-3.8-flash', id: 'matrix-zh-instruction', previous: 1, current: 0, delta: -1, status: 'regressed' }]);
    expect(md).toContain('**Infra-flaky:** 2 of 3 attempted runs were provider-unavailable (503)');
    expect(md).toContain('**Regressions (untrusted, infra-flaky run):**');
  });

  it('marks a seed run provider-unavailable when one of its turns stayed 503', async () => {
    const { value: report, events } = await run([overloaded(), overloaded()], { runs: 1, seeds: true });
    expect(events.filter((e) => e.type === 'unavailable_retry')).toEqual([expect.objectContaining({ delayMs: 8_000 })]);
    expect(events.filter((e) => e.type === 'unavailable')).toEqual([expect.objectContaining({ attempts: 2 })]);
    expect(report.models[0]!.cases[0]).toMatchObject({ id: 'seed-group-member-no-shell', unavailable: 1, passRate: null });
    expect(report.infra?.flaky).toBe(true);
  });

  it('lists budget-skipped runs in the summary', async () => {
    const { value: report } = await run([ok(ZH_ANSWER), ok(ZH_ANSWER)], { maxRequests: 2 });
    expect(report!.models[0]!.cases[0]).toMatchObject({ passed: 2, skipped: 1, budgetSkipped: 1 });
    const md = renderMarkdown(report!, []);
    expect(md).toContain('**Budget-skipped:** 1 runs not run because the budget (requests 2/2) ran out: gemini-3.8-flash/matrix-zh-instruction (1/3)');
    expect(md).toContain('| 1 budget-skipped |');
  });
});
