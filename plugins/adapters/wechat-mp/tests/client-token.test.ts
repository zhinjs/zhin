import { describe, expect, it, vi } from 'vitest';
import { WeChatMpApiClient } from '../src/api-client.js';

const config = { appId: 'app', appSecret: 's&ecret' } as unknown as ConstructorParameters<typeof WeChatMpApiClient>[0];

describe('WeChatMpApiClient access token', () => {
  it('shares one in-flight refresh between concurrent callers', async () => {
    let resolve!: (v: { data: unknown }) => void;
    const fetch = vi.fn(() => new Promise<{ data: unknown }>((r) => { resolve = r; }));
    const client = new WeChatMpApiClient(config, fetch);
    const a = client.refreshAccessToken();
    const b = client.refreshAccessToken();
    resolve({ data: { access_token: 'T', expires_in: 7200 } });
    await expect(Promise.all([a, b])).resolves.toEqual(['T', 'T']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain('secret=s%26ecret');
  });

  it('treats a token without expires_in as expiring instead of never expiring', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => ({ data: { access_token: 'T' } }));
    const client = new WeChatMpApiClient(config, fetch);
    await client.refreshAccessToken();
    expect(client.tokenExpired).toBe(false);
    vi.advanceTimersByTime(7200 * 1000);
    expect(client.tokenExpired).toBe(true);
    vi.useRealTimers();
  });

  it('caps absurd expires_in so the token still expires', async () => {
    vi.useFakeTimers();
    const client = new WeChatMpApiClient(config, vi.fn(async () => ({ data: { access_token: 'T', expires_in: 1e308 } })));
    await client.refreshAccessToken();
    vi.advanceTimersByTime(7200 * 1000);
    expect(client.tokenExpired).toBe(true);
    vi.useRealTimers();
  });

  it('times out a hung token fetch and allows a retry', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetch = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<{ data: unknown }>(() => {})
        : Promise.resolve({ data: { access_token: 'T2', expires_in: 7200 } });
    });
    const client = new WeChatMpApiClient(config, fetch);
    const first = expect(client.refreshAccessToken()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await first;
    await expect(client.refreshAccessToken()).resolves.toBe('T2');
    vi.useRealTimers();
  });

  it('does not refresh again when the failed request used an already-replaced token', async () => {
    let tokenCalls = 0;
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((r) => { releaseSend = r; });
    let sends = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/cgi-bin/token')) {
        tokenCalls += 1;
        return { data: { access_token: `T${tokenCalls}`, expires_in: 7200 } };
      }
      sends += 1;
      if (sends === 1) {
        await sendGate;
        return { data: { errcode: 40001, errmsg: 'invalid' } };
      }
      return { data: { errcode: 0 } };
    });
    const client = new WeChatMpApiClient(config, fetch);
    await client.refreshAccessToken();
    const pending = client.sendCustomerService({});
    await Promise.resolve();
    await client.refreshAccessToken(); // 其他请求已换成 T2
    releaseSend();
    await expect(pending).resolves.toEqual({ errcode: 0 });
    expect(tokenCalls).toBe(2);
    expect(String(fetch.mock.calls.at(-1)?.[0])).toContain('access_token=T2');
  });
});
