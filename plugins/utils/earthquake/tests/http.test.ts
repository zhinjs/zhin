import { describe, expect, it, vi } from 'vitest';
import {
  computeBackoffDelay,
  getTextWithRetry,
  HttpRequestError,
  parseRetryAfter,
  type RetryPolicy,
} from '../src/http.js';
import { createRoutedFetch, jsonResponse, NOW, statusResponse } from './fixtures.js';

const URL = 'https://feed.example/eq.json';
const policy: RetryPolicy = { timeoutMs: 1_000, maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 30_000 };

function sequence(...responses: (() => Response | Promise<Response>)[]) {
  let call = 0;
  return createRoutedFetch({
    [URL]: () => {
      const next = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return next();
    },
  });
}

describe('getTextWithRetry', () => {
  it('passes an abort signal for the per-attempt timeout', async () => {
    const fetch = sequence(() => jsonResponse('[]'));
    await getTextWithRetry(URL, policy, { deps: { fetch } });
    const init = fetch.mock.calls[0]![1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries 503 with exponential backoff and jitter, then succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = sequence(() => statusResponse(503), () => statusResponse(502), () => jsonResponse('[1]'));
    const result = await getTextWithRetry(URL, policy, { deps: { fetch, sleep, random: () => 0.5 } });
    expect(result.body).toBe('[1]');
    expect(result.attempts).toBe(3);
    // equal jitter: half + 0.5 * half of 1000ms, then of 2000ms
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([750, 1_500]);
  });

  it('retries timeouts and network errors', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const fetch = sequence(
      () => Promise.reject(timeout),
      () => Promise.reject(new TypeError('fetch failed')),
      () => jsonResponse('ok'),
    );
    const result = await getTextWithRetry(URL, policy, { deps: { fetch, sleep: async () => undefined } });
    expect(result.body).toBe('ok');
  });

  it('honours Retry-After on 429 when it fits the budget', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = sequence(() => statusResponse(429, { 'retry-after': '7' }), () => jsonResponse('ok'));
    await getTextWithRetry(URL, policy, { deps: { fetch, sleep, random: () => 0 } });
    expect(sleep).toHaveBeenCalledWith(7_000);
  });

  it('stops early and reports retryAfterMs when the server asks for a long pause', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = sequence(() => statusResponse(429, { 'retry-after': '600' }));
    const error = await getTextWithRetry(URL, policy, { deps: { fetch, sleep } }).catch((caught) => caught);
    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error.retryAfterMs).toBe(600_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry non-transient 4xx', async () => {
    const fetch = sequence(() => statusResponse(404));
    await expect(getTextWithRetry(URL, policy, { deps: { fetch, sleep: async () => undefined } }))
      .rejects.toMatchObject({ status: 404, retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries and surfaces the last error', async () => {
    const fetch = sequence(() => statusResponse(500));
    await expect(getTextWithRetry(URL, policy, { deps: { fetch, sleep: async () => undefined } }))
      .rejects.toThrow('HTTP 500');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('sends conditional validators and reports 304 as not modified', async () => {
    const fetch = sequence(() => statusResponse(304));
    const result = await getTextWithRetry(URL, policy, {
      validators: { etag: '"abc"', lastModified: 'Tue, 20 Oct 2026 06:52:18 GMT' },
      deps: { fetch },
    });
    expect(result.notModified).toBe(true);
    const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['If-None-Match']).toBe('"abc"');
    expect(headers['If-Modified-Since']).toBe('Tue, 20 Oct 2026 06:52:18 GMT');
  });

  it('returns validators from a fresh response', async () => {
    const fetch = sequence(() => jsonResponse('[]', { headers: { etag: '"v2"', 'last-modified': 'x' } }));
    const result = await getTextWithRetry(URL, policy, { deps: { fetch } });
    expect(result.validators).toEqual({ etag: '"v2"', lastModified: 'x' });
  });
});

describe('backoff helpers', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('3', NOW)).toBe(3_000);
    expect(parseRetryAfter(new Date(NOW + 5_000).toUTCString(), NOW)).toBe(5_000);
    expect(parseRetryAfter(new Date(NOW - 5_000).toUTCString(), NOW)).toBe(0);
    expect(parseRetryAfter('soon', NOW)).toBeUndefined();
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
  });

  it('keeps jittered delays within [half, full] of the capped step', () => {
    expect(computeBackoffDelay(0, policy, () => 0)).toBe(500);
    expect(computeBackoffDelay(0, policy, () => 0.999)).toBeLessThanOrEqual(1_000);
    expect(computeBackoffDelay(10, policy, () => 0.999)).toBeLessThanOrEqual(30_000);
    expect(computeBackoffDelay(10, policy, () => 0)).toBe(15_000);
  });
});
