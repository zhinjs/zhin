import { describe, expect, it, vi } from 'vitest';
import { WeChatMpClient } from '../src/client.js';

const config = { appId: 'app', appSecret: 's&ecret' } as unknown as ConstructorParameters<typeof WeChatMpClient>[0];

describe('WeChatMpClient access token', () => {
  it('shares one in-flight refresh between concurrent callers', async () => {
    let resolve!: (v: { data: unknown }) => void;
    const fetch = vi.fn(() => new Promise<{ data: unknown }>((r) => { resolve = r; }));
    const client = new WeChatMpClient(config, fetch);
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
    const client = new WeChatMpClient(config, fetch);
    await client.refreshAccessToken();
    expect(client.tokenExpired).toBe(false);
    vi.advanceTimersByTime(7200 * 1000);
    expect(client.tokenExpired).toBe(true);
    vi.useRealTimers();
  });
});
