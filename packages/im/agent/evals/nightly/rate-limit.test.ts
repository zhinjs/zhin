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
import {
  DailyQuotaExhaustedError,
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

/** Run `promise` to completion while advancing fake time. */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const result = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  for (let i = 0; i < 200; i++) await vi.advanceTimersByTimeAsync(1_000);
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
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
    expect(s.port.stats()).toEqual({ requests: 4, retries: 3, gaveUp: 1 });
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
    expect(resolveRateLimitPolicy({})).toEqual({ minIntervalMs: 4_000, backoffMs: [2_000, 4_000, 8_000] });
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
