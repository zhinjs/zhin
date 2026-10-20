import { describe, expect, it } from 'vitest';
import { NettoolsError } from '../src/errors.js';
import { parseRetryAfter } from '../src/http.js';
import { createClient, createFakeNetwork, hang, json, sequence } from './helpers.js';

const URL_UNDER_TEST = new URL('https://api.example.net/v1/thing');

describe('HttpClient.fetchJson', () => {
  it('returns parsed JSON and sends the Accept header', async () => {
    const network = createFakeNetwork();
    let accept: string | null = null;
    network.route('api.example.net/', (_url, init) => {
      accept = new Headers(init.headers).get('accept');
      return json({ ok: true });
    });
    const response = await createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example' });
    expect(response.body).toEqual({ ok: true });
    expect(accept).toBe('application/json');
  });

  it('retries 503 with exponential backoff and equal jitter', async () => {
    const network = createFakeNetwork();
    network.route(
      'api.example.net/',
      sequence(
        () => json({}, 503),
        () => json({}, 502),
        () => json({ ok: 1 }),
      ),
    );
    const response = await createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example' });
    expect(response.body).toEqual({ ok: 1 });
    expect(network.calls).toHaveLength(3);
    // base 500ms → 250 + 0.5 * 250; then 1000ms → 500 + 0.5 * 500
    expect(network.sleeps).toEqual([375, 750]);
  });

  it('honours Retry-After seconds on 429', async () => {
    const network = createFakeNetwork();
    network.route(
      'api.example.net/',
      sequence(
        () => json({}, 429, { 'retry-after': '3' }),
        () => json({ ok: 1 }),
      ),
    );
    await createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example' });
    expect(network.sleeps).toEqual([3000]);
  });

  it('fails fast with rate_limited when Retry-After exceeds the cap', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', () => json({}, 429, { 'retry-after': '120' }));
    const error = await createClient(network)
      .fetchJson(URL_UNDER_TEST, { provider: 'Example' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NettoolsError);
    expect((error as NettoolsError).kind).toBe('rate_limited');
    expect((error as NettoolsError).retryAfterMs).toBe(120_000);
    expect(network.calls).toHaveLength(1);
    expect(network.sleeps).toEqual([]);
  });

  it('gives up after maxRetries and reports the last error', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', () => json({}, 500));
    await expect(createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example' })).rejects.toMatchObject({
      kind: 'http',
      status: 500,
    });
    expect(network.calls).toHaveLength(3);
  });

  it('does not retry non-transient statuses such as 404', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', () => json({}, 404));
    await expect(createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example' })).rejects.toMatchObject({
      kind: 'http',
      status: 404,
    });
    expect(network.calls).toHaveLength(1);
  });

  it('treats passStatuses as answers', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', () => json({ errorCode: 404 }, 404));
    const response = await createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example', passStatuses: [404] });
    expect(response.status).toBe(404);
  });

  it('retries network errors', async () => {
    const network = createFakeNetwork();
    let attempts = 0;
    network.route('api.example.net/', () => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError('fetch failed');
      }
      return json({ ok: 1 });
    });
    const response = await createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example' });
    expect(response.body).toEqual({ ok: 1 });
  });

  it('times out a hung upstream per attempt and retries', async () => {
    const hungNetwork = createFakeNetwork();
    let attempts = 0;
    hungNetwork.route('api.example.net/', (url, init) => {
      attempts += 1;
      return attempts === 1 ? hang(url, init) : json({ ok: 1 });
    });
    const response = await createClient(hungNetwork, { timeoutMs: 20 }).fetchJson(URL_UNDER_TEST, { provider: 'Example' });
    expect(response.body).toEqual({ ok: 1 });
    expect(attempts).toBe(2);
  });

  it('reports a timeout when every attempt hangs', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', hang);
    await expect(
      createClient(network, { timeoutMs: 20, maxRetries: 1 }).fetchJson(URL_UNDER_TEST, { provider: 'Example' }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(network.calls).toHaveLength(2);
  });

  it('stops immediately when the caller aborts', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', hang);
    const controller = new AbortController();
    const pending = createClient(network, { timeoutMs: 5_000 }).fetchJson(URL_UNDER_TEST, {
      provider: 'Example',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(network.calls).toHaveLength(1);
  });

  it('reports malformed JSON without retrying', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', () => new Response('<html>oops</html>', { status: 200 }));
    await expect(createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example' })).rejects.toMatchObject({
      kind: 'malformed',
    });
    expect(network.calls).toHaveLength(1);
  });

  it('refuses oversized bodies', async () => {
    const network = createFakeNetwork();
    network.route('api.example.net/', () => new Response(JSON.stringify({ data: 'x'.repeat(2_000) })));
    await expect(
      createClient(network).fetchJson(URL_UNDER_TEST, { provider: 'Example', maxBodyBytes: 1_000 }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });
});

describe('parseRetryAfter', () => {
  it('parses delta seconds and HTTP dates, ignores junk', () => {
    const now = Date.parse('2026-10-20T08:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5_000);
    expect(parseRetryAfter('Tue, 20 Oct 2026 08:00:07 GMT', now)).toBe(7_000);
    expect(parseRetryAfter('Tue, 20 Oct 2026 07:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});
