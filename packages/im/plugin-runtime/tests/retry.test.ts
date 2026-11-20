import { describe, expect, it, vi } from 'vitest';
import { computeBackoffDelay, escapeHtml, parseRetryAfterMs, sleep } from '../src/index.js';

describe('sleep', () => {
  it('resolves after the delay and immediately for non-positive delays', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const wait = sleep(1_000).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await wait;
      expect(done).toBe(true);
      await expect(sleep(0)).resolves.toBeUndefined();
      await expect(sleep(-5)).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with the abort reason and clears its timer', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const wait = sleep(60_000, controller.signal);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
      const custom = new AbortController();
      const reason = new Error('stop');
      const waitCustom = sleep(60_000, custom.signal);
      custom.abort(reason);
      await expect(waitCustom).rejects.toBe(reason);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects at once for an already aborted signal, even without a delay', async () => {
    const signal = AbortSignal.abort();
    await expect(sleep(1_000, signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sleep(0, signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-10-20T08:00:00Z');

  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfterMs('2')).toBe(2_000);
    expect(parseRetryAfterMs(' 5 ', now)).toBe(5_000);
    expect(parseRetryAfterMs('1.5', now)).toBe(1_500);
    expect(parseRetryAfterMs('0', now)).toBe(0);
    expect(parseRetryAfterMs('Tue, 20 Oct 2026 08:00:07 GMT', now)).toBe(7_000);
    expect(parseRetryAfterMs('Tue, 20 Oct 2026 07:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
  });

  it('refuses absent, negative and malformed values', () => {
    for (const value of [undefined, null, '', '   ', '-5', '-1.5', '+5', '1e3', '0x10', 'soon', '5s', '2026-10-20']) {
      expect(parseRetryAfterMs(value, now), String(value)).toBeUndefined();
    }
  });
});

describe('computeBackoffDelay', () => {
  it('doubles with equal jitter and caps the step at maxDelayMs', () => {
    const policy = { baseDelayMs: 1_000, maxDelayMs: 4_000 };
    expect(computeBackoffDelay(0, policy, () => 0)).toBe(500);
    expect(computeBackoffDelay(0, policy, () => 1)).toBe(1_000);
    expect(computeBackoffDelay(1, policy, () => 1)).toBe(2_000);
    expect(computeBackoffDelay(5, policy, () => 1)).toBe(4_000);
    expect(computeBackoffDelay(10, { baseDelayMs: 500, maxDelayMs: 30_000 }, () => 0)).toBe(15_000);
  });

  it('applies a symmetric jitter ratio after the cap, or none', () => {
    const policy = { baseDelayMs: 1_000, maxDelayMs: 60_000, jitter: 0.2 };
    expect(computeBackoffDelay(0, policy, () => 0)).toBe(800);
    expect(computeBackoffDelay(0, policy, () => 0.5)).toBe(1_000);
    expect(computeBackoffDelay(0, policy, () => 1)).toBe(1_200);
    expect(computeBackoffDelay(10, policy, () => 1)).toBe(72_000);
    expect(computeBackoffDelay(2, { baseDelayMs: 1_000, maxDelayMs: 60_000, jitter: 0 }, () => 0.9)).toBe(4_000);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<b class="x" title='y'>&</b>`)).toBe('&lt;b class=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/b&gt;');
  });
});
